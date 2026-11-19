import { defaultUiLocale, type UiLocale } from './locale';
import { chatHostText } from './chat-host-text';
import { z } from 'zod';
import type { ChatMessage, ChatSession, ForkChatResult, SessionReference, WorkspaceState } from './model';
import type { ModuleReference } from './references';

export const chatSessionListRequestSchema = z.object({ query: z.string().max(200).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(50).optional(), revision: z.string().regex(/^[a-f0-9]{24}$/).optional() }).strict();

function copyReferences(references: ModuleReference[]): ModuleReference[] { return references.map(reference => ({ ...reference, ...(reference.metadata ? { metadata: { ...reference.metadata } } : {}) })); }

export function normalizeSessions(state: WorkspaceState, locale: UiLocale = defaultUiLocale): WorkspaceState {
  const existing = Array.isArray(state.sessions) ? state.sessions : [];
  if (existing.length > 0) {
    const active = existing.find(s => s.id === state.activeSessionId) ?? existing[0];
    return { ...state, sessions: existing, activeSessionId: active.id, chat: active.messages };
  }
  const messages = Array.isArray(state.chat) ? state.chat : [];
  const createdAt = messages.find(m => m.id !== 'welcome')?.timestamp ?? new Date().toISOString();
  const first = messages.find(m => m.role === 'user');
  const legacy: ChatSession = { id: crypto.randomUUID(), title: first?.text.trim().slice(0, 60) || chatHostText[locale].newChat, ...(!first && { placeholderTitle: true }), createdAt, updatedAt: messages.at(-1)?.timestamp ?? createdAt, historyStart: Math.min(state.ai?.historyStart ?? messages.length, messages.length), messages };
  return { ...state, sessions: [legacy], activeSessionId: legacy.id, chat: legacy.messages };
}

export function createSession(state: WorkspaceState, now = new Date().toISOString(), locale: UiLocale = defaultUiLocale): { state: WorkspaceState; session: ChatSession } {
  const session: ChatSession = { id: crypto.randomUUID(), title: chatHostText[locale].newChat, placeholderTitle: true, createdAt: now, updatedAt: now, historyStart: 0, messages: [] };
  return { session, state: { ...state, sessions: [session, ...state.sessions], activeSessionId: session.id, chat: session.messages } };
}

export function selectSession(state: WorkspaceState, id: string, locale: UiLocale = defaultUiLocale): WorkspaceState {
  const session = state.sessions.find(s => s.id === id);
  if (!session) throw new Error(chatHostText[locale].chatMissing);
  return { ...state, activeSessionId: session.id, chat: session.messages };
}

export function renameSession(state: WorkspaceState, id: string, rawTitle: string, locale: UiLocale = defaultUiLocale): WorkspaceState {
  const title = rawTitle.trim();
  if (!title || title.length > 120) throw new Error(chatHostText[locale].titleLimit);
  if (!state.sessions.some(s => s.id === id)) throw new Error(chatHostText[locale].chatMissing);
  return { ...state, sessions: state.sessions.map(s => s.id === id ? { ...s, title, placeholderTitle: false } : s) };
}

/** A fork contains the history before the chosen user message; the selected message is returned as an editable draft. */
export function forkSession(state: WorkspaceState, messageId: string, replacementText?: string, now = new Date().toISOString(), locale: UiLocale = defaultUiLocale): { state: WorkspaceState; result: ForkChatResult; sourceMessageId: string } {
  const source = state.sessions.find(s => s.id === state.activeSessionId);
  if (!source) throw new Error(chatHostText[locale].chatMissing);
  if (source.messages.some(m => m.status === 'streaming')) throw new Error(chatHostText[locale].streaming);
  const selectedIndex = source.messages.findIndex(m => m.id === messageId);
  if (selectedIndex < 0) throw new Error(chatHostText[locale].messageMissing);
  const selected = source.messages[selectedIndex];
  let userIndex = selectedIndex;
  while (userIndex >= 0 && source.messages[userIndex].role !== 'user') userIndex--;
  if (userIndex < 0) throw new Error(chatHostText[locale].noUser);
  const original = source.messages[userIndex];
  const text = replacementText === undefined ? original.text : replacementText.trim();
  if (!text.trim() || text.length > 20_000) throw new Error(chatHostText[locale].messageLimit);
  const messages = source.messages.slice(0, userIndex).map(m => ({ ...m, id: crypto.randomUUID(), ...(m.sessionRef ? { sessionRef: { ...m.sessionRef } } : {}), ...(m.references ? { references: copyReferences(m.references) } : {}) }));
  const session: ChatSession = { id: crypto.randomUUID(), title: `${source.title.slice(0, 106)} (${chatHostText[locale].branch})`, createdAt: now, updatedAt: now, historyStart: Math.min(source.historyStart, messages.length), messages };
  const emailReference = original.emailReference ? { ...original.emailReference, attachments: original.emailReference.attachments.map(attachment => ({ ...attachment })) } : undefined;
  const emailRef = emailReference?.id ?? (original.emailRef && state.mails.some(m => m.id === original.emailRef) ? original.emailRef : undefined);
  const sessionRefId = original.sessionRef?.id && original.sessionRef.id !== session.id && state.sessions.some(s => s.id === original.sessionRef?.id) ? original.sessionRef.id : undefined;
  return { sourceMessageId: original.id, state: { ...state, sessions: [session, ...state.sessions], activeSessionId: session.id, chat: session.messages }, result: { sessionId: session.id, text, ...(emailRef ? { emailRef } : {}), ...(emailReference ? { emailReference } : {}), ...(sessionRefId ? { sessionRefId } : {}), ...(original.references?.length ? { references: copyReferences(original.references) } : {}) } };
}

export function updateSessionMessages(state: WorkspaceState, id: string, update: (messages: ChatMessage[]) => ChatMessage[], now = new Date().toISOString()): WorkspaceState {
  const session = state.sessions.find(s => s.id === id);
  if (!session) throw new Error('Chat not found.');
  const messages = update(session.messages);
  const firstUser = messages.find(m => m.role === 'user');
  // Legacy chats used this literal for their automatic title. Renamed or
  // generated titles in newer workspaces carry an explicit marker.
  const autoTitle = session.placeholderTitle ?? (session.title === chatHostText.de.newChat && !session.messages.some(message => message.role === 'user'));
  const title = autoTitle && firstUser ? firstUser.text.trim().replace(/\s+/g, ' ').slice(0, 60) || session.title : session.title;
  const next = { ...session, messages, updatedAt: now, title, ...(autoTitle && firstUser && { placeholderTitle: false }) };
  return { ...state, sessions: state.sessions.map(s => s.id === id ? next : s), chat: state.activeSessionId === id ? messages : state.chat };
}

export function snapshotSessionReference(state: WorkspaceState, id: string, currentId = state.activeSessionId, now = new Date().toISOString(), locale: UiLocale = defaultUiLocale): SessionReference {
  if (id === currentId) throw new Error(chatHostText[locale].selfReference);
  const session = state.sessions.find(s => s.id === id);
  if (!session) throw new Error(chatHostText[locale].referenceMissing);
  const messages = session.messages.filter(m => m.id !== 'welcome');
  const readable = messages.filter(m => m.text.trim() && m.status !== 'failed' && m.status !== 'streaming');
  const selected = readable.slice(-40);
  const formatted = selected.map(m => `${m.role === 'user' ? chatHostText[locale].userRole : chatHostText[locale].assistantRole}: ${m.text.slice(0, 8000)}`).join('\n\n');
  const excerpt = formatted.slice(-20000);
  if (!excerpt) throw new Error(chatHostText[locale].emptyReference);
  return { id: session.id, title: session.title.slice(0, 120), excerpt, truncated: selected.length < messages.length || selected.some(m => m.text.length > 8000) || formatted.length > 20000, capturedAt: now, sourceUpdatedAt: session.updatedAt, messageCount: messages.length };
}

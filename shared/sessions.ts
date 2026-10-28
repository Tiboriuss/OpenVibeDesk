import type { ChatMessage, ChatSession, ForkChatResult, SessionReference, WorkspaceState } from './model';

export function normalizeSessions(state: WorkspaceState): WorkspaceState {
  const existing = Array.isArray(state.sessions) ? state.sessions : [];
  if (existing.length > 0) {
    const active = existing.find(s => s.id === state.activeSessionId) ?? existing[0];
    return { ...state, sessions: existing, activeSessionId: active.id, chat: active.messages };
  }
  const messages = Array.isArray(state.chat) ? state.chat : [];
  const createdAt = messages.find(m => m.id !== 'welcome')?.timestamp ?? new Date().toISOString();
  const first = messages.find(m => m.role === 'user');
  const legacy: ChatSession = { id: crypto.randomUUID(), title: first?.text.trim().slice(0, 60) || 'Neuer Chat', createdAt, updatedAt: messages.at(-1)?.timestamp ?? createdAt, historyStart: Math.min(state.ai?.historyStart ?? messages.length, messages.length), messages };
  return { ...state, sessions: [legacy], activeSessionId: legacy.id, chat: legacy.messages };
}

export function createSession(state: WorkspaceState, now = new Date().toISOString()): { state: WorkspaceState; session: ChatSession } {
  const session: ChatSession = { id: crypto.randomUUID(), title: 'Neuer Chat', createdAt: now, updatedAt: now, historyStart: 0, messages: [] };
  return { session, state: { ...state, sessions: [session, ...state.sessions], activeSessionId: session.id, chat: session.messages } };
}

export function selectSession(state: WorkspaceState, id: string): WorkspaceState {
  const session = state.sessions.find(s => s.id === id);
  if (!session) throw new Error('Chat nicht gefunden.');
  return { ...state, activeSessionId: session.id, chat: session.messages };
}

export function renameSession(state: WorkspaceState, id: string, rawTitle: string): WorkspaceState {
  const title = rawTitle.trim();
  if (!title || title.length > 120) throw new Error('Bitte einen Titel mit höchstens 120 Zeichen eingeben.');
  if (!state.sessions.some(s => s.id === id)) throw new Error('Chat nicht gefunden.');
  return { ...state, sessions: state.sessions.map(s => s.id === id ? { ...s, title } : s) };
}

/** A fork contains the history before the chosen user message; the selected message is returned as an editable draft. */
export function forkSession(state: WorkspaceState, messageId: string, replacementText?: string, now = new Date().toISOString()): { state: WorkspaceState; result: ForkChatResult } {
  const source = state.sessions.find(s => s.id === state.activeSessionId);
  if (!source) throw new Error('Chat nicht gefunden.');
  if (source.messages.some(m => m.status === 'streaming')) throw new Error('Bitte warte, bis die laufende Antwort beendet ist.');
  const selectedIndex = source.messages.findIndex(m => m.id === messageId);
  if (selectedIndex < 0) throw new Error('Nachricht nicht gefunden.');
  const selected = source.messages[selectedIndex];
  let userIndex = selectedIndex;
  while (userIndex >= 0 && source.messages[userIndex].role !== 'user') userIndex--;
  if (userIndex < 0) throw new Error('Keine zugehörige Nutzernachricht gefunden.');
  const original = source.messages[userIndex];
  const text = replacementText === undefined ? original.text : replacementText.trim();
  if (!text.trim() || text.length > 20_000) throw new Error('Bitte eine Nachricht mit höchstens 20.000 Zeichen eingeben.');
  const messages = source.messages.slice(0, userIndex).map(m => ({ ...m, id: crypto.randomUUID(), ...(m.sessionRef ? { sessionRef: { ...m.sessionRef } } : {}) }));
  const session: ChatSession = { id: crypto.randomUUID(), title: `${source.title.slice(0, 106)} (Abzweigung)`, createdAt: now, updatedAt: now, historyStart: Math.min(source.historyStart, messages.length), messages };
  const emailRef = original.emailRef && state.mails.some(m => m.id === original.emailRef) ? original.emailRef : undefined;
  const sessionRefId = original.sessionRef?.id && original.sessionRef.id !== session.id && state.sessions.some(s => s.id === original.sessionRef?.id) ? original.sessionRef.id : undefined;
  return { state: { ...state, sessions: [session, ...state.sessions], activeSessionId: session.id, chat: session.messages }, result: { sessionId: session.id, text, ...(emailRef ? { emailRef } : {}), ...(sessionRefId ? { sessionRefId } : {}) } };
}

export function updateSessionMessages(state: WorkspaceState, id: string, update: (messages: ChatMessage[]) => ChatMessage[], now = new Date().toISOString()): WorkspaceState {
  const session = state.sessions.find(s => s.id === id);
  if (!session) throw new Error('Chat nicht gefunden.');
  const messages = update(session.messages);
  const firstUser = messages.find(m => m.role === 'user');
  const title = session.title === 'Neuer Chat' && firstUser ? firstUser.text.trim().replace(/\s+/g, ' ').slice(0, 60) || session.title : session.title;
  const next = { ...session, messages, updatedAt: now, title };
  return { ...state, sessions: state.sessions.map(s => s.id === id ? next : s), chat: state.activeSessionId === id ? messages : state.chat };
}

export function snapshotSessionReference(state: WorkspaceState, id: string, currentId = state.activeSessionId): SessionReference {
  if (id === currentId) throw new Error('Der aktuelle Chat kann nicht auf sich selbst verweisen.');
  const session = state.sessions.find(s => s.id === id);
  if (!session) throw new Error('Referenzierter Chat nicht gefunden.');
  const excerpt = session.messages.filter(m => m.id !== 'welcome' && m.text.trim() && m.status !== 'failed' && m.status !== 'streaming').slice(-40).map(m => `${m.role === 'user' ? 'Nutzer' : 'Assistent'}: ${m.text.slice(0, 8000)}`).join('\n\n').slice(-20000);
  if (!excerpt) throw new Error('Dieser Chat enthält noch keinen Text als Referenz.');
  return { id: session.id, title: session.title.slice(0, 120), excerpt };
}

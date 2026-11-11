import { createHash } from 'node:crypto';
import type { ChatSession, ChatSessionPage, ChatSessionSummary, RendererWorkspaceState, WindowKind, WorkspaceState } from '../shared/model';

export type WorkspaceView = WindowKind | 'dock' | 'module';
const PAGE_SIZE = 100;
const EMPTY: never[] = [];

export function listChatSessions(state: WorkspaceState, query = '', offset = 0, limit = 50, expectedRevision?: string): ChatSessionPage {
  const search = query.trim().toLocaleLowerCase();
  const matches = state.sessions.filter(session => !search || session.title.toLocaleLowerCase().includes(search) || session.messages.some(message => message.text.toLocaleLowerCase().includes(search)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  // Anchor list membership/order rather than streaming timestamps: a tool's own
  // status updates must not invalidate its next page while its list position stays put.
  const revision = createHash('sha256').update(JSON.stringify([search, matches.map(session => [session.id, session.title, session.messages.length])])).digest('hex').slice(0, 24);
  if (expectedRevision && expectedRevision !== revision) throw new Error('Die Chatliste hat sich geändert. Bitte die erste Seite neu laden.');
  if (offset > matches.length) throw new Error('Diese Position liegt außerhalb der Chatliste.');
  const hasMore = offset + limit < matches.length;
  return { sessions: matches.slice(offset, offset + limit).map(sessionSummary), total: matches.length, offset, revision, hasMore, complete: !hasMore, ...(hasMore ? { nextOffset: offset + limit } : {}) };
}

function sessionSummary(session: ChatSession): ChatSessionSummary {
  let preview = '';
  for (let index = session.messages.length - 1; index >= 0; index--) if (session.messages[index].id !== 'welcome') { preview = session.messages[index].text.slice(0, 100); break; }
  return { id: session.id, title: session.title, updatedAt: session.updatedAt, messageCount: session.messages.length, preview };
}

/** Renderer projections never replace the authoritative state used by tools/storage. */
export class WorkspaceViewProjector {
  private previous?: { keys: unknown[]; value: RendererWorkspaceState };
  private sessionId?: string;
  private start = 0;
  private revision = 0;
  private sessions?: ChatSession[];

  older(state: WorkspaceState): void {
    this.project(state, 'chat');
    const session = state.sessions.find(item => item.id === state.activeSessionId);
    this.start = Math.max(session?.historyStart ?? 0, this.start - PAGE_SIZE);
    this.previous = undefined;
  }

  project(state: WorkspaceState, view: WorkspaceView): RendererWorkspaceState {
    if (this.sessions !== state.sessions) { this.sessions = state.sessions; this.revision++; }
    const active = view === 'chat' ? state.sessions.find(item => item.id === state.activeSessionId) : undefined;
    if (active && active.id !== this.sessionId) {
      this.sessionId = active.id;
      this.start = Math.max(active.historyStart, active.messages.length - PAGE_SIZE);
    }
    if (active) this.start = Math.min(active.messages.length, Math.max(active.historyStart, this.start));
    const draft = (view === 'draft' || view === 'files') ? state.drafts.find(item => item.id === state.activeDraftId) : undefined;
    const keys = [view, state.settings, view === 'chat' ? state.ai : undefined,
      view === 'chat' || view === 'sessions' ? state.sessions : undefined,
      view === 'chat' || view === 'sessions' ? state.activeSessionId : undefined,
      view === 'mail' ? state.drafts : draft, view === 'chat' ? this.start : undefined];
    if (this.previous && keys.every((key, index) => key === this.previous!.keys[index])) return this.previous.value;
    const value: RendererWorkspaceState = {
      version: 1, windows: EMPTY, mails: EMPTY, drafts: EMPTY, chat: EMPTY, sessions: EMPTY,
      folder: 'Inbox', activeSessionId: '', provider: '', settings: state.settings,
    };
    if (view === 'chat' || view === 'sessions') {
      value.activeSessionId = state.activeSessionId;
      value.presentation = { sessionRevision: this.revision };
    }
    if (active) {
      // References need identity/title, never the other conversations' contents.
      value.sessions = state.sessions.map(({ id, title, createdAt, updatedAt, historyStart }) => ({ id, title, createdAt, updatedAt, historyStart, messages: EMPTY }));
      value.chat = active.messages.slice(this.start);
      value.ai = state.ai;
      value.presentation = { ...value.presentation, chatStart: this.start, chatTotal: active.messages.length,
        chatHasEarlierUser: active.messages.slice(active.historyStart, this.start).some(message => message.role === 'user'),
        streamingSessionId: state.sessions.find(session => session.messages.some(message => message.status === 'streaming'))?.id };
    }
    if (view === 'mail') value.drafts = state.drafts.map(item => ({ ...item, body: '', attachments: EMPTY }));
    else if (draft) {
      value.activeDraftId = draft.id;
      value.drafts = view === 'draft' ? [draft] : [{ ...draft, body: '', attachments: EMPTY }];
    }
    this.previous = { keys, value };
    return value;
  }
}

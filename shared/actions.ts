import { z } from 'zod';
import type { WorkspaceState, WorkspaceWindow, WindowKind, Draft } from './model';

export const uiActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open_window'), kind: z.enum(['mail', 'chat', 'draft', 'files', 'settings', 'sessions']) }),
  z.object({ type: z.literal('focus_window'), windowId: z.string() }),
  z.object({ type: z.literal('read_email'), emailId: z.string() }),
  z.object({ type: z.literal('create_draft'), replyTo: z.string().optional() }),
  z.object({ type: z.literal('update_draft'), draftId: z.string(), patch: z.object({ to: z.string().max(500).optional(), cc: z.string().max(500).optional(), bcc: z.string().max(500).optional(), accountId: z.string().max(100).optional(), subject: z.string().max(1000).optional(), body: z.string().max(100000).optional() }).strict() }),
  z.object({ type: z.literal('open_file_manager') }),
  z.object({ type: z.literal('attach_file'), draftId: z.string(), file: z.object({ path: z.string(), name: z.string(), size: z.number().nonnegative() }) }),
  z.object({ type: z.literal('remove_attachment'), draftId: z.string(), index: z.number().int().nonnegative() }),
  z.object({ type: z.literal('request_user_input'), prompt: z.string().max(2000) })
]);
export type UiAction = z.infer<typeof uiActionSchema>;
export type ActionResult = { state: WorkspaceState; message: string; requestedInput?: string };

export function initialState(): WorkspaceState {
  return { version: 1, sessions: [], activeSessionId: '', settings: { textSize: 'standard', dockAlwaysOnTop: true }, folder: 'Inbox', selectedMailId: 'm1', provider: 'Mock provider', windows: [
    { id: 'mail', kind: 'mail', title: 'Mail', x: 72, y: 82, width: 650, height: 520, z: 1, minimized: false },
    { id: 'chat', kind: 'chat', title: 'Assistant', x: 620, y: 120, width: 530, height: 560, z: 2, minimized: false }
  ], mails: [
    { id: 'm1', folder: 'Inbox', threadId: 't1', from: 'Mara Schneider <mara@example.org>', to: 'you@example.org', subject: 'Launch-Checkliste für Freitag', date: '2026-10-26T09:18:00.000Z', bodyText: 'Hallo, kannst du die Launch-Checkliste bis Freitag durchsehen? Bitte antworte mir mit den offenen Punkten.\n\nDanke!\nMara', attachments: [{ name: 'checkliste.pdf', size: 48120 }], read: false },
    { id: 'm2', folder: 'Inbox', threadId: 't2', from: 'Jonas Weber <jonas@example.org>', to: 'you@example.org', subject: 'Design-Feedback', date: '2026-10-25T14:04:00.000Z', bodyText: 'Die neue Oberfläche sieht gut aus. Können wir die Navigation im nächsten Review besprechen?', attachments: [], read: true },
    { id: 'm3', folder: 'Inbox', threadId: 't3', from: 'Team <team@example.org>', to: 'you@example.org', subject: 'Notizen zum Workspace', date: '2026-10-24T08:41:00.000Z', bodyText: 'Hier sind die Notizen aus unserem letzten Gespräch zum lokalen Workspace.', attachments: [], read: true }
  ], drafts: [], chat: [{ id: 'welcome', role: 'assistant', text: 'Füge eine Referenz hinzu oder beschreibe, was du im Workspace erledigen möchtest.', timestamp: '2026-10-27T00:00:00.000Z' }] };
}

function openWindow(state: WorkspaceState, kind: WindowKind): WorkspaceState {
  const existing = state.windows.find(w => w.kind === kind);
  const z = Math.max(0, ...state.windows.map(w => w.z)) + 1;
  if (existing) return { ...state, windows: state.windows.map(w => w.id === existing.id ? { ...w, minimized: false, z } : w) };
  const sizes: Record<WindowKind, [number, number]> = { mail: [650, 520], chat: [530, 560], draft: [590, 520], files: [740, 580], settings: [650, 540], sessions: [560, 520] };
  const [width, height] = sizes[kind];
  const win: WorkspaceWindow = { id: kind, kind, title: { mail: 'Mail', chat: 'Assistant', draft: 'Draft', files: 'Files', settings: 'Settings', sessions: 'Chats' }[kind], x: 130 + state.windows.length * 36, y: 95 + state.windows.length * 28, width, height, z, minimized: false };
  return { ...state, windows: [...state.windows, win] };
}

export function applyUiAction(state: WorkspaceState, raw: unknown): ActionResult {
  const action = uiActionSchema.parse(raw);
  switch (action.type) {
    case 'open_window': return { state: openWindow(state, action.kind), message: `${action.kind} opened` };
    case 'open_file_manager': return { state: openWindow(state, 'files'), message: 'File manager opened' };
    case 'focus_window': {
      if (!state.windows.some(w => w.id === action.windowId)) throw new Error('Window not found');
      const z = Math.max(...state.windows.map(w => w.z)) + 1;
      return { state: { ...state, windows: state.windows.map(w => w.id === action.windowId ? { ...w, z, minimized: false } : w) }, message: 'Window focused' };
    }
    case 'read_email': {
      const mail = state.mails.find(m => m.id === action.emailId);
      if (!mail) throw new Error('Email not found');
      return { state: { ...openWindow(state, 'mail'), selectedMailId: mail.id, folder: mail.folder, mails: state.mails.map(m => m.id === mail.id ? { ...m, read: true } : m) }, message: `Opened email: ${mail.subject}` };
    }
    case 'create_draft': {
      const reply = action.replyTo ? state.mails.find(m => m.id === action.replyTo) : undefined;
      if (action.replyTo && !reply) throw new Error('Reply email not found');
      const draft: Draft = { id: crypto.randomUUID(), replyTo: reply?.id, to: reply?.from.replace(/^.*<([^>]+)>.*$/, '$1') ?? '', subject: reply ? `Re: ${reply.subject.replace(/^Re:\s*/i, '')}` : '', body: '', attachments: [], updatedAt: new Date().toISOString() };
      return { state: { ...openWindow(state, 'draft'), drafts: [...state.drafts, draft], activeDraftId: draft.id }, message: 'Draft created' };
    }
    case 'update_draft': {
      if (!state.drafts.some(d => d.id === action.draftId)) throw new Error('Draft not found');
      return { state: { ...state, drafts: state.drafts.map(d => d.id === action.draftId ? { ...d, ...action.patch, updatedAt: new Date().toISOString() } : d) }, message: 'Draft updated' };
    }
    case 'attach_file': {
      if (!state.drafts.some(d => d.id === action.draftId)) throw new Error('Draft not found');
      return { state: { ...state, drafts: state.drafts.map(d => d.id === action.draftId ? { ...d, attachments: [...d.attachments, action.file], updatedAt: new Date().toISOString() } : d) }, message: 'File attached' };
    }
    case 'remove_attachment': {
      const draft = state.drafts.find(d => d.id === action.draftId);
      if (!draft || action.index >= draft.attachments.length) throw new Error('Attachment not found');
      return { state: { ...state, drafts: state.drafts.map(d => d.id === action.draftId ? { ...d, attachments: d.attachments.filter((_, index) => index !== action.index), updatedAt: new Date().toISOString() } : d) }, message: 'Attachment removed' };
    }
    case 'request_user_input': return { state, message: 'User input requested', requestedInput: action.prompt };
  }
}

import { storedChatComposerSchema, type ChatComposerContent, type StoredChatComposer } from '../shared/chat-composer';
import type { WorkspaceState } from '../shared/model';

const checkedComposers = new WeakSet<StoredChatComposer>();
export function storedChatComposer(state: WorkspaceState, sessionId: string): StoredChatComposer | undefined {
  const map = state.chatComposers;
  if (map === undefined) return;
  const invalid = 'Der gespeicherte Chatentwurf ist beschädigt und konnte nicht geladen werden.';
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(invalid);
  if (!Object.hasOwn(map, sessionId)) return;
  const stored = map[sessionId];
  if (!checkedComposers.has(stored)) {
    if (!storedChatComposerSchema.safeParse(stored).success || stored.sessionId !== sessionId) throw new Error(invalid);
    checkedComposers.add(stored);
  }
  return stored;
}

export function withComposer(state: WorkspaceState, composer: StoredChatComposer): WorkspaceState {
  storedChatComposer(state, composer.sessionId);
  if (!storedChatComposerSchema.safeParse(composer).success) throw new Error('Der Chatentwurf enthält ungültige Daten.');
  checkedComposers.add(composer);
  return { ...state, chatComposers: { ...state.chatComposers, [composer.sessionId]: composer } };
}
export function sameComposerContent(a: ChatComposerContent, b: ChatComposerContent): boolean {
  // Both values have the schema’s canonical key order. An omitted selection equals an empty one.
  return a.text === b.text && a.sessionRefId === b.sessionRefId && JSON.stringify(a.emailSummary) === JSON.stringify(b.emailSummary)
    && JSON.stringify(a.references ?? []) === JSON.stringify(b.references ?? []);
}

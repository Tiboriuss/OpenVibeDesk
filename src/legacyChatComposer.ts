import { MAX_COMPOSER_TEXT, type ChatComposerContent, type ChatComposerLegacyReceipt, type ChatComposerSnapshot } from '../shared/chat-composer';
import type { EmailReferenceSummary } from '../shared/model';
import { MAX_MODULE_REFERENCES, moduleReferenceKey, moduleReferenceSummarySchema, type ModuleReferenceSummary } from '../shared/references';

const textKey = 'openvibedesk.chatDrafts';
const mailKey = 'openvibedesk.mailDrafts';
const referencesKey = 'openvibedesk.referenceDrafts';
const inFlightKey = 'openvibedesk.inFlightDrafts';
type Entries = Record<string, unknown>;

function object(value: unknown): Entries {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Entries : {};
}

function entries(key: string): Entries {
  try {
    const raw = localStorage.getItem(key);
    return raw ? object(JSON.parse(raw)) : {};
  } catch { return {}; }
}

function mail(value: unknown): EmailReferenceSummary | undefined {
  const item = object(value);
  if (typeof item.id !== 'string' || !item.id || item.id.length > 128 || typeof item.subject !== 'string' || typeof item.from !== 'string') return;
  return { id: item.id, subject: item.subject.slice(0, 1000), from: item.from.slice(0, 500), ...(typeof item.accountName === 'string' ? { accountName: item.accountName.slice(0, 200) } : {}) };
}

function references(value: unknown): ModuleReferenceSummary[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, ModuleReferenceSummary>();
  for (const item of value) {
    const parsed = moduleReferenceSummarySchema.safeParse(item);
    if (parsed.success) result.set(moduleReferenceKey(parsed.data), parsed.data);
    if (result.size === MAX_MODULE_REFERENCES) break;
  }
  return [...result.values()];
}

function removeEntries(key: string, ids: string[]) {
  const remaining = entries(key);
  if (!ids.some(id => Object.hasOwn(remaining, id))) return;
  for (const id of ids) delete remaining[id];
  if (Object.keys(remaining).length) localStorage.setItem(key, JSON.stringify(remaining));
  else localStorage.removeItem(key);
}

const groups = { text: textKey, mail: mailKey, references: referencesKey, requests: inFlightKey };
type Group = keyof typeof groups;

function sourceEntries(sessionId: string) {
  const result: Partial<Record<Group, unknown>> = {};
  for (const name of ['text', 'mail', 'references'] as const) {
    const map = entries(groups[name]);
    if (Object.hasOwn(map, sessionId)) result[name] = map[sessionId];
  }
  const requests = Object.entries(entries(inFlightKey)).filter(([id, raw]) => {
    const item = object(raw);
    return id.length > 0 && id.length <= 200 && item.sessionId === sessionId && item.clientRequestId === id && typeof item.text === 'string';
  });
  if (requests.length) result.requests = Object.fromEntries(requests);
  return result;
}

async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface ComposerImport {
  snapshot: ChatComposerSnapshot;
  alternative?: ChatComposerContent;
  legacyReceipt?: ChatComposerLegacyReceipt;
  cleanup?: (revision: number) => Promise<void>;
}

// Store a receipt for each legacy map. A crash between browser-key removals or
// after consuming an imported draft then leaves only recognized historical data.
export async function importLegacyChatComposer(snapshot: ChatComposerSnapshot): Promise<ComposerImport> {
  const { sessionId } = snapshot, source = sourceEntries(sessionId);
  const names = Object.keys(source) as Group[];
  if (!names.length) return { snapshot };
  const legacyReceipt = { ...snapshot.legacyReceipt };
  const fresh = { ...source };
  await Promise.all(names.map(async name => {
    legacyReceipt[name] = await fingerprint(source[name]);
    if (snapshot.legacyReceipt?.[name] === legacyReceipt[name]) delete fresh[name];
  }));

  async function cleanup(revision: number) {
    try {
      const result = await window.workspace.flushChatComposer(sessionId, revision);
      if (!result.acknowledged) return;
      const latest = sourceEntries(sessionId);
      for (const name of names) {
        if (result.snapshot.legacyReceipt?.[name] !== legacyReceipt[name] || JSON.stringify(latest[name]) !== JSON.stringify(source[name])) continue;
        const ids = name === 'requests' ? Object.keys(object(source.requests)) : [sessionId];
        removeEntries(groups[name], ids);
      }
    } catch { /* Keep the original until a confirmed host save. Cleanup resumes on reopen. */ }
  }

  if (!Object.keys(fresh).length) { await cleanup(snapshot.revision); return { snapshot }; }
  const content: ChatComposerContent = { text: typeof fresh.text === 'string' ? fresh.text : '', emailSummary: mail(fresh.mail), references: references(fresh.references) };
  const requests = Object.entries(object(fresh.requests));
  const accepted = new Set<string>();
  for (let index = 0; index < requests.length; index += 1000) {
    const ids = requests.slice(index, index + 1000).map(([id]) => id);
    for (const id of await window.workspace.committedChatRequests(ids)) accepted.add(id);
  }
  let ambiguous = false;
  for (const [id, raw] of requests.reverse()) {
    const request = object(raw);
    if (typeof request.text !== 'string') continue;
    if (accepted.has(id)) {
      // An old independent text entry has no revision tying it to this request.
      if (content.text.trim() === request.text || content.text.startsWith(request.text + '\n\n')) ambiguous = true;
      continue;
    }
    if (content.text.trim() !== request.text && !content.text.startsWith(request.text + '\n\n')) content.text = content.text.trim() ? request.text + '\n\n' + content.text : request.text;
    content.emailSummary ??= mail(request.emailSummary);
    if (typeof request.sessionRefId === 'string' && request.sessionRefId.length > 0 && request.sessionRefId.length <= 100) content.sessionRefId ??= request.sessionRefId;
    content.references = references([...references(request.references), ...(content.references ?? [])]);
  }

  const hasLegacy = !!(content.text || content.emailSummary || content.sessionRefId || content.references?.length);
  const needsDecision = ambiguous || content.text.length > MAX_COMPOSER_TEXT || (snapshot.revision > 0 && !sameSelection(content, snapshot.content));
  if (!hasLegacy || !needsDecision) {
    const result = await window.workspace.setChatComposer({ sessionId, expectedRevision: snapshot.revision, content: hasLegacy && snapshot.revision === 0 ? content : snapshot.content, legacyReceipt });
    snapshot = result.snapshot;
    if (result.applied) { await cleanup(snapshot.revision); return { snapshot }; }
  }
  return { snapshot, alternative: hasLegacy ? content : snapshot.content, legacyReceipt, cleanup };
}

function sameSelection(a: ChatComposerContent, b: ChatComposerContent) {
  return a.text === b.text && a.emailSummary?.id === b.emailSummary?.id && a.sessionRefId === b.sessionRefId
    && JSON.stringify((a.references ?? []).map(moduleReferenceKey)) === JSON.stringify((b.references ?? []).map(moduleReferenceKey));
}

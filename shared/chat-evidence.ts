import type { ToolEvent, ToolOutcome } from './model';

export type ChatEvidenceStatus = 'running' | 'completed' | 'cancelled' | 'failed' | 'limited';
export interface RecordedToolResult extends ToolEvent {
  moduleId?: string;
  /** A bounded, provider-visible result snapshot. This is untrusted data. */
  result?: string;
  truncated?: boolean;
}
export interface ChatEvidence {
  version: 1;
  capturedAt: string;
  status: ChatEvidenceStatus;
  toolsUsed: boolean;
  entries: RecordedToolResult[];
  truncated: boolean;
  omittedEntries?: number;
  outcomeCounts?: Record<ToolOutcome, number>;
}

/** Storage/evidence bounds, not agent execution or context limits. */
export const CHAT_EVIDENCE_CHAR_LIMIT = 24_000;
export const CHAT_EVIDENCE_RESULT_CHAR_LIMIT = 8_000;
const statuses = new Set<ChatEvidenceStatus>(['running', 'completed', 'cancelled', 'failed', 'limited']);
const outcomes = new Set<ToolOutcome>(['completed', 'failed', 'cancelled', 'uncertain']);
const emptyCounts = (): Record<ToolOutcome, number> => ({ completed: 0, failed: 0, cancelled: 0, uncertain: 0 });
const short = (text: string, limit: number) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, limit);
const secretKey = (key: string) => /^(?:password|passwd|apikey|authorization|accesstoken|refreshtoken|privatekey|secret|clientsecret|token|cookie|setcookie)$/i.test(key.replace(/[-_\s]/g, ''));
function redact(value: unknown, truncate: () => void, depth = 0): unknown {
  if (depth > 8) { truncate(); return '[gekürzt]'; }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') { if (value.length > CHAT_EVIDENCE_RESULT_CHAR_LIMIT) truncate(); return short(value, CHAT_EVIDENCE_RESULT_CHAR_LIMIT); }
  if (Array.isArray(value)) { if (value.length > 50) truncate(); return value.slice(0, 50).map(item => redact(item, truncate, depth + 1)); }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) => !secretKey(key));
    if (entries.length > 60 || entries.some(([key]) => key.length > 200)) truncate();
    return Object.fromEntries(entries.slice(0, 60).map(([key, item]) => [short(key, 200), redact(item, truncate, depth + 1)]));
  }
  return null;
}
function resultSnapshot(result: string): { result: string; truncated: boolean } {
  // The agent supplies the already redacted provider-visible result, never raw
  // arguments. Reapply key redaction when loading older snapshots as well.
  let safe: string, truncated = false;
  try { const parsed = JSON.parse(result); if (parsed?.truncated === true) truncated = true; safe = JSON.stringify(redact(parsed, () => { truncated = true; })); } catch { safe = short(result, CHAT_EVIDENCE_RESULT_CHAR_LIMIT); }
  truncated ||= safe.length > CHAT_EVIDENCE_RESULT_CHAR_LIMIT || result.length > CHAT_EVIDENCE_RESULT_CHAR_LIMIT;
  return { result: safe.slice(0, CHAT_EVIDENCE_RESULT_CHAR_LIMIT), truncated };
}
function bound(evidence: ChatEvidence): ChatEvidence {
  while (JSON.stringify(evidence).length > CHAT_EVIDENCE_CHAR_LIMIT) {
    const result = evidence.entries.find(entry => entry.result !== undefined);
    evidence.truncated = true;
    if (result) { delete result.result; result.truncated = true; continue; }
    if (!evidence.entries.length) break;
    // Keep failed/unknown outcomes in preference to old completed details. The
    // aggregate counts still report every outcome when metadata must be omitted.
    const completed = evidence.entries.findIndex(entry => entry.status === 'completed');
    evidence.entries.splice(completed >= 0 ? completed : 0, 1);
    evidence.omittedEntries = (evidence.omittedEntries ?? 0) + 1;
  }
  return evidence;
}
function copy(evidence: ChatEvidence): ChatEvidence {
  return { ...evidence, entries: evidence.entries.map(entry => ({ ...entry })), ...(evidence.outcomeCounts ? { outcomeCounts: { ...evidence.outcomeCounts } } : {}) };
}

/** Invalid/legacy evidence is unavailable, never permission to replay a task. */
export function normalizeChatEvidence(value: unknown): ChatEvidence | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.capturedAt !== 'string' || raw.capturedAt.length > 40 || !Number.isFinite(Date.parse(raw.capturedAt)) || !statuses.has(raw.status as ChatEvidenceStatus) || typeof raw.toolsUsed !== 'boolean' || typeof raw.truncated !== 'boolean' || !Array.isArray(raw.entries) || raw.entries.length > 500) return;
  const entries: RecordedToolResult[] = [];
  for (const rawEntry of raw.entries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return;
    const entry = rawEntry as Record<string, unknown>;
    if (typeof entry.name !== 'string' || !entry.name || !outcomes.has(entry.status as ToolOutcome) || (entry.label !== undefined && typeof entry.label !== 'string') || (entry.detail !== undefined && typeof entry.detail !== 'string') || (entry.moduleId !== undefined && typeof entry.moduleId !== 'string') || (entry.result !== undefined && typeof entry.result !== 'string') || (entry.truncated !== undefined && typeof entry.truncated !== 'boolean')) return;
    if (entry.name === 'find_modules' || entry.name === 'get_module_tools') return;
    const snapshot = typeof entry.result === 'string' ? resultSnapshot(entry.result) : undefined;
    entries.push({ name: short(entry.name, 128), status: entry.status as ToolOutcome, ...(entry.label ? { label: short(entry.label as string, 160) } : {}), ...(entry.detail ? { detail: short(entry.detail as string, 500) } : {}), ...(entry.moduleId ? { moduleId: short(entry.moduleId as string, 128) } : {}), ...(snapshot ? { result: snapshot.result } : {}), ...(entry.truncated || snapshot?.truncated ? { truncated: true } : {}) });
  }
  const counts = emptyCounts();
  if (raw.outcomeCounts !== undefined) {
    if (!raw.outcomeCounts || typeof raw.outcomeCounts !== 'object' || Array.isArray(raw.outcomeCounts)) return;
    for (const status of outcomes) {
      const count = (raw.outcomeCounts as Record<string, unknown>)[status];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < entries.filter(entry => entry.status === status).length || count > 500) return;
      counts[status] = count;
    }
  } else for (const entry of entries) counts[entry.status]++;
  if (raw.omittedEntries !== undefined && (typeof raw.omittedEntries !== 'number' || !Number.isSafeInteger(raw.omittedEntries) || raw.omittedEntries < 0 || raw.omittedEntries > 500)) return;
  if (!raw.toolsUsed && (entries.length || Object.values(counts).some(Boolean))) return;
  return bound({ version: 1, capturedAt: raw.capturedAt, status: raw.status as ChatEvidenceStatus, toolsUsed: raw.toolsUsed, entries, truncated: raw.truncated || entries.some(entry => entry.truncated === true), outcomeCounts: counts, ...(typeof raw.omittedEntries === 'number' ? { omittedEntries: raw.omittedEntries } : {}) });
}
export function isUsableChatEvidence(value: unknown): boolean {
  const evidence = normalizeChatEvidence(value);
  return !!evidence && evidence.status !== 'running';
}

export function createChatEvidenceCollector(onEvidence?: (evidence: ChatEvidence) => void) {
  const evidence: ChatEvidence = { version: 1, capturedAt: new Date().toISOString(), status: 'running', toolsUsed: false, entries: [], truncated: false, outcomeCounts: emptyCounts() };
  const emit = () => { bound(evidence); const snapshot = copy(evidence); onEvidence?.(snapshot); return snapshot; };
  return {
    start() { evidence.toolsUsed = true; return emit(); },
    record(event: ToolEvent, result?: string, moduleId?: string) {
      if (event.name === 'find_modules' || event.name === 'get_module_tools') return copy(evidence);
      evidence.toolsUsed = true;
      const snapshot = result === undefined ? undefined : resultSnapshot(result);
      evidence.entries.push({ name: short(event.name, 128), status: event.status, ...(event.label ? { label: short(event.label, 160) } : {}), ...(event.detail ? { detail: short(event.detail, 500) } : {}), ...(moduleId ? { moduleId: short(moduleId, 128) } : {}), ...(snapshot ? { result: snapshot.result, ...(snapshot.truncated ? { truncated: true } : {}) } : {}) });
      evidence.outcomeCounts![event.status]++;
      if (snapshot?.truncated) evidence.truncated = true;
      return emit();
    },
    finish(status: Exclude<ChatEvidenceStatus, 'running'>) { evidence.status = status; return emit(); },
    snapshot() { return copy(evidence); }
  };
}

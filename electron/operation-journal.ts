import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { OperationAction, OperationActionStatus, OperationBinding, OperationEffect, OperationRun, OperationRunStatus, OperationRunSummary } from '../shared/operations';

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ARGUMENT_BYTES = 16_000;
const MAX_RESULT_CHARACTERS = 8_000;
const MAX_ACTION_BYTES = 24_000;
const id = z.string().min(1).max(128);
const uuid = z.uuid();
const timestamp = z.iso.datetime();
const runStatus = z.enum(['running', 'completed', 'failed', 'cancelled', 'limited', 'uncertain']);
const actionStatus = z.enum(['prepared', 'running', 'completed', 'failed', 'cancelled', 'uncertain']);
const effectSchema = z.enum(['none', 'applied', 'unknown']);
const bindingSchema = z.object({ moduleId: id, action: z.string().min(1).max(256), fingerprint: z.string().min(1).max(256), effect: z.enum(['read', 'write', 'unknown']), resource: z.object({ id: z.string().min(1).max(1024), version: z.string().min(1).max(1024) }).strict().optional() }).strict();
const runSchema = z.object({ id: uuid, rootRunId: uuid, sessionId: id, userMessageId: id, assistantMessageId: id, status: runStatus, startedAt: timestamp, finishedAt: timestamp.optional() }).strict();
const actionSchema = z.object({ id: uuid, runId: uuid, rootRunId: uuid, binding: bindingSchema, label: z.string().min(1).max(160), argsHash: z.string().regex(/^[a-f0-9]{64}$/), args: z.record(z.string(), z.unknown()).optional(), attemptId: uuid, attempt: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), status: actionStatus, effect: effectSchema, startedAt: timestamp, finishedAt: timestamp.optional(), result: z.string().max(MAX_RESULT_CHARACTERS).optional(), resultTruncated: z.boolean().optional(), detail: z.string().max(500).optional() }).strict();
const journalSchema = z.object({ version: z.literal(1), runs: z.array(runSchema), actions: z.array(actionSchema) }).strict();
type JournalData = { version: 1; runs: OperationRun[]; actions: OperationAction[] };
type TerminalActionStatus = Exclude<OperationActionStatus, 'prepared' | 'running'>;
type TerminalRunStatus = Exclude<OperationRunStatus, 'running'>;
const secretKey = (key: string) => /^(?:password|passwd|apikey|authorization|accesstoken|refreshtoken|privatekey|secret|clientsecret|token|cookie|setcookie)$/i.test(key.replace(/[-_\s]/g, ''));
const cleanText = (text: string, limit: number) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, limit);
const copy = <T>(value: T): T => structuredClone(value);
const stateError = () => new Error('Das Aktionsprotokoll ist nicht verfügbar. Es wird keine weitere Aktion gestartet. Bitte den Speicherfehler beheben und OVD neu starten.');
const staleError = () => new Error('Dieser Aktionsversuch ist nicht mehr aktuell. Sein Ergebnis wird nicht auf einen neueren Versuch übertragen.');

/** JSON canonicalization is used for this root run only, never to deduplicate unrelated requests. */
function canonicalValue(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error('Die Aktionsargumente sind zu tief verschachtelt.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => canonicalValue(item, depth + 1));
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      if (secretKey(key)) throw new Error('Geheime Aktionsargumente werden nicht im Aktionsprotokoll gespeichert. Bitte Zugangsdaten im geschützten Einstellungsformular eingeben.');
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(descriptor, 'value')) throw new Error('Die Aktionsargumente müssen JSON-Daten sein.');
      result[key] = canonicalValue(descriptor.value, depth + 1);
    }
    return result;
  }
  throw new Error('Die Aktionsargumente müssen gültige JSON-Daten sein.');
}
function canonicalArguments(args: Record<string, unknown>): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Aktionsargumente müssen ein JSON-Objekt sein.');
  const encoded = JSON.stringify(canonicalValue(args));
  if (Buffer.byteLength(encoded, 'utf8') > MAX_ARGUMENT_BYTES) throw new Error('Die Aktionsargumente sind größer als 16 KB.');
  return encoded;
}
export function canonicalArgsHash(args: Record<string, unknown>): string { return createHash('sha256').update(canonicalArguments(args)).digest('hex'); }

function redactResult(value: unknown, truncated: () => void, depth = 0): unknown {
  if (depth > 8) { truncated(); return '[gekürzt]'; }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') { if (value.length > MAX_RESULT_CHARACTERS) truncated(); return cleanText(value, MAX_RESULT_CHARACTERS); }
  if (Array.isArray(value)) { if (value.length > 50) truncated(); return value.slice(0, 50).map(item => redactResult(item, truncated, depth + 1)); }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) => !secretKey(key));
    if (entries.length > 60) truncated();
    return Object.fromEntries(entries.slice(0, 60).map(([key, item]) => [cleanText(key, 200), redactResult(item, truncated, depth + 1)]));
  }
  return null;
}
function boundedResult(raw: string): { result: string; resultTruncated?: boolean } {
  let truncated = false, parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { result: JSON.stringify({ resultUnavailable: true, note: 'Kein strukturiertes Ergebnis gespeichert.' }), resultTruncated: true }; }
  const safe = redactResult(parsed, () => { truncated = true; });
  if (safe && typeof safe === 'object' && !Array.isArray(safe) && (safe as Record<string, unknown>).truncated === true) truncated = true;
  const serialized = JSON.stringify(safe);
  if (serialized.length <= MAX_RESULT_CHARACTERS) return { result: serialized, ...(truncated ? { resultTruncated: true } : {}) };
  const envelope = safe && typeof safe === 'object' && !Array.isArray(safe) ? Object.fromEntries(['ok', 'outcome', 'status', 'message', 'error', 'warning', 'retryBlocked', 'moduleId', 'untrusted'].filter(key => Object.hasOwn(safe, key)).map(key => [key, (safe as Record<string, unknown>)[key]]).filter(([, value]) => value === null || ['string', 'boolean', 'number'].includes(typeof value)).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 500) : value])) : {};
  let preview = serialized.slice(0, 5000);
  while (JSON.stringify({ ...envelope, truncated: true, preview }).length > MAX_RESULT_CHARACTERS) preview = preview.slice(0, Math.floor(preview.length / 2));
  return { result: JSON.stringify({ ...envelope, truncated: true, preview }), resultTruncated: true };
}

/** One serialized writer. Only acknowledged snapshots become the live journal state. */
export class OperationJournal {
  private data: JournalData | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private initialization: Promise<void> | undefined;
  private failed = false;
  private readonly file: string;
  constructor(private readonly directory: string) { this.file = path.join(directory, 'operations.json'); }

  initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.load();
    return this.initialization;
  }
  private async load(): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      let bytes: Buffer;
      try {
        const stat = await fs.lstat(this.file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error('invalid journal');
        bytes = await fs.readFile(this.file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.data = { version: 1, runs: [], actions: [] }; return; }
        throw error;
      }
      if (bytes.length > MAX_FILE_BYTES) throw new Error('oversized journal');
      const data: JournalData = journalSchema.parse(JSON.parse(bytes.toString('utf8')));
      const runs = new Map(data.runs.map(run => [run.id, run]));
      if (runs.size !== data.runs.length || new Set(data.actions.map(action => action.id)).size !== data.actions.length) throw new Error('duplicate journal IDs');
      for (const run of data.runs) {
        const root = runs.get(run.rootRunId);
        if (!root || root.id !== root.rootRunId || (run.status === 'running') === !!run.finishedAt) throw new Error('invalid run identity or lifecycle');
      }
      for (const action of data.actions) {
        const run = runs.get(action.runId);
        if (!run || run.rootRunId !== action.rootRunId || (['prepared', 'running'].includes(action.status)) === !!action.finishedAt || (action.status === 'prepared' && action.effect !== 'none')) throw new Error('invalid action identity or lifecycle');
        if (action.args && canonicalArgsHash(action.args) !== action.argsHash) throw new Error('changed action arguments');
        if (Buffer.byteLength(JSON.stringify(action), 'utf8') > MAX_ACTION_BYTES) throw new Error('oversized action');
        if (action.result !== undefined) {
          const bounded = boundedResult(action.result);
          action.result = bounded.result;
          if (bounded.resultTruncated) action.resultTruncated = true;
        }
      }
      let recovered = false;
      const now = new Date().toISOString();
      for (const action of data.actions) if (action.status === 'running') {
        action.status = 'uncertain'; action.effect = action.binding.effect === 'read' ? 'none' : 'unknown'; action.finishedAt = now;
        action.detail = 'OVD wurde während dieses Aufrufs beendet. Es wird kein weiterer Versuch automatisch gestartet.'; recovered = true;
      }
      for (const run of data.runs) if (run.status === 'running') { run.status = 'uncertain'; run.finishedAt = now; recovered = true; }
      if (recovered) await this.persist(data);
      this.data = data;
    } catch {
      this.failed = true;
      throw new Error('Das Aktionsprotokoll ist nicht lesbar oder konnte nicht sicher wiederhergestellt werden. Die vorhandene Datei bleibt erhalten; es wird keine Aktion gestartet.');
    }
  }
  private current(): JournalData { if (!this.data || this.failed) throw stateError(); return this.data; }
  private async persist(data: JournalData): Promise<void> {
    const encoded = Buffer.from(JSON.stringify(data));
    if (encoded.length > MAX_FILE_BYTES) throw new Error('Das Aktionsprotokoll hat seine Speichergrenze erreicht. Vorhandene Ausführungsnachweise bleiben erhalten; es wird keine neue Aktion gestartet.');
    const temporary = path.join(this.directory, `.operations-${randomUUID()}.tmp`);
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, this.file);
      if (process.platform !== 'win32') {
        const directory = await fs.open(this.directory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
  }
  private mutate<T>(change: (data: JournalData) => T): Promise<T> {
    const operation = this.writes.then(async () => {
      const next = copy(this.current());
      const result = change(next);
      try { await this.persist(next); }
      catch (error) {
        // A rename may already have succeeded when a later fsync fails. Do not
        // permit stale in-memory records to overwrite an unacknowledged outcome.
        this.failed = true;
        throw new Error(error instanceof Error && error.message.startsWith('Das Aktionsprotokoll') ? error.message : 'Das Aktionsprotokoll konnte nicht dauerhaft gespeichert werden. Es wird keine weitere Aktion gestartet. Bitte den Speicherfehler beheben und OVD neu starten.');
      }
      this.data = next;
      return copy(result);
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async createRun(input: { sessionId: string; userMessageId: string; assistantMessageId: string; parentRunId?: string }): Promise<OperationRun> {
    const parsed = z.object({ sessionId: id, userMessageId: id, assistantMessageId: id, parentRunId: uuid.optional() }).strict().parse(input);
    return this.mutate(data => {
      const parent = parsed.parentRunId ? data.runs.find(run => run.id === parsed.parentRunId) : undefined;
      if (parsed.parentRunId && (!parent || parent.status === 'running')) throw new Error('Der ursprüngliche Auftrag ist nicht verfügbar oder läuft noch.');
      const runId = randomUUID();
      const run: OperationRun = { id: runId, rootRunId: parent?.rootRunId ?? runId, sessionId: parsed.sessionId, userMessageId: parsed.userMessageId, assistantMessageId: parsed.assistantMessageId, status: 'running', startedAt: new Date().toISOString() };
      data.runs.push(run); return run;
    });
  }
  finishRun(runId: string, status: TerminalRunStatus): Promise<OperationRun> {
    uuid.parse(runId); runStatus.exclude(['running']).parse(status);
    return this.mutate(data => {
      const run = data.runs.find(item => item.id === runId);
      if (!run) throw new Error('Auftrag im Aktionsprotokoll nicht gefunden.');
      if (run.status === status) return run;
      if (run.status !== 'running') throw new Error('Dieser Auftrag wurde bereits abgeschlossen.');
      run.status = status; run.finishedAt = new Date().toISOString(); return run;
    });
  }
  recordIntent(runId: string, input: { binding: OperationBinding; label: string; args: Record<string, unknown> }): Promise<OperationAction> {
    uuid.parse(runId);
    const binding = bindingSchema.parse(input.binding), label = z.string().min(1).max(160).parse(input.label);
    const encoded = canonicalArguments(input.args), args = JSON.parse(encoded) as Record<string, unknown>, argsHash = createHash('sha256').update(encoded).digest('hex');
    return this.mutate(data => {
      const run = data.runs.find(item => item.id === runId);
      if (!run || run.status !== 'running') throw new Error('Der Auftrag ist nicht mehr aktiv.');
      const action: OperationAction = { id: randomUUID(), runId, rootRunId: run.rootRunId, binding, label, argsHash, args, attemptId: randomUUID(), attempt: 1, status: 'prepared', effect: 'none', startedAt: new Date().toISOString() };
      if (Buffer.byteLength(JSON.stringify(action), 'utf8') > MAX_ACTION_BYTES) throw new Error('Die Aktionsdaten sind zu groß, um sie vor der Ausführung sicher zu speichern.');
      data.actions.push(action); return action;
    });
  }
  /** Only an original run's first, undispatched intent may follow its own earlier resource update. */
  refreshPreparedBinding(actionId: string, attemptId: string, binding: OperationBinding): Promise<OperationAction> {
    uuid.parse(actionId); uuid.parse(attemptId);
    const refreshed = bindingSchema.parse(binding);
    return this.mutate(data => {
      const action = data.actions.find(item => item.id === actionId);
      if (!action || action.attemptId !== attemptId) throw staleError();
      const run = data.runs.find(item => item.id === action.runId);
      if (!run || run.status !== 'running' || run.rootRunId !== run.id || action.rootRunId !== run.id || action.attempt !== 1 || action.status !== 'prepared' || action.effect !== 'none') throw new Error('Nur ein noch nicht gestarteter erster Aktionsversuch im ursprünglichen Auftrag darf seine Ressourcenrevision aktualisieren.');
      const previous = action.binding;
      if (previous.moduleId !== refreshed.moduleId || previous.action !== refreshed.action || previous.fingerprint !== refreshed.fingerprint || previous.effect !== refreshed.effect || previous.resource?.id !== refreshed.resource?.id || !!previous.resource !== !!refreshed.resource) throw new Error('Die Modul-, Werkzeug- oder Ressourcenidentität hat sich geändert. Die vorbereitete Aktion wird nicht neu gebunden.');
      if (!action.args || canonicalArgsHash(action.args) !== action.argsHash) throw new Error('Die eingefrorenen Aktionsargumente stimmen nicht mehr mit ihrem gespeicherten Fingerabdruck überein.');
      action.binding = refreshed;
      if (Buffer.byteLength(JSON.stringify(action), 'utf8') > MAX_ACTION_BYTES) throw new Error('Die aktualisierte Ressourcenbindung ist zu groß, um sie vor der Ausführung sicher zu speichern.');
      return action;
    });
  }
  markDispatched(actionId: string, attemptId: string): Promise<OperationAction> {
    uuid.parse(actionId); uuid.parse(attemptId);
    return this.mutate(data => {
      const action = data.actions.find(item => item.id === actionId);
      if (!action || action.attemptId !== attemptId) throw staleError();
      const run = data.runs.find(item => item.id === action.runId);
      if (action.status !== 'prepared' || run?.status !== 'running') throw new Error('Dieser Aktionsversuch kann nicht mehr gestartet werden.');
      action.status = 'running'; action.effect = action.binding.effect === 'read' ? 'none' : 'unknown'; return action;
    });
  }
  finishAction(actionId: string, attemptId: string, input: { status: TerminalActionStatus; effect: OperationEffect; result?: string; detail?: string }): Promise<OperationAction> {
    uuid.parse(actionId); uuid.parse(attemptId);
    const parsed = z.object({ status: actionStatus.exclude(['prepared', 'running']), effect: effectSchema, result: z.string().optional(), detail: z.string().optional() }).strict().parse(input);
    const snapshot = parsed.result === undefined ? undefined : boundedResult(parsed.result);
    return this.mutate(data => {
      const action = data.actions.find(item => item.id === actionId);
      if (!action || action.attemptId !== attemptId) throw staleError();
      if (action.status === 'completed') {
        if (parsed.status !== 'completed' || (action.effect !== 'unknown' && action.effect !== parsed.effect)) throw new Error('Ein bereits bestätigtes Ergebnis wird nicht zurückgesetzt.');
        if (action.effect !== 'unknown') return action;
      }
      if (!['prepared', 'running'].includes(action.status) && action.effect !== 'unknown' && action.binding.effect !== 'read') {
        if (action.status !== parsed.status || action.effect !== parsed.effect) throw new Error('Dieser Aktionsversuch ist bereits abgeschlossen.');
        return action;
      }
      if (action.status === 'prepared' && parsed.effect !== 'none') throw new Error('Ein nicht gestarteter Aufruf kann keine ausgeführte Änderung bestätigen.');
      action.status = parsed.status; action.effect = action.binding.effect === 'read' ? 'none' : parsed.effect; action.finishedAt = new Date().toISOString();
      if (snapshot) { action.result = snapshot.result; if (snapshot.resultTruncated) action.resultTruncated = true; else delete action.resultTruncated; }
      if (parsed.detail !== undefined) action.detail = cleanText(parsed.detail, 500);
      if (Buffer.byteLength(JSON.stringify(action), 'utf8') > MAX_ACTION_BYTES) { delete action.result; action.resultTruncated = true; }
      return action;
    });
  }
  retryAction(actionId: string, runId: string): Promise<OperationAction> {
    uuid.parse(actionId); uuid.parse(runId);
    return this.mutate(data => {
      const action = data.actions.find(item => item.id === actionId), run = data.runs.find(item => item.id === runId);
      if (!action || !run || run.status !== 'running' || action.rootRunId !== run.rootRunId) throw new Error('Der Aktionsversuch gehört nicht zu diesem fortgesetzten Auftrag.');
      if (action.status === 'running' || action.status === 'completed' || (action.effect !== 'none' && action.binding.effect !== 'read')) throw new Error('Eine erledigte oder möglicherweise ausgeführte Aktion wird nicht wiederholt. Bitte zuerst ihren tatsächlichen Status prüfen.');
      if (!action.args) throw new Error('Die ursprünglichen Aktionsargumente sind nicht mehr verfügbar.');
      if (action.attempt >= Number.MAX_SAFE_INTEGER) throw new Error('Für diese Aktion kann keine weitere Versuchskennung vergeben werden.');
      action.runId = runId; action.attemptId = randomUUID(); action.attempt++; action.status = 'prepared'; action.effect = 'none'; action.startedAt = new Date().toISOString();
      delete action.finishedAt; delete action.result; delete action.resultTruncated; delete action.detail;
      return action;
    });
  }
  getRun(runId: string): OperationRun | undefined { const run = this.current().runs.find(item => item.id === runId); return run ? copy(run) : undefined; }
  getAction(actionId: string): OperationAction | undefined { const action = this.current().actions.find(item => item.id === actionId); return action ? copy(action) : undefined; }
  listActions(rootRunId: string): OperationAction[] { return copy(this.current().actions.filter(action => action.rootRunId === rootRunId)); }
  summary(runId: string): OperationRunSummary {
    const run = this.getRun(runId);
    if (!run) throw new Error('Auftrag im Aktionsprotokoll nicht gefunden.');
    return { run, actions: this.listActions(run.rootRunId).map(({ args: _args, result, ...action }) => ({ ...action, hasResult: result !== undefined })) };
  }
}

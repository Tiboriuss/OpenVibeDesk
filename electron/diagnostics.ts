import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { AiConfig, ChatOptions } from '../shared/model';
import type { DiagnosticsExportResult, DiagnosticsStatus } from '../shared/diagnostics';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 3;
const MAX_RECORD_BYTES = 16_384;
const MAX_TRACE_EVENTS = 800;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const eventTypes = new Set(['response.created', 'response.in_progress', 'response.completed', 'response.failed', 'response.incomplete', 'response.output_item.added', 'response.output_item.done', 'response.output_text.delta', 'response.output_text.done', 'response.refusal.delta', 'response.refusal.done', 'response.function_call_arguments.delta', 'response.function_call_arguments.done', 'response.content_part.added', 'response.content_part.done', 'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done', 'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done', 'response.reasoning_text.delta', 'response.reasoning_text.done', 'error']);
const itemTypes = new Set(['message', 'function_call', 'function_call_output', 'reasoning', 'output_text', 'input_text', 'refusal', 'summary_text', 'reasoning_text', 'function', 'chat.completion.chunk', 'chat.completion']);
const statuses = new Set(['completed', 'in_progress', 'incomplete', 'failed', 'queued', 'cancelled', 'stop', 'tool_calls', 'length', 'content_filter', 'function_call']);
const roles = new Set(['assistant', 'system', 'developer', 'tool', 'user']);
const providers = new Set(['openai-compatible', 'openai', 'azure', 'chatgpt']);
const authModes = new Set(['bearer', 'api-key', 'none']);
const diagnosticReasons = new Set(['reasoning_metadata_invalid', 'reasoning_not_completed', 'tool_structure_invalid', 'fallback_items_unfinished', 'item_index_invalid', 'item_id_invalid', 'item_type_invalid', 'item_id_changed', 'item_type_changed', 'item_id_reused', 'terminal_output_invalid', 'terminal_item_missing', 'terminal_item_type_changed', 'terminal_item_id_changed', 'message_role_changed', 'message_content_changed', 'reasoning_summary_changed', 'reasoning_encrypted_conflict', 'completed_function_call_id_changed', 'completed_function_name_changed', 'completed_function_arguments_changed', 'finalized_call_id_changed', 'finalized_call_name_changed', 'finalized_call_arguments_changed', 'event_json_invalid', 'text_after_item_done', 'duplicate_item_added', 'duplicate_item_done', 'function_item_id_changed', 'function_call_id_changed', 'function_name_changed', 'function_arguments_changed', 'function_arguments_prefix_changed', 'function_delta_without_item', 'function_delta_id_changed', 'function_arguments_after_done', 'function_arguments_done_prefix_changed', 'stream_text_changed', 'completed_call_missing', 'completed_function_arguments_prefix_changed', 'chat_tool_structure_invalid']);
const diagnosticFields = new Set(['index', 'id', 'type', 'role', 'name', 'arguments', 'tool_calls', 'function', 'summary', 'encrypted_content', 'status', 'content', 'output', 'delta']);
const errorCodes = new Set(['DeploymentNotFound', 'ResourceNotFound', 'InvalidApiKey', 'Unauthorized', 'PermissionDenied', 'BadRequest', 'InvalidRequest', 'OperationNotSupported', 'InvalidApiVersionParameter', 'AuthenticationError', 'ContentFilter', 'content_filter', 'invalid_api_key', 'invalid_request_error', 'insufficient_quota', 'rate_limit_exceeded', 'quota_exceeded', 'model_not_found', 'unsupported_parameter', 'unsupported_value', 'missing_required_parameter', 'invalid_api_version', 'context_length_exceeded']);
const appendRecord = Symbol('append sanitized diagnostic record');
const agentContext = new AsyncLocalStorage<{ agentRunId: string }>();
type LogRecord = { version: 1; at: string; sessionId: string; appVersion: string; event: string; requestId?: string; agentRunId?: string; details: Record<string, unknown> };
type FileInfo = { bytes: number; entries: number; lastEventAt?: string };
interface DiagnosticsOptions { dataDirectory: string; appVersion: string; enabled?: boolean; changed?(status: DiagnosticsStatus): void; }
export type DiagnosticField = 'index' | 'id' | 'type' | 'role' | 'name' | 'arguments' | 'tool_calls' | 'function' | 'summary' | 'encrypted_content' | 'status' | 'content' | 'output' | 'delta';
export interface DiagnosticComparison { field?: DiagnosticField; outputIndex?: unknown; expected?: unknown; actual?: unknown; }
export type AgentDiagnosticEvent = {
  phase: 'provider_turn' | 'tool_start' | 'tool_result' | 'recovery' | 'finished';
  toolRounds?: number;
  toolCalls?: number;
  name?: string;
  moduleId?: string;
  discovery?: boolean;
  status?: 'completed' | 'failed' | 'cancelled' | 'uncertain';
  policy?: 'read' | 'write' | 'unknown';
  effect?: 'none' | 'applied' | 'unknown';
  reason?: 'answer' | 'handoff' | 'cancelled' | 'limit' | 'error';
  limitReason?: 'tool_rounds' | 'tool_calls' | 'timeout';
};

/** No key or input value is ever serialized: fingerprints are keyed per process. */
export class DiagnosticsLog {
  private enabled = false;
  private options?: DiagnosticsOptions;
  private queue: Promise<void> = Promise.resolve();
  private files: FileInfo[] = [];
  private lastError?: 'storage_unavailable';
  private readonly fingerprintKey = randomBytes(32);
  private readonly sessionId = randomUUID();
  private notification?: ReturnType<typeof setTimeout>;
  private fileName(index: number) { return path.join(this.options!.dataDirectory, 'diagnostics', 'diagnostic-' + index + '.jsonl'); }
  private statusValue(): DiagnosticsStatus {
    const lastEventAt = this.files.map(file => file.lastEventAt).filter((value): value is string => !!value).sort().at(-1);
    return { enabled: this.enabled, entryCount: this.files.reduce((total, file) => total + file.entries, 0), sizeBytes: this.files.reduce((total, file) => total + file.bytes, 0), fileCount: this.files.filter(file => file.bytes > 0).length, maxFileBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES, ...(lastEventAt ? { lastEventAt } : {}), ...(this.lastError ? { lastError: this.lastError } : {}) };
  }
  private changed() {
    if (this.notification || !this.options?.changed) return;
    this.notification = setTimeout(() => { this.notification = undefined; this.options?.changed?.(this.statusValue()); }, 250);
    this.notification.unref?.();
  }
  private enqueue(operation: () => Promise<void>, reportStorageFailure = true): Promise<void> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => { if (reportStorageFailure) { this.lastError = 'storage_unavailable'; this.changed(); } });
    return result;
  }
  private async readFile(index: number): Promise<string> {
    try {
      const directory = await fs.lstat(path.dirname(this.fileName(index)));
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Invalid diagnostics directory');
      const info = await fs.lstat(this.fileName(index));
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) throw new Error('Invalid diagnostic file');
      return await fs.readFile(this.fileName(index), 'utf8');
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
  }
  private async refresh() {
    const files: FileInfo[] = [];
    for (let index = 0; index < MAX_FILES; index++) {
      const text = await this.readFile(index), lines = text.split('\n').filter(Boolean);
      let lastEventAt: string | undefined;
      for (const line of lines) { try { const value = JSON.parse(line); if (typeof value.at === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value.at)) lastEventAt = value.at; } catch { /* A damaged diagnostics line has no effect on app data. */ } }
      files.push({ bytes: Buffer.byteLength(text), entries: lines.length, ...(lastEventAt ? { lastEventAt } : {}) });
    }
    this.files = files;
  }
  async initialize(options: DiagnosticsOptions): Promise<void> {
    await this.queue;
    this.options = options; this.enabled = options.enabled === true; this.lastError = undefined;
    try { await this.refresh(); } catch { this.lastError = 'storage_unavailable'; }
    this.changed();
  }
  async setEnabled(enabled: boolean): Promise<DiagnosticsStatus> { this.enabled = enabled; await this.queue; this.changed(); return this.statusValue(); }
  async status(): Promise<DiagnosticsStatus> { await this.queue; return this.statusValue(); }
  isEnabled() { return this.enabled && !!this.options; }
  fingerprint(value: unknown): Record<string, unknown> {
    const kind = value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (value === undefined || value === null) return { kind };
    let encoded: string;
    try { encoded = typeof value === 'string' ? value : JSON.stringify(value) ?? kind; } catch { return { kind }; }
    return { kind, length: encoded.length, hash: createHmac('sha256', this.fingerprintKey).update(encoded).digest('hex').slice(0, 24) };
  }
  private token(value: unknown, allowed: Set<string>) {
    return typeof value === 'string' && allowed.has(value) ? value : this.fingerprint(value);
  }
  item(value: unknown): Record<string, unknown> {
    if (!object(value)) return this.fingerprint(value);
    const result: Record<string, unknown> = { type: this.token(value.type, itemTypes) };
    for (const key of ['id', 'call_id', 'name', 'arguments', 'encrypted_content', 'text', 'refusal', 'namespace'] as const) if (key in value) result[key] = this.fingerprint(value[key]);
    if ('status' in value) result.status = this.token(value.status, statuses);
    if ('role' in value) result.role = this.token(value.role, roles);
    for (const key of ['content', 'summary'] as const) if (key in value) result[key] = Array.isArray(value[key]) ? { count: value[key].length, parts: value[key].slice(0, 8).map(part => object(part) ? { type: this.token(part.type, itemTypes), ...('text' in part ? { text: this.fingerprint(part.text) } : {}), ...('refusal' in part ? { refusal: this.fingerprint(part.refusal) } : {}), annotations: Array.isArray(part.annotations) ? part.annotations.length : undefined } : this.fingerprint(part)) } : this.fingerprint(value[key]);
    return result;
  }
  event(value: unknown): Record<string, unknown> {
    if (!object(value)) return this.fingerprint(value);
    const result: Record<string, unknown> = { type: this.token(value.type ?? value.object, new Set([...eventTypes, ...itemTypes])) };
    for (const key of ['output_index', 'content_index', 'summary_index', 'sequence_number'] as const) if (key in value) result[key] = Number.isSafeInteger(value[key]) ? value[key] : this.fingerprint(value[key]);
    for (const key of ['item_id', 'delta', 'arguments', 'id'] as const) if (key in value) result[key] = this.fingerprint(value[key]);
    if ('item' in value) result.item = this.item(value.item);
    if (object(value.response)) result.response = this.output(value.response);
    if ('output' in value) result.output = this.output(value);
    if (Array.isArray(value.choices)) result.choices = value.choices.slice(0, 8).map(choice => object(choice) ? { index: typeof choice.index === 'number' ? choice.index : undefined, finish_reason: this.token(choice.finish_reason, statuses), ...(object(choice.delta) ? { delta: this.chatMessage(choice.delta) } : {}), ...(object(choice.message) ? { message: this.chatMessage(choice.message) } : {}) } : this.fingerprint(choice));
    if ('error' in value) result.error = object(value.error) ? { code: typeof value.error.code === 'string' && errorCodes.has(value.error.code) ? value.error.code : this.fingerprint(value.error.code), type: this.fingerprint(value.error.type) } : this.fingerprint(value.error);
    return result;
  }
  private chatMessage(value: Record<string, unknown>) {
    return { ...(value.role !== undefined ? { role: this.token(value.role, roles) } : {}), ...(value.content !== undefined ? { content: this.fingerprint(value.content) } : {}), ...(Array.isArray(value.tool_calls) ? { tool_calls: value.tool_calls.slice(0, 16).map(call => object(call) ? { index: typeof call.index === 'number' ? call.index : undefined, id: this.fingerprint(call.id), type: this.token(call.type, itemTypes), ...(object(call.function) ? { function: this.item({ ...call.function, type: 'function' }) } : {}) } : this.fingerprint(call)) } : {}) };
  }
  output(value: unknown): Record<string, unknown> {
    if (!object(value)) return this.fingerprint(value);
    return { id: this.fingerprint(value.id), status: this.token(value.status, statuses), output: Array.isArray(value.output) ? { count: value.output.length, items: value.output.slice(0, 16).map(item => this.item(item)) } : this.fingerprint(value.output), error: this.fingerprint(value.error), incomplete_details: this.fingerprint(value.incomplete_details) };
  }
  comparison(value?: DiagnosticComparison) {
    if (!value) return {};
    return { ...(value.field === 'arguments' ? { expectedJson: this.jsonFingerprint(value.expected), actualJson: this.jsonFingerprint(value.actual) } : {}), ...(value.field ? { field: diagnosticFields.has(value.field) ? value.field : this.fingerprint(value.field) } : {}), ...(value.outputIndex !== undefined ? { outputIndex: Number.isSafeInteger(value.outputIndex) ? value.outputIndex : this.fingerprint(value.outputIndex) } : {}), ...(Object.hasOwn(value, 'expected') ? { expected: this.fingerprint(value.expected) } : {}), ...(Object.hasOwn(value, 'actual') ? { actual: this.fingerprint(value.actual) } : {}) };
  }
  private jsonFingerprint(value: unknown) {
    if (typeof value !== 'string' || value.length > 32_000) return { valid: false };
    try {
      const parsed: unknown = JSON.parse(value);
      let nodes = 0;
      const canonical = (current: unknown, depth = 0): unknown => {
        if (++nodes > 4000 || depth > 20) throw new Error('JSON budget');
        if (Array.isArray(current)) return current.map(item => canonical(item, depth + 1));
        if (object(current)) return Object.fromEntries(Object.keys(current).sort().map(key => [key, canonical(current[key], depth + 1)]));
        return current;
      };
      return { valid: true, rootType: parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed, canonical: this.fingerprint(canonical(parsed)) };
    } catch { return { valid: false }; }
  }
  [appendRecord](event: string, details: Record<string, unknown>, requestId?: string): void {
    if (!this.isEnabled()) return;
    const agentRunId = agentContext.getStore()?.agentRunId;
    const record: LogRecord = { version: 1, at: new Date().toISOString(), sessionId: this.sessionId, appVersion: this.options!.appVersion, event, ...(requestId ? { requestId } : {}), ...(agentRunId ? { agentRunId } : {}), details };
    const text = JSON.stringify(record) + '\n', bytes = Buffer.byteLength(text);
    if (bytes > MAX_RECORD_BYTES) { this[appendRecord]('diagnostics.record_omitted', { sizeBytes: bytes }, requestId); return; }
    void this.enqueue(async () => {
      const directory = path.join(this.options!.dataDirectory, 'diagnostics');
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const directoryInfo = await fs.lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Invalid diagnostics directory');
      await fs.chmod(directory, 0o700);
      if (this.lastError) await this.refresh();
      const existing = await fs.lstat(this.fileName(0)).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
      if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.size > MAX_FILE_BYTES)) throw new Error('Invalid diagnostic file');
      if ((this.files[0]?.bytes ?? 0) + bytes > MAX_FILE_BYTES) {
        await fs.rm(this.fileName(MAX_FILES - 1), { force: true });
        for (let index = MAX_FILES - 2; index >= 0; index--) await fs.rename(this.fileName(index), this.fileName(index + 1)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
        this.files = [{ bytes: 0, entries: 0 }, ...this.files.slice(0, MAX_FILES - 1)];
      }
      const file = await fs.open(this.fileName(0), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await file.chmod(0o600); await file.writeFile(text); } finally { await file.close(); }
      const current = this.files[0] ?? { bytes: 0, entries: 0 };
      this.files[0] = { bytes: current.bytes + bytes, entries: current.entries + 1, lastEventAt: record.at };
      this.lastError = undefined; this.changed();
    }).catch(() => { /* Logging failure is visible in status, never in a provider outcome. */ });
  }
  async clear(): Promise<DiagnosticsStatus> {
    await this.enqueue(async () => {
      if (!this.options) return;
      const directory = await fs.lstat(path.dirname(this.fileName(0))).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
      if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) throw new Error('Invalid diagnostics directory');
      for (let index = 0; index < MAX_FILES; index++) await fs.rm(this.fileName(index), { force: true });
      this.files = []; this.lastError = undefined; this.changed();
    }).catch(() => { throw new Error('Die Diagnoseprotokolle konnten nicht gelöscht werden. Bitte Schreibrechte prüfen.'); });
    return this.statusValue();
  }
  async export(destination: string): Promise<DiagnosticsExportResult> {
    let result: DiagnosticsExportResult = { cancelled: false };
    await this.enqueue(async () => {
      if (!this.options) throw new Error('Diagnostic store is not initialized');
      const records: unknown[] = [];
      try {
        for (let index = MAX_FILES - 1; index >= 0; index--) for (const line of (await this.readFile(index)).split('\n')) {
          if (!line) continue;
          try { const record = JSON.parse(line); if (object(record) && record.version === 1 && typeof record.at === 'string' && typeof record.event === 'string' && object(record.details)) records.push(record); } catch { /* Skip incomplete diagnostic records. */ }
        }
      } catch (error) { this.lastError = 'storage_unavailable'; this.changed(); throw error; }
      const text = JSON.stringify({ format: 'openvibedesk-diagnostics', version: 1, exportedAt: new Date().toISOString(), application: { version: this.options.appVersion, platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron ?? null }, privacy: 'Protocol structure, lengths and per-process keyed fingerprints only; no message content or credentials.', records }, null, 2);
      const parent = await fs.realpath(path.dirname(path.resolve(destination)));
      const resolved = path.join(parent, path.basename(destination));
      const profile = await fs.realpath(this.options.dataDirectory).catch(() => path.resolve(this.options!.dataDirectory));
      if (resolved === profile || resolved.startsWith(profile + path.sep)) throw new Error('App profile is not an export destination');
      const existing = await fs.lstat(resolved).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Invalid export destination');
      const temporary = path.join(parent, '.ovd-diagnostics-' + randomUUID() + '.tmp');
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
        await fs.rename(temporary, resolved);
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      result = { cancelled: false, fileName: path.basename(resolved), entryCount: records.length, sizeBytes: Buffer.byteLength(text) };
    }, false).catch(() => { throw new Error('Das Diagnoseprotokoll konnte nicht exportiert werden. Bitte Speicherort und Schreibrechte prüfen.'); });
    return result;
  }
}

const diagnosticsLog = new DiagnosticsLog();
export const initializeDiagnostics = (options: DiagnosticsOptions) => diagnosticsLog.initialize(options);
export const setDiagnosticsEnabled = (enabled: boolean) => diagnosticsLog.setEnabled(enabled);
export const getDiagnosticsStatus = () => diagnosticsLog.status();
export const clearDiagnostics = () => diagnosticsLog.clear();
export const exportDiagnostics = (destination: string) => diagnosticsLog.export(destination);

/** Correlates host activity and provider requests without recording chat IDs or content. */
export class AgentDiagnosticsTrace {
  private readonly agentRunId = randomUUID();
  private readonly active = diagnosticsLog.isEnabled();
  private readonly started = Date.now();
  run<T>(work: () => Promise<T>): Promise<T> {
    return agentContext.run({ agentRunId: this.agentRunId }, async () => {
      if (this.active) diagnosticsLog[appendRecord]('agent.started', {});
      return work();
    });
  }
  progress(event: AgentDiagnosticEvent): void {
    if (!this.active || !diagnosticsLog.isEnabled() || !['provider_turn', 'tool_start', 'tool_result', 'recovery', 'finished'].includes(event.phase)) return;
    const details: Record<string, unknown> = { elapsedMs: Math.max(0, Date.now() - this.started) };
    for (const key of ['toolRounds', 'toolCalls'] as const) if (Number.isSafeInteger(event[key]) && event[key]! >= 0) details[key] = event[key];
    for (const key of ['name', 'moduleId'] as const) if (typeof event[key] === 'string') details[key] = diagnosticsLog.fingerprint(event[key]);
    if (typeof event.discovery === 'boolean') details.discovery = event.discovery;
    const allowed = {
      status: ['completed', 'failed', 'cancelled', 'uncertain'], policy: ['read', 'write', 'unknown'],
      effect: ['none', 'applied', 'unknown'], reason: ['answer', 'handoff', 'cancelled', 'limit', 'error'],
      limitReason: ['tool_rounds', 'tool_calls', 'timeout']
    };
    for (const key of Object.keys(allowed) as (keyof typeof allowed)[]) if (typeof event[key] === 'string' && allowed[key].includes(event[key]!)) details[key] = event[key];
    agentContext.run({ agentRunId: this.agentRunId }, () => diagnosticsLog[appendRecord]('agent.' + event.phase, details));
  }
}
export const beginAgentDiagnostics = () => new AgentDiagnosticsTrace();

/** Each transport turn gets a separate ID; no chat identifiers enter the log. */
export class ProviderDiagnosticsTrace {
  private readonly requestId = randomUUID();
  private readonly active = diagnosticsLog.isEnabled();
  private readonly started = Date.now();
  private events = 0;
  private omittedEvents = 0;
  private ended = false;
  constructor(config: AiConfig, options: ChatOptions, protocol: 'responses' | 'chat-completions', transport: 'stream' | 'complete', inputCount: number, toolCount: number) {
    if (!this.active) return;
    const model = options.tier === 'smart' ? config.smartModel : config.simpleModel;
    let route: Record<string, unknown> = { valid: false };
    try { const url = new URL(config.baseUrl); route = { valid: true, scheme: url.protocol === 'https:' ? 'https' : url.protocol === 'http:' ? 'http' : 'other', origin: diagnosticsLog.fingerprint(url.origin), kind: /\/openai\/deployments\//i.test(url.pathname) ? 'azure-deployment' : /\/openai\/v1\/?$/i.test(url.pathname) ? 'azure-v1' : /\/v1\/?$/i.test(url.pathname) ? 'v1' : 'custom', hasQuery: !!url.search, pathSegments: url.pathname.split('/').filter(Boolean).length }; } catch { /* Invalid connection is diagnosed without copying its value. */ }
    diagnosticsLog[appendRecord]('provider.request', { provider: providers.has(config.provider ?? '') ? config.provider : 'openai-compatible', protocol, transport, route, model: diagnosticsLog.fingerprint(model), ...(/^(?:gpt|o[1-9]|sol|codex)[A-Za-z0-9._:-]{0,100}$/.test(model) ? { modelName: model } : {}), modelFamily: /sol/i.test(model) ? 'sol' : /gpt/i.test(model) ? 'gpt' : 'other', tier: options.tier === 'simple' ? 'simple' : 'smart', thinking: ['off', 'low', 'medium', 'high'].includes(options.tier === 'smart' ? config.smartThinking : config.simpleThinking) ? options.tier === 'smart' ? config.smartThinking : config.simpleThinking : 'other', authMode: authModes.has(config.authMode ?? '') ? config.authMode : 'bearer', apiVersion: diagnosticsLog.fingerprint(config.apiVersion), ...(/^\d{4}-\d\d-\d\d(?:-preview)?$/.test(config.apiVersion ?? '') ? { apiVersionName: config.apiVersion } : {}), inputCount, toolCount }, this.requestId);
  }
  private write(event: string, details: Record<string, unknown>) { if (this.active && diagnosticsLog.isEnabled()) diagnosticsLog[appendRecord](event, details, this.requestId); }
  response(response: Response) {
    if (!this.active || !diagnosticsLog.isEnabled()) return;
    const requestIds: Record<string, unknown> = {};
    for (const name of ['x-request-id', 'apim-request-id', 'x-ms-request-id']) { const value = response.headers.get(name); if (value) requestIds[name] = /^(?:req_[a-zA-Z0-9]{8,100}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$/.test(value) ? value : diagnosticsLog.fingerprint(value); }
    const contentType = response.headers.get('content-type')?.split(';')[0];
    this.write('provider.http', { status: response.status, contentType: contentType === 'text/event-stream' || contentType === 'application/json' ? contentType : 'other', contentLength: /^\d{1,10}$/.test(response.headers.get('content-length') ?? '') ? Number(response.headers.get('content-length')) : undefined, requestIds });
  }
  event(value: unknown) { if (!this.active || this.ended || !diagnosticsLog.isEnabled()) return; const terminal = object(value) && (['response.completed', 'response.failed', 'response.incomplete', 'error'].includes(String(value.type)) || Array.isArray(value.choices) && value.choices.some(choice => object(choice) && choice.finish_reason != null)); if (++this.events > MAX_TRACE_EVENTS && !terminal) { this.omittedEvents++; return; } this.write('provider.event', diagnosticsLog.event(value)); }
  failure(reason: string, comparison?: DiagnosticComparison) { if (!this.active || !diagnosticsLog.isEnabled()) return; this.write('provider.protocol_failure', { reason: diagnosticReasons.has(reason) ? reason : 'unrecognized_protocol_failure', ...(!diagnosticReasons.has(reason) ? { reasonSignature: diagnosticsLog.fingerprint(reason) } : {}), ...diagnosticsLog.comparison(comparison) }); }
  finish(textLength: number, toolCount: number, wireBytes?: number) { if (this.ended) return; this.ended = true; this.write('provider.completed', { elapsedMs: Date.now() - this.started, textLength, toolCount, events: this.events, omittedEvents: this.omittedEvents, ...(wireBytes !== undefined ? { wireBytes } : {}) }); }
  error(error: unknown, signal?: AbortSignal, timeout?: AbortSignal) {
    if (this.ended) return; this.ended = true;
    if (!this.active || !diagnosticsLog.isEnabled()) return;
    const source = object(error) || error instanceof Error ? error as Record<string, unknown> : {};
    const diagnostic = object(source.diagnostics) ? source.diagnostics : {};
    const errorType = typeof source.name === 'string' && ['ToolStreamError', 'ProviderHttpError', 'ChatGptAuthError', 'AbortError', 'TypeError', 'Error'].includes(source.name) ? source.name : 'other';
    this.write('provider.failed', { elapsedMs: Date.now() - this.started, kind: signal?.aborted ? 'cancelled' : timeout?.aborted ? 'timeout' : errorType, errorMessage: diagnosticsLog.fingerprint(source.message), ...(typeof source.httpStatus === 'number' ? { httpStatus: source.httpStatus } : {}), ...(typeof source.code === 'string' ? { code: errorCodes.has(source.code) ? source.code : diagnosticsLog.fingerprint(source.code) } : {}), ...(typeof source.requestId === 'string' ? { providerRequestId: diagnosticsLog.fingerprint(source.requestId) } : {}), ...(typeof diagnostic.reason === 'string' && ['finish', 'metadata', 'arguments', 'duplicate_ids', 'structure', 'size'].includes(diagnostic.reason) ? { toolFailure: diagnostic.reason } : {}), ...(typeof diagnostic.field === 'string' && ['tool_calls', 'index', 'type', 'id', 'function', 'name', 'arguments'].includes(diagnostic.field) ? { field: diagnostic.field } : {}), events: this.events, omittedEvents: this.omittedEvents });
  }
}
export const beginProviderDiagnostics = (config: AiConfig, options: ChatOptions, protocol: 'responses' | 'chat-completions', transport: 'stream' | 'complete', inputCount: number, toolCount: number) => new ProviderDiagnosticsTrace(config, options, protocol, transport, inputCount, toolCount);

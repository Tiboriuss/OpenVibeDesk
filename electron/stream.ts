import type { AiConfig, ChatOptions } from '../shared/model';

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type ProviderMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
export type StreamTurn = { text: string; toolCalls: ToolCall[] };
type ToolCallField = 'tool_calls' | 'index' | 'type' | 'id' | 'function' | 'name' | 'arguments';
export type ToolStreamDiagnostics = { reason: 'finish' | 'metadata' | 'arguments' | 'duplicate_ids' | 'structure' | 'size'; field?: ToolCallField; callIndex?: number; observedLength?: number; limit?: number; finishReason?: string; callCount: number; missingIds: number; missingNames: number; emptyArguments: number };
/** Protocol details intentionally contain no arguments, mail content, keys or provider payloads. */
export class ToolStreamError extends Error {
  constructor(readonly diagnostics: ToolStreamDiagnostics, readonly transport: 'stream' | 'complete' = 'stream') {
    const explanation = { finish: 'Der Abschluss der Werkzeugantwort fehlt oder wurde abgebrochen.', metadata: 'Name oder Kennung eines Werkzeugaufrufs fehlen.', arguments: 'Die Werkzeugargumente sind nicht vollständig als JSON angekommen.', duplicate_ids: 'Mehrere Werkzeugaufrufe haben dieselbe Kennung.', structure: `Das Feld „${diagnostics.field ?? 'tool_calls'}“ hat ein ungültiges Format.`, size: `Das Feld „${diagnostics.field}“ von Aufruf ${(diagnostics.callIndex ?? 0) + 1} umfasst ${diagnostics.observedLength} Zeichen (Grenze: ${diagnostics.limit}).` }[diagnostics.reason];
    const kind = diagnostics.reason === 'size' ? 'zu große' : diagnostics.reason === 'structure' ? 'ungültige' : 'unvollständige';
    super(`Der Endpunkt hat${transport === 'complete' ? ' auch ohne Streaming' : ''} ${kind} Werkzeugaufrufe geliefert. ${explanation} Es wurde kein Aufruf dieser Antwort ausgeführt.`);
    this.name = 'ToolStreamError';
  }
}

function toolCallError(reason: ToolStreamDiagnostics['reason'], calls: readonly ToolCall[], finishReason?: string, transport: 'stream' | 'complete' = 'stream', field?: ToolCallField, size?: Pick<ToolStreamDiagnostics, 'callIndex' | 'observedLength' | 'limit'>): ToolStreamError {
  return new ToolStreamError({ reason, ...(field ? { field } : {}), ...size, ...(finishReason ? { finishReason } : {}), callCount: calls.length, missingIds: calls.filter(call => !call.id).length, missingNames: calls.filter(call => !call.function.name).length, emptyArguments: calls.filter(call => !call.function.arguments.trim()).length }, transport);
}

function validateToolCallSize(call: ToolCall, callIndex: number, calls: readonly ToolCall[], finishReason?: string, transport: 'stream' | 'complete' = 'stream'): void {
  const fields = [{ field: 'id', value: call.id, limit: 200 }, { field: 'name', value: call.function.name, limit: 128 }, { field: 'arguments', value: call.function.arguments, limit: 16_000 }] as const;
  for (const { field, value, limit } of fields) if (value.length > limit) {
    throw toolCallError('size', calls, finishReason, transport, field, { callIndex, observedLength: value.length, limit });
  }
}

type DeclaredTool = { required: string[]; parameterless: boolean };
function declaredToolSchemas(tools?: readonly unknown[]): Map<string, DeclaredTool> {
  const declared = new Map<string, DeclaredTool>();
  for (const raw of tools ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const fn = (raw as { function?: { name?: unknown; parameters?: { type?: unknown; properties?: unknown; required?: unknown; patternProperties?: unknown; additionalProperties?: unknown } } }).function;
    if (typeof fn?.name === 'string') {
      const schema = fn.parameters;
      const required = Array.isArray(schema?.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
      const properties = schema?.properties;
      const parameterless = schema?.type === 'object' && !!properties && typeof properties === 'object' && !Array.isArray(properties) && Object.keys(properties).length === 0 && required.length === 0 && schema.patternProperties === undefined && schema.additionalProperties !== true && typeof schema.additionalProperties !== 'object';
      declared.set(fn.name, { required, parameterless });
    }
  }
  return declared;
}
function validateToolCalls(toolCalls: ToolCall[], finishReason: string | undefined, complete: boolean, tools?: readonly unknown[], transport: 'stream' | 'complete' = 'stream'): void {
  const declaredTools = declaredToolSchemas(tools);
  const fail = (reason: ToolStreamDiagnostics['reason']): never => { throw toolCallError(reason, toolCalls, finishReason, transport); };
  if (finishReason !== 'tool_calls' && finishReason !== 'stop' && !(transport === 'stream' && complete && finishReason === undefined)) fail('finish');
  if (toolCalls.some(call => !call.id || !call.function.name)) fail('metadata');
  if (new Set(toolCalls.map(call => call.id)).size !== toolCalls.length) fail('duplicate_ids');
  for (const call of toolCalls) {
    const declared = declaredTools.get(call.function.name);
    // Optional parameters still carry choices (for example a target ID). An
    // empty stream is not evidence that the model deliberately chose defaults.
    if (!call.function.arguments.trim() && declared?.parameterless) call.function.arguments = '{}';
    let args: unknown;
    try { args = JSON.parse(call.function.arguments); } catch { fail('arguments'); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) fail('arguments');
    // A compatibility finish marker and the complete-response fallback both need
    // an offered tool with every required top-level field before any effect.
    if ((finishReason !== 'tool_calls' || transport === 'complete') && (!declared || declared.required.some(key => !Object.hasOwn(args as object, key)))) fail('arguments');
  }
}

/** Fetch one complete turn; this never executes a tool or retries another request. */
export async function requestCompleteTurn(
  config: AiConfig, key: string | null, messages: ProviderMessage[], options: ChatOptions,
  signal: AbortSignal, tools?: readonly unknown[], requestTimeoutMs = 60_000
): Promise<StreamTurn> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), requestTimeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const model = options.tier === 'smart' ? config.smartModel : config.simpleModel;
    const thinking = options.tier === 'smart' ? config.smartThinking : config.simpleThinking;
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.any([signal, timeout.signal]),
      body: JSON.stringify({ model, messages, stream: false, ...(tools?.length ? { tools } : {}), ...(thinking === 'off' ? {} : { reasoning_effort: thinking }) })
    });
    if (!response.ok) throw new Error(`Der Endpunkt hat auch ohne Streaming die Anfrage abgelehnt (HTTP ${response.status}).`);
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > 4_000_000) throw new Error('Die vollständige Antwort des Endpunkts ist zu groß.');
    if (!response.body) throw new Error('Der Endpunkt hat auch ohne Streaming keine Antwort geliefert.');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 4_000_000) throw new Error('Die vollständige Antwort des Endpunkts ist zu groß.');
      chunks.push(next.value);
    }
    signal.throwIfAborted();
    let result: any;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Der Endpunkt hat auch ohne Streaming keine gültige JSON-Antwort geliefert.'); }
    if (result?.error) throw new Error('Der Endpunkt meldet auch ohne Streaming einen Fehler.');
    const choice = result?.choices?.[0];
    if (!choice || typeof choice !== 'object' || (choice.finish_reason !== undefined && choice.finish_reason !== null && typeof choice.finish_reason !== 'string')) throw new Error('Der Endpunkt hat auch ohne Streaming keine gültige Antwort geliefert.');
    const message = choice.message;
    if (!message || typeof message !== 'object' || Array.isArray(message) || (message.role !== undefined && message.role !== 'assistant')) throw new Error('Der Endpunkt hat auch ohne Streaming keine gültige Assistentenantwort geliefert.');
    if (message.content !== undefined && message.content !== null && typeof message.content !== 'string') throw new Error('Der Endpunkt hat auch ohne Streaming ein nicht unterstütztes Textformat geliefert.');
    const text: string = message.content ?? '';
    if (text.length > 200_000) throw new Error('Die vollständige Antwort des Endpunkts ist zu groß.');
    const rawCalls = message.tool_calls ?? [];
    const toolCalls: ToolCall[] = [];
    const invalid = (field: ToolCallField): never => { throw toolCallError('structure', toolCalls, choice.finish_reason ?? undefined, 'complete', field); };
    if (!Array.isArray(rawCalls) || (rawCalls.length && !tools?.length)) invalid('tool_calls');
    // Transport byte bounds limit parsing; execution budgets belong to the agent.
    for (const [index, call] of rawCalls.entries()) {
      if (!call || typeof call !== 'object' || Array.isArray(call)) invalid('tool_calls');
      if (call.type !== undefined && call.type !== 'function') invalid('type');
      if (call.id !== undefined && typeof call.id !== 'string') invalid('id');
      if (!call.function || typeof call.function !== 'object' || Array.isArray(call.function)) invalid('function');
      if (call.function.name !== undefined && typeof call.function.name !== 'string') invalid('name');
      if (call.function.arguments !== undefined && call.function.arguments !== null && typeof call.function.arguments !== 'string') invalid('arguments');
      const normalized: ToolCall = { id: call.id ?? '', type: 'function', function: { name: call.function.name ?? '', arguments: call.function.arguments ?? '' } };
      toolCalls.push(normalized);
      validateToolCallSize(normalized, index, toolCalls, choice.finish_reason ?? undefined, 'complete');
    }
    const finishReason: string | undefined = choice.finish_reason ?? undefined;
    if (toolCalls.length) validateToolCalls(toolCalls, finishReason, false, tools, 'complete');
    else if (finishReason !== 'stop' || !text.trim()) throw new Error('Der Endpunkt hat auch ohne Streaming keine vollständig abgeschlossene Antwort geliefert.');
    return { text, toolCalls };
  } catch (error) {
    if (signal.aborted) throw new DOMException('Generierung abgebrochen.', 'AbortError');
    if (timeout.signal.aborted) throw new Error('Der Endpunkt hat auch ohne Streaming nicht rechtzeitig geantwortet.');
    if (error instanceof Error && (error.message.startsWith('Der Endpunkt') || error.message.startsWith('Die vollständige'))) throw error;
    throw new Error('Die vollständige Antwort des Endpunkts konnte nicht geladen werden. Bitte Verbindung prüfen.');
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => {});
  }
}

/** A text-only stream, retained for providers and callers that do not use tools. */
export async function streamCompletion(
  config: AiConfig, key: string | null, messages: ProviderMessage[], options: ChatOptions,
  signal: AbortSignal, onDelta: (text: string) => void, requestTimeoutMs = 60_000
): Promise<string> {
  return (await streamTurn(config, key, messages, options, signal, onDelta, undefined, requestTimeoutMs)).text;
}

/** Assemble a complete streaming turn before returning any tool calls for execution. */
export async function streamTurn(
  config: AiConfig, key: string | null, messages: ProviderMessage[], options: ChatOptions,
  signal: AbortSignal, onDelta: (text: string) => void, tools?: readonly unknown[], requestTimeoutMs = 60_000
): Promise<StreamTurn> {
  const timeout = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => timeout.abort(), requestTimeoutMs); };
  resetTimer();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const model = options.tier === 'smart' ? config.smartModel : config.simpleModel;
    const thinking = options.tier === 'smart' ? config.smartThinking : config.simpleThinking;
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.any([signal, timeout.signal]),
      body: JSON.stringify({ model, messages, stream: true, ...(tools?.length ? { tools } : {}), ...(thinking === 'off' ? {} : { reasoning_effort: thinking }) })
    });
    if (!response.ok) throw new Error(`Der Endpunkt hat die Anfrage abgelehnt (HTTP ${response.status}).${thinking !== 'off' ? ' Prüfe Modell und Thinking-Einstellung.' : ''}`);
    if (!response.body) throw new Error('Der Endpunkt hat keine Antwort geliefert.');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let line = '', pendingCR = false, data: string[] = [], eventSize = 0, wireSize = 0;
    let answer = '', complete = false, finishReason: string | undefined;
    const calls = new Map<number, ToolCall>();
    const invalid = (field: ToolCallField): never => { throw toolCallError('structure', [...calls.values()], finishReason, 'stream', field); };
    // Some compatible endpoints repeat metadata or send cumulative snapshots.
    // Argument deltas still append verbatim, including repeated characters inside strings.
    function appendMetadata(current: string, part: string): string {
      if (!part || current === part) return current;
      return current && part.startsWith(current) ? part : current + part;
    }
    function appendArguments(current: string, part: string): string {
      if (!part) return current;
      return current && current.trimStart().startsWith('{') && part.trimStart().startsWith('{') && part.startsWith(current) ? part : current + part;
    }

    function dispatch() {
      if (!data.length || complete) { data = []; eventSize = 0; return; }
      const value = data.join('\n'); data = []; eventSize = 0;
      if (value.trim() === '[DONE]') { complete = true; return; }
      let parsed: any;
      try { parsed = JSON.parse(value); } catch { throw new Error('Der Endpunkt hat ungültige Streaming-Daten geliefert.'); }
      if (parsed?.error) throw new Error('Der Endpunkt meldet einen Fehler beim Streaming.');
      const choice = parsed?.choices?.[0];
      if (choice?.finish_reason != null) {
        if (typeof choice.finish_reason !== 'string') throw new Error('Der Endpunkt hat ungültige Streaming-Daten geliefert.');
        finishReason = choice.finish_reason;
      }
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta) {
        answer += delta;
        if (answer.length > 200_000) throw new Error('Die Antwort des Endpunkts ist zu groß.');
        onDelta(delta);
        if (signal.aborted) throw new DOMException('Generierung abgebrochen.', 'AbortError');
      } else if (delta !== undefined && delta !== null && typeof delta !== 'string') throw new Error('Der Endpunkt hat ein nicht unterstütztes Textformat geliefert.');
      const fragments = choice?.delta?.tool_calls;
      if (fragments !== undefined) {
        if (!Array.isArray(fragments) || (fragments.length && !tools?.length)) invalid('tool_calls');
        for (const fragment of fragments) {
          if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment) || !Number.isSafeInteger(fragment.index) || fragment.index < 0) invalid('index');
          const call = calls.get(fragment.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
          if (fragment.type !== undefined && fragment.type !== null && fragment.type !== 'function') invalid('type');
          if (fragment.id !== undefined && fragment.id !== null) { if (typeof fragment.id !== 'string') invalid('id'); call.id = appendMetadata(call.id, fragment.id); }
          if (fragment.function !== undefined && fragment.function !== null) {
            if (!fragment.function || typeof fragment.function !== 'object' || Array.isArray(fragment.function)) invalid('function');
            if (fragment.function.name !== undefined && fragment.function.name !== null) { if (typeof fragment.function.name !== 'string') invalid('name'); call.function.name = appendMetadata(call.function.name, fragment.function.name); }
            if (fragment.function.arguments !== undefined && fragment.function.arguments !== null) { if (typeof fragment.function.arguments !== 'string') invalid('arguments'); call.function.arguments = appendArguments(call.function.arguments, fragment.function.arguments); }
          }
          if (call.id || call.function.name || call.function.arguments) calls.set(fragment.index, call);
          validateToolCallSize(call, fragment.index, [...calls.values()], finishReason);
        }
      }
    }
    function processLine(value: string) {
      if (!value) { dispatch(); return; }
      if (value.startsWith(':')) return;
      const colon = value.indexOf(':');
      const field = colon === -1 ? value : value.slice(0, colon);
      let fieldValue = colon === -1 ? '' : value.slice(colon + 1);
      if (fieldValue.startsWith(' ')) fieldValue = fieldValue.slice(1);
      if (field === 'data') { eventSize += fieldValue.length; if (eventSize > 1_000_000) throw new Error('Die Antwort des Endpunkts ist zu groß.'); data.push(fieldValue); }
    }
    function consume(text: string) {
      for (const char of text) {
        if (pendingCR) { pendingCR = false; if (char === '\n') continue; }
        if (char === '\r') { processLine(line); line = ''; pendingCR = true; }
        else if (char === '\n') { processLine(line); line = ''; }
        else { line += char; if (line.length > 1_000_000) throw new Error('Die Antwort des Endpunkts ist zu groß.'); }
        if (complete) return;
      }
    }
    while (!complete) {
      const next = await reader.read();
      if (next.done) { consume(decoder.decode()); if (line) processLine(line); dispatch(); break; }
      resetTimer();
      wireSize += next.value.byteLength;
      if (wireSize > 4_000_000) throw new Error('Die Antwort des Endpunkts ist zu groß.');
      consume(decoder.decode(next.value, { stream: true }));
    }
    if (!complete && !finishReason) throw new Error('Die Streaming-Antwort wurde vorzeitig beendet.');
    const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (toolCalls.length) validateToolCalls(toolCalls, finishReason, complete, tools);
    else if (finishReason === 'tool_calls' || !answer.trim()) throw new Error('Der Endpunkt hat keine lesbare Textantwort geliefert.');
    return { text: answer, toolCalls };
  } catch (error) {
    if (signal.aborted) throw new DOMException('Generierung abgebrochen.', 'AbortError');
    if (timeout.signal.aborted) throw new Error('Der Endpunkt hat nicht rechtzeitig geantwortet.');
    if (error instanceof Error && (error.message.startsWith('Der Endpunkt') || error.message.startsWith('Die Antwort') || error.message.startsWith('Die Streaming-Antwort'))) throw error;
    throw new Error('Die Verbindung zum Endpunkt ist fehlgeschlagen. Bitte URL und Erreichbarkeit prüfen.');
  } finally {
    clearTimeout(timer!);
    if (reader) await reader.cancel().catch(() => {});
  }
}

import type { AiConfig, ChatOptions } from '../shared/model';
import { providerEndpoint, providerHeaders, providerHttpError, providerReportedError } from './ai-provider';
import { chatGptAuth } from './chatgpt-auth';
import { beginProviderDiagnostics, type DiagnosticComparison, type ProviderDiagnosticsTrace } from './diagnostics';
import { toolCallError, validateToolCalls, validateToolCallSize, type ProviderMessage, type ResponseInputItem, type StreamTurn, type ToolCall } from './stream';

const MAX_WIRE_BYTES = 4_000_000;
const MAX_TEXT_CHARS = 200_000;
type Transport = 'stream' | 'complete';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function reasoningContinuation(item: Record<string, unknown>, diagnostics?: ProviderDiagnosticsTrace) {
  const invalid = (field: 'encrypted_content' | 'id' | 'summary'): never => { diagnostics?.failure('reasoning_metadata_invalid', { field, actual: item[field] }); throw new Error('Der Endpunkt hat ungültige Responses-Fortsetzungsdaten geliefert.'); };
  if (item.encrypted_content !== undefined && item.encrypted_content !== null && typeof item.encrypted_content !== 'string') return invalid('encrypted_content');
  if (item.id !== undefined && typeof item.id !== 'string') return invalid('id');
  if (item.status !== undefined && item.status !== null && item.status !== 'completed') { diagnostics?.failure('reasoning_not_completed', { field: 'status', actual: item.status }); throw new Error('Der Endpunkt hat keine vollständig abgeschlossenen Responses-Fortsetzungsdaten geliefert.'); }
  const summary = item.summary ?? [];
  if (!Array.isArray(summary) || summary.some(part => !record(part) || part.type !== 'summary_text' || typeof part.text !== 'string')) return invalid('summary');
  return { type: 'reasoning', summary: summary.map(part => ({ type: 'summary_text', text: part.text as string })), ...(item.id ? { id: item.id as string } : {}), ...(item.encrypted_content ? { encrypted_content: item.encrypted_content as string } : {}) };
}

/** Replay only this run's validated output. No server-side conversation or tools. */
function responseInput(messages: ProviderMessage[], directChatGpt = false): ResponseInputItem[] {
  return messages.flatMap((message): ResponseInputItem[] => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    if (message.role === 'assistant' && message.responseItems) return message.responseItems;
    const items: ResponseInputItem[] = message.content ? [{ role: directChatGpt && message.role === 'system' ? 'developer' : message.role, content: message.content }] : [];
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) {
      items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...(directChatGpt ? { namespace: 'ovd' } : {}) });
    }
    return items;
  });
}

function responseBody(config: AiConfig, messages: ProviderMessage[], options: ChatOptions, stream: boolean, tools?: readonly unknown[]) {
  const model = options.tier === 'smart' ? config.smartModel : config.simpleModel;
  const thinking = options.tier === 'smart' ? config.smartThinking : config.simpleThinking;
  const functions = tools?.map(raw => {
    if (!record(raw) || raw.type !== 'function' || !record(raw.function) || typeof raw.function.name !== 'string') throw new Error('Der Endpunkt kann nur die angebotenen Funktionswerkzeuge verwenden.');
    return { type: 'function', ...raw.function, strict: false };
  });
  return {
    model, input: responseInput(messages, config.provider === 'chatgpt'), stream, store: false,
    ...(config.provider === 'chatgpt' ? {} : { truncation: 'disabled' }),
    include: ['reasoning.encrypted_content'],
    ...(functions?.length ? { tools: config.provider === 'chatgpt' ? [{ type: 'namespace', name: 'ovd', description: 'OpenVibeDesk workspace functions selected for this request.', tools: functions }] : functions } : {}),
    ...(thinking === 'off' ? {} : { reasoning: { effort: thinking } })
  };
}

function parseOutput(value: unknown, tools: readonly unknown[] | undefined, transport: Transport, directChatGpt = false, diagnostics?: ProviderDiagnosticsTrace): StreamTurn {
  if (!record(value)) throw new Error('Der Endpunkt hat keine gültige Responses-Antwort geliefert.');
  const output = value.output;
  if (!Array.isArray(output)) throw new Error('Der Endpunkt hat keine gültige Responses-Ausgabe geliefert.');
  const toolCalls: ToolCall[] = [], responseItems: ResponseInputItem[] = [];
  const invalid = (field: 'tool_calls' | 'id' | 'name' | 'arguments' | 'type'): never => { throw toolCallError('structure', toolCalls, undefined, transport, field); };
  let text = '';
  for (const item of output) {
    if (!record(item)) invalid('type');
    if (item.type === 'function_call') {
      if (!tools?.length) invalid('tool_calls');
      if (item.namespace !== undefined && item.namespace !== null && (!directChatGpt || item.namespace !== 'ovd')) invalid('name');
      if (item.call_id !== undefined && typeof item.call_id !== 'string') invalid('id');
      if (item.name !== undefined && typeof item.name !== 'string') invalid('name');
      if (item.arguments !== undefined && typeof item.arguments !== 'string') invalid('arguments');
      const call: ToolCall = { id: item.call_id as string ?? '', type: 'function', function: { name: item.name as string ?? '', arguments: item.arguments as string ?? '' } };
      toolCalls.push(call);
      validateToolCallSize(call, toolCalls.length - 1, toolCalls, undefined, transport);
      if (item.status !== undefined && item.status !== 'completed') throw toolCallError('finish', toolCalls, String(item.status), transport);
      responseItems.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...(directChatGpt ? { namespace: 'ovd' } : {}) });
    } else if (item.type === 'message') {
      if (item.role !== 'assistant' || !Array.isArray(item.content) || (item.status !== undefined && item.status !== 'completed')) throw new Error('Der Endpunkt hat keine vollständig abgeschlossene Assistentenantwort geliefert.');
      const content: ResponseInputItem[] = [];
      for (const part of item.content) {
        if (!record(part)) throw new Error('Der Endpunkt hat ein nicht unterstütztes Textformat geliefert.');
        if (part.type === 'output_text' && typeof part.text === 'string') { text += part.text; content.push({ type: 'output_text', text: part.text, annotations: [] }); }
        else if (part.type === 'refusal' && typeof part.refusal === 'string') { text += part.refusal; content.push({ type: 'refusal', refusal: part.refusal }); }
        else throw new Error('Der Endpunkt hat ein nicht unterstütztes Textformat geliefert.');
        if (text.length > MAX_TEXT_CHARS) throw new Error('Die Antwort des Endpunkts ist zu groß.');
      }
      responseItems.push({ type: 'message', role: 'assistant', content, ...(item.phase === 'commentary' || item.phase === 'final_answer' ? { phase: item.phase } : {}) });
    } else if (item.type === 'reasoning') {
      responseItems.push(reasoningContinuation(item, diagnostics));
    } else {
      // OVD offers only its functions; a hosted web/shell/search call is not a
      // substitute for an approved local capability and is never replayed.
      throw new Error('Der Endpunkt hat einen nicht angebotenen Responses-Ausgabetyp geliefert.');
    }
  }
  if (value.status !== 'completed' || value.error || value.incomplete_details) {
    if (toolCalls.length) throw toolCallError('finish', toolCalls, typeof value.status === 'string' ? value.status : undefined, transport);
    throw new Error('Der Endpunkt hat keine vollständig abgeschlossene Responses-Antwort geliefert.');
  }
  if (toolCalls.length) {
    // A completed Responses object is authoritative, like the complete fallback;
    // require an offered function and every required field before dispatch.
    validateToolCalls(toolCalls, 'stop', true, tools, transport);
    for (const item of responseItems) if (item.type === 'function_call') {
      item.arguments = toolCalls.find(call => call.id === item.call_id)!.function.arguments;
    }
  } else if (!text.trim()) throw new Error('Der Endpunkt hat keine lesbare Textantwort geliefert.');
  return { text, toolCalls, responseItems };
}

export async function requestResponsesTurn(
  config: AiConfig, key: string | null, messages: ProviderMessage[], options: ChatOptions,
  signal: AbortSignal, tools?: readonly unknown[], requestTimeoutMs = 60_000
): Promise<StreamTurn> {
  // ChatGPT plan usage permits HTTP streaming only, including a retry of an
  // unexecuted malformed reply. It never switches billing or provider.
  if (config.provider === 'chatgpt') return streamResponsesTurn(config, key, messages, options, signal, () => {}, tools, requestTimeoutMs);
  const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), requestTimeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const diagnostics = beginProviderDiagnostics(config, options, 'responses', 'complete', messages.length, tools?.length ?? 0);
  try {
    const body = responseBody(config, messages, options, false, tools);
    const response = await fetch(providerEndpoint(config, 'responses', body.model), { method: 'POST', headers: providerHeaders(config, key, 'application/json'), body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([signal, timeout.signal]) });
    diagnostics.response(response);
    if (!response.ok) throw await providerHttpError(config, response, 'auch ohne Streaming');
    if (Number(response.headers.get('content-length') ?? 0) > MAX_WIRE_BYTES) throw new Error('Die vollständige Antwort des Endpunkts ist zu groß.');
    if (!response.body) throw new Error('Der Endpunkt hat auch ohne Streaming keine Antwort geliefert.');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_WIRE_BYTES) throw new Error('Die vollständige Antwort des Endpunkts ist zu groß.');
      chunks.push(next.value);
    }
    signal.throwIfAborted();
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Der Endpunkt hat auch ohne Streaming keine gültige JSON-Antwort geliefert.'); }
    diagnostics.event(value);
    const result = parseOutput(value, tools, 'complete', false, diagnostics);
    diagnostics.finish(result.text.length, result.toolCalls.length, size);
    return result;
  } catch (error) {
    diagnostics.error(error, signal, timeout.signal);
    if (signal.aborted) throw new DOMException('Generierung abgebrochen.', 'AbortError');
    if (timeout.signal.aborted) throw new Error('Der Endpunkt hat auch ohne Streaming nicht rechtzeitig geantwortet.');
    if (error instanceof Error && /^(Der Endpunkt|Die Antwort|Die vollständige)/.test(error.message)) throw error;
    throw new Error('Die vollständige Antwort des Endpunkts konnte nicht geladen werden. Bitte Verbindung prüfen.');
  } finally { clearTimeout(timer); if (reader) await reader.cancel().catch(() => {}); }
}

export async function streamResponsesTurn(
  config: AiConfig, key: string | null, messages: ProviderMessage[], options: ChatOptions,
  signal: AbortSignal, onDelta: (text: string) => void, tools?: readonly unknown[], requestTimeoutMs = 60_000
): Promise<StreamTurn> {
  const timeout = new AbortController(); let timer: ReturnType<typeof setTimeout>;
  const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => timeout.abort(), requestTimeoutMs); };
  resetTimer();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const diagnostics = beginProviderDiagnostics(config, options, 'responses', 'stream', messages.length, tools?.length ?? 0);
  try {
    const body = responseBody(config, messages, options, true, tools);
    const requestSignal = AbortSignal.any([signal, timeout.signal]);
    const credential = config.provider === 'chatgpt' ? await chatGptAuth().accessToken(requestSignal) : key;
    const response = await fetch(providerEndpoint(config, 'responses', body.model), { method: 'POST', headers: providerHeaders(config, credential, 'text/event-stream'), body: JSON.stringify(body), redirect: 'error', signal: requestSignal });
    diagnostics.response(response);
    if (!response.ok) throw await providerHttpError(config, response);
    if (!response.body) throw new Error('Der Endpunkt hat keine Antwort geliefert.');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let line = '', pendingCR = false, data: string[] = [], eventSize = 0, wireSize = 0, answer = '';
    let result: StreamTurn | undefined;
    const calls = new Map<number, { itemId: string; call: ToolCall; argumentsDone?: boolean }>();
    const items = new Map<number, { id: string; type: string; added: boolean; done?: Record<string, unknown> }>();
    const itemIndexes = new Map<string, number>();
    const invalid = (field: 'tool_calls' | 'index' | 'id' | 'name' | 'arguments' | 'type', reason = 'tool_structure_invalid', comparison?: DiagnosticComparison): never => { diagnostics.failure(reason, { ...comparison, field }); throw toolCallError('structure', [...calls.values()].map(item => item.call), undefined, 'stream', field); };
    const inconsistentOutput = (reason: string, comparison?: DiagnosticComparison): never => { diagnostics.failure(reason, comparison); throw new Error('Der Endpunkt hat widersprüchliche Responses-Ausgabedaten geliefert.'); };
    const unfinishedOutput = (): never => {
      diagnostics.failure('fallback_items_unfinished');
      if (calls.size) throw toolCallError('finish', [...calls.values()].map(item => item.call));
      throw new Error('Der Endpunkt hat keine vollständig abgeschlossene Responses-Ausgabe geliefert.');
    };
    function observeItem(index: unknown, id: unknown, type: unknown) {
      if (!Number.isSafeInteger(index) || (index as number) < 0) return inconsistentOutput('item_index_invalid', { field: 'index', actual: index });
      if (typeof id !== 'string' || !id) return inconsistentOutput('item_id_invalid', { field: 'id', outputIndex: index, actual: id });
      if (typeof type !== 'string' || !type) return inconsistentOutput('item_type_invalid', { field: 'type', outputIndex: index, actual: type });
      const previous = items.get(index as number), previousIndex = itemIndexes.get(id);
      if (previous && previous.id !== id) return inconsistentOutput('item_id_changed', { field: 'id', outputIndex: index, expected: previous.id, actual: id });
      if (previous && previous.type !== type) return inconsistentOutput('item_type_changed', { field: 'type', outputIndex: index, expected: previous.type, actual: type });
      if (previousIndex !== undefined && previousIndex !== index) return inconsistentOutput('item_id_reused', { field: 'index', expected: previousIndex, actual: index });
      if (previous) return previous;
      const observed = { id, type, added: false } as { id: string; type: string; added: boolean; done?: Record<string, unknown> };
      items.set(index as number, observed); itemIndexes.set(id, index as number); return observed;
    }
    const messageContent = (item: Record<string, unknown>) => JSON.stringify(Array.isArray(item.content) ? item.content.map(part => record(part) ? { type: part.type, text: part.text, refusal: part.refusal } : part) : item.content);
    function completedResponse(raw: unknown): unknown {
      if (!record(raw) || !Array.isArray(raw.output)) { diagnostics.failure('terminal_output_invalid', { field: 'output', actual: record(raw) ? raw.output : raw }); return raw; }
      if (!raw.output.length && items.size && raw.status === 'completed' && !raw.error && !raw.incomplete_details) {
        // Some streaming gateways omit the terminal output array. Reconstruct
        // only from complete item snapshots after the response itself completes.
        const ordered = [...items.entries()].sort(([left], [right]) => left - right);
        if (ordered.some(([index, item], position) => index !== position || !item.done || item.done.status !== undefined && item.done.status !== null && item.done.status !== 'completed')) return unfinishedOutput();
        return { ...raw, output: ordered.map(([, item]) => item.done!) };
      }
      const output = [...raw.output];
      for (const [index, observed] of items) {
        const final = raw.output[index];
        if (!record(final)) return inconsistentOutput('terminal_item_missing', { outputIndex: index, actual: final });
        if (final.type !== observed.type) return inconsistentOutput('terminal_item_type_changed', { field: 'type', outputIndex: index, expected: observed.type, actual: final.type });
        if (final.id !== undefined && final.id !== observed.id) return inconsistentOutput('terminal_item_id_changed', { field: 'id', outputIndex: index, expected: observed.id, actual: final.id });
        if (observed.type === 'reasoning' && final.id === undefined) output[index] = { ...final, id: observed.id };
        if (observed.done) {
          if (observed.type === 'message' && final.role !== observed.done.role) return inconsistentOutput('message_role_changed', { field: 'role', outputIndex: index, expected: observed.done.role, actual: final.role });
          if (observed.type === 'message' && messageContent(final) !== messageContent(observed.done)) return inconsistentOutput('message_content_changed', { field: 'content', outputIndex: index, expected: messageContent(observed.done), actual: messageContent(final) });
          if (observed.type === 'reasoning') {
            const done = reasoningContinuation(observed.done, diagnostics), completed = reasoningContinuation(final, diagnostics);
            if (JSON.stringify(done.summary) !== JSON.stringify(completed.summary)) return inconsistentOutput('reasoning_summary_changed', { field: 'summary', outputIndex: index, expected: done.summary, actual: completed.summary });
            if (done.encrypted_content && completed.encrypted_content && done.encrypted_content !== completed.encrypted_content) return inconsistentOutput('reasoning_encrypted_conflict', { field: 'encrypted_content', outputIndex: index, expected: done.encrypted_content, actual: completed.encrypted_content });
            // Azure can add encrypted continuation data in the terminal response
            // or omit data already supplied by item.done. Keep known values and
            // fill only absent fields; never manufacture text or tool arguments.
            if (done.encrypted_content && !completed.encrypted_content) output[index] = { ...output[index], encrypted_content: done.encrypted_content };
          }
          if (observed.type === 'function_call') for (const field of ['call_id', 'name', 'arguments'] as const) if (final[field] !== observed.done[field]) return invalid(field === 'name' ? 'name' : field === 'arguments' ? 'arguments' : 'id', 'completed_function_' + field + '_changed', { outputIndex: index, expected: observed.done[field], actual: final[field] });
        }
        const call = calls.get(index);
        if (call?.argumentsDone) {
          if (final.call_id !== call.call.id) return invalid('id', 'finalized_call_id_changed', { outputIndex: index, expected: call.call.id, actual: final.call_id });
          if (final.name !== call.call.function.name) return invalid('name', 'finalized_call_name_changed', { outputIndex: index, expected: call.call.function.name, actual: final.name });
          if (final.arguments !== call.call.function.arguments) return invalid('arguments', 'finalized_call_arguments_changed', { outputIndex: index, expected: call.call.function.arguments, actual: final.arguments });
        }
      }
      return { ...raw, output };
    }
    const emit = (text: string) => {
      answer += text;
      if (answer.length > MAX_TEXT_CHARS) throw new Error('Die Antwort des Endpunkts ist zu groß.');
      if (text) { onDelta(text); signal.throwIfAborted(); }
    };
    function dispatch() {
      if (!data.length || result) { data = []; eventSize = 0; return; }
      const raw = data.join('\n'); data = []; eventSize = 0;
      if (raw.trim() === '[DONE]') return; // Only response.completed proves completion.
      let value: unknown;
      try { value = JSON.parse(raw); } catch { diagnostics.failure('event_json_invalid', { actual: raw }); throw new Error('Der Endpunkt hat ungültige Streaming-Daten geliefert.'); }
      diagnostics.event(value);
      if (!record(value) || typeof value.type !== 'string') throw new Error('Der Endpunkt hat ungültige Responses-Ereignisse geliefert.');
      if (value.type === 'error' || value.type === 'response.failed') {
        if (config.provider === 'chatgpt') throw providerReportedError(config, record(value.response) ? value.response.error : value.error ?? value);
        throw new Error('Der Endpunkt meldet einen Fehler beim Streaming.');
      }
      if (value.type === 'response.incomplete') throw toolCallError('finish', [...calls.values()].map(item => item.call), 'incomplete');
      if (value.type === 'response.output_text.delta' || value.type === 'response.refusal.delta') {
        if (typeof value.delta !== 'string') throw new Error('Der Endpunkt hat ein nicht unterstütztes Textformat geliefert.');
        if (value.output_index !== undefined || value.item_id !== undefined) {
          const item = observeItem(value.output_index, value.item_id, 'message');
          if (item.done) return inconsistentOutput('text_after_item_done', { outputIndex: value.output_index, field: 'delta', actual: value.delta });
        }
        emit(value.delta);
      } else if (value.type === 'response.output_item.added' || value.type === 'response.output_item.done') {
        const item = value.item;
        if (!record(item)) return invalid('type');
        const observed = observeItem(value.output_index, item.id, item.type);
        if (value.type === 'response.output_item.added') {
          if (observed.added || observed.done) return inconsistentOutput('duplicate_item_added', { outputIndex: value.output_index, field: 'id', actual: item.id });
          observed.added = true;
        } else {
          if (observed.done) return inconsistentOutput('duplicate_item_done', { outputIndex: value.output_index, field: 'id', actual: item.id });
          observed.done = item;
        }
        if (item.type !== 'function_call') return;
        if (item.namespace !== undefined && item.namespace !== null && (config.provider !== 'chatgpt' || item.namespace !== 'ovd')) invalid('name');
        if (!Number.isSafeInteger(value.output_index) || (value.output_index as number) < 0) invalid('index');
        if (typeof item.id !== 'string' || !item.id || typeof item.call_id !== 'string') return invalid('id');
        if (typeof item.name !== 'string') return invalid('name');
        if (typeof item.arguments !== 'string') return invalid('arguments');
        if (!tools?.length) invalid('tool_calls');
        const index = value.output_index as number, existing = calls.get(index);
        if (existing && existing.itemId !== item.id) invalid('id', 'function_item_id_changed', { outputIndex: index, expected: existing.itemId, actual: item.id });
        if (existing && existing.call.id !== item.call_id) invalid('id', 'function_call_id_changed', { outputIndex: index, expected: existing.call.id, actual: item.call_id });
        if (existing && existing.call.function.name !== item.name) invalid('name', 'function_name_changed', { outputIndex: index, expected: existing.call.function.name, actual: item.name });
        if (existing && (existing.argumentsDone ? item.arguments !== existing.call.function.arguments : !item.arguments.startsWith(existing.call.function.arguments))) invalid('arguments', existing.argumentsDone ? 'function_arguments_changed' : 'function_arguments_prefix_changed', { outputIndex: index, expected: existing.call.function.arguments, actual: item.arguments });
        const call: ToolCall = { id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } };
        calls.set(index, { itemId: item.id, call, ...(existing?.argumentsDone ? { argumentsDone: true } : {}) });
        validateToolCallSize(call, index, [...calls.values()].map(entry => entry.call));
      } else if (value.type === 'response.function_call_arguments.delta' || value.type === 'response.function_call_arguments.done') {
        if (!Number.isSafeInteger(value.output_index) || (value.output_index as number) < 0) invalid('index');
        const index = value.output_index as number, existing = calls.get(index);
        if (!existing) return invalid('id', 'function_delta_without_item', { outputIndex: index, actual: value.item_id });
        if (existing.itemId !== value.item_id) return invalid('id', 'function_delta_id_changed', { outputIndex: index, expected: existing.itemId, actual: value.item_id });
        if (items.get(index)?.done || existing.argumentsDone) return invalid('arguments', 'function_arguments_after_done', { outputIndex: index });
        const text = value.type.endsWith('.delta') ? value.delta : value.arguments;
        if (typeof text !== 'string') return invalid('arguments');
        if (value.type.endsWith('.done') && !text.startsWith(existing.call.function.arguments)) return invalid('arguments', 'function_arguments_done_prefix_changed', { outputIndex: index, expected: existing.call.function.arguments, actual: text });
        existing.call.function.arguments = value.type.endsWith('.delta') ? existing.call.function.arguments + text : text;
        if (value.type.endsWith('.done')) existing.argumentsDone = true;
        validateToolCallSize(existing.call, index, [...calls.values()].map(entry => entry.call));
      } else if (value.type === 'response.completed') {
        const parsed = parseOutput(completedResponse(value.response), tools, 'stream', config.provider === 'chatgpt', diagnostics);
        if (!parsed.text.startsWith(answer)) { diagnostics.failure('stream_text_changed', { field: 'content', expected: answer, actual: parsed.text }); throw new Error('Der Endpunkt hat widersprüchliche Streaming-Texte geliefert.'); }
        // Final output is complete and authoritative; unfinished calls are never
        // returned to the agent merely because an item.done event was received.
        for (const { call } of calls.values()) {
          const final = parsed.toolCalls.find(item => item.id === call.id);
          if (!final) return invalid('id', 'completed_call_missing', { expected: call.id });
          if (final.function.name !== call.function.name) invalid('name', 'completed_function_name_changed', { expected: call.function.name, actual: final.function.name });
          if (!final.function.arguments.startsWith(call.function.arguments)) invalid('arguments', 'completed_function_arguments_prefix_changed', { expected: call.function.arguments, actual: final.function.arguments });
        }
        emit(parsed.text.slice(answer.length)); result = parsed;
      }
    }
    function processLine(text: string) {
      if (!text) { dispatch(); return; }
      if (text.startsWith(':')) return;
      const colon = text.indexOf(':'), field = colon === -1 ? text : text.slice(0, colon);
      let value = colon === -1 ? '' : text.slice(colon + 1); if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'data') { eventSize += value.length; if (eventSize > 1_000_000) throw new Error('Die Antwort des Endpunkts ist zu groß.'); data.push(value); }
    }
    function consume(text: string) {
      for (const char of text) {
        if (pendingCR) { pendingCR = false; if (char === '\n') continue; }
        if (char === '\r') { processLine(line); line = ''; pendingCR = true; }
        else if (char === '\n') { processLine(line); line = ''; }
        else { line += char; if (line.length > 1_000_000) throw new Error('Die Antwort des Endpunkts ist zu groß.'); }
        if (result) return;
      }
    }
    while (!result) {
      const next = await reader.read();
      if (next.done) { consume(decoder.decode()); if (line) processLine(line); dispatch(); break; }
      resetTimer(); wireSize += next.value.byteLength;
      if (wireSize > MAX_WIRE_BYTES) throw new Error('Die Antwort des Endpunkts ist zu groß.');
      consume(decoder.decode(next.value, { stream: true }));
    }
    if (!result) {
      if (calls.size) throw toolCallError('finish', [...calls.values()].map(item => item.call));
      throw new Error('Die Streaming-Antwort wurde vorzeitig beendet.');
    }
    diagnostics.finish(result.text.length, result.toolCalls.length, wireSize);
    return result;
  } catch (error) {
    diagnostics.error(error, signal, timeout.signal);
    if (signal.aborted) throw new DOMException('Generierung abgebrochen.', 'AbortError');
    if (timeout.signal.aborted) throw new Error('Der Endpunkt hat nicht rechtzeitig geantwortet.');
    if (error instanceof Error && (error.name === 'ChatGptAuthError' || /^(Der Endpunkt|Die Antwort|Die Streaming-Antwort)/.test(error.message))) throw error;
    throw new Error('Die Verbindung zum Endpunkt ist fehlgeschlagen. Bitte URL und Erreichbarkeit prüfen.');
  } finally { clearTimeout(timer!); if (reader) await reader.cancel().catch(() => {}); }
}

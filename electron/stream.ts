import type { AiConfig, ChatOptions } from '../shared/model';

export type ProviderMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** Stream the provider response; callers retain each delta even if the promise rejects. */
export async function streamCompletion(
  config: AiConfig, key: string | null, messages: ProviderMessage[], options: ChatOptions,
  signal: AbortSignal, onDelta: (text: string) => void
): Promise<string> {
  const timeout = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const resetTimer = () => { clearTimeout(timer); timer = setTimeout(() => timeout.abort(), 60_000); };
  resetTimer();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const model = options.tier === 'smart' ? config.smartModel : config.simpleModel;
    const thinking = options.tier === 'smart' ? config.smartThinking : config.simpleThinking;
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', headers, redirect: 'error', signal: AbortSignal.any([signal, timeout.signal]),
      body: JSON.stringify({ model, messages, stream: true, ...(thinking === 'off' ? {} : { reasoning_effort: thinking }) })
    });
    if (!response.ok) throw new Error(`Der Endpunkt hat die Anfrage abgelehnt (HTTP ${response.status}).${thinking !== 'off' ? ' Prüfe Modell und Thinking-Einstellung.' : ''}`);
    if (!response.body) throw new Error('Der Endpunkt hat keine Antwort geliefert.');
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let line = '', pendingCR = false, data: string[] = [], eventSize = 0, wireSize = 0;
    let answer = '', complete = false, finish = false;
    function dispatch() {
      if (!data.length || complete) { data = []; eventSize = 0; return; }
      const value = data.join('\n'); data = []; eventSize = 0;
      if (value.trim() === '[DONE]') { complete = true; return; }
      let parsed: any;
      try { parsed = JSON.parse(value); } catch { throw new Error('Der Endpunkt hat ungültige Streaming-Daten geliefert.'); }
      if (parsed?.error) throw new Error('Der Endpunkt meldet einen Fehler beim Streaming.');
      const choice = parsed?.choices?.[0];
      if (choice?.finish_reason != null) finish = true;
      const delta = choice?.delta?.content;
      if (typeof delta === 'string' && delta) {
        answer += delta;
        if (answer.length > 200_000) throw new Error('Die Antwort des Endpunkts ist zu groß.');
        onDelta(delta);
        if (signal.aborted) throw new DOMException('Generierung abgebrochen.', 'AbortError');
      } else if (delta !== undefined && delta !== null && typeof delta !== 'string') throw new Error('Der Endpunkt hat ein nicht unterstütztes Textformat geliefert.');
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
    if (!complete && !finish) throw new Error('Die Streaming-Antwort wurde vorzeitig beendet.');
    if (!answer.trim()) throw new Error('Der Endpunkt hat keine lesbare Textantwort geliefert.');
    return answer;
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

import WebSocket from 'ws';
import { SPEECH_MAX_TEXT_CHARS, SPEECH_SAMPLE_RATE, type SpeechSettings } from '../shared/speech';

/** Only these deliberately authored errors may cross the main/renderer boundary. */
export class SpeechError extends Error {}
export function speechError(error: unknown): SpeechError {
  return error instanceof SpeechError ? error : new SpeechError('Die Spracherkennung ist fehlgeschlagen. Bitte Verbindung und Spracheinstellungen prüfen.');
}
export interface SpeechAdapter {
  connect(): Promise<void>;
  append(pcm: Buffer): void | Promise<void>;
  finish(): Promise<string>;
  cancel(): void;
}
interface AdapterOptions {
  settings: SpeechSettings;
  apiKey: string | null;
  text(text: string): void;
  failed(error: SpeechError): void;
}
function headers(options: AdapterOptions): Record<string, string> {
  const { authMode } = options.settings;
  return authMode === 'none' ? {} : authMode === 'api-key' ? { 'api-key': options.apiKey! } : { Authorization: `Bearer ${options.apiKey!}` };
}
function checkedText(text: unknown): string {
  if (typeof text !== 'string' || text.length > SPEECH_MAX_TEXT_CHARS) throw new SpeechError('Der Anbieter hat eine ungültige oder zu lange Transkription geliefert.');
  return text;
}
function statusError(status: number): SpeechError {
  if (status === 401 || status === 403) return new SpeechError('Die Spracherkennung wurde nicht autorisiert. Bitte API-Schlüssel und Zugriff prüfen.');
  if (status === 404) return new SpeechError('Der Transkriptions-Endpunkt wurde nicht gefunden. Bitte URL und Deployment prüfen.');
  if (status === 429) return new SpeechError('Das Limit des Sprachanbieters wurde erreicht. Bitte später erneut versuchen.');
  if (status >= 300 && status < 400) return new SpeechError('Der Transkriptions-Endpunkt leitet weiter. Bitte die endgültige URL eintragen.');
  return new SpeechError(`Der Sprachanbieter hat die Anfrage abgelehnt (HTTP ${status}). Bitte Endpunkt, Modell und Modus prüfen.`);
}

/** PCM never leaves memory except for the explicitly requested transcription upload. */
export function pcmWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SPEECH_SAMPLE_RATE, 24); header.writeUInt32LE(SPEECH_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
class UploadAdapter implements SpeechAdapter {
  private chunks: Buffer[] = [];
  private readonly abort = new AbortController();
  constructor(private readonly options: AdapterOptions) {}
  async connect(): Promise<void> {}
  append(pcm: Buffer): void { this.chunks.push(pcm); }
  async finish(): Promise<string> {
    if (this.abort.signal.aborted) throw new SpeechError('Die Aufnahme wurde abgebrochen.');
    if (!this.chunks.length) return '';
    const wav = pcmWav(Buffer.concat(this.chunks)); this.chunks = [];
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'recording.wav');
    if (this.options.settings.provider !== 'deepseek') {
      body.append('model', this.options.settings.model);
      body.append('response_format', 'json');
      if (this.options.settings.language) body.append('language', this.options.settings.language);
    }
    const timer = setTimeout(() => this.abort.abort(), 90_000);
    try {
      const response = await fetch(this.options.settings.endpoint, { method: 'POST', headers: headers(this.options), body, signal: this.abort.signal, redirect: 'manual' });
      if (!response.ok) { void response.body?.cancel(); throw statusError(response.status); }
      const reader = response.body?.getReader();
      if (!reader) throw new SpeechError('Der Sprachanbieter hat keine Transkription geliefert.');
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const item = await reader.read(); if (item.done) break;
          size += item.value.byteLength;
          if (size > 256_000) { await reader.cancel(); throw new SpeechError('Die Antwort des Sprachanbieters ist zu groß.'); }
          chunks.push(item.value);
        }
      } finally { reader.releaseLock(); }
      let payload: unknown;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new SpeechError('Der Sprachanbieter hat keine gültige JSON-Transkription geliefert.'); }
      return checkedText(payload && typeof payload === 'object' ? (payload as { text?: unknown }).text : undefined);
    } catch (error) {
      if (this.abort.signal.aborted) throw new SpeechError('Die Spracherkennung wurde abgebrochen oder hat zu lange gedauert.');
      throw speechError(error);
    } finally { clearTimeout(timer); }
  }
  cancel(): void { this.chunks = []; this.abort.abort(); }
}

interface TranscriptItem { text: string; completed: boolean; order: number; committed: boolean; }
class RealtimeAdapter implements SpeechAdapter {
  private socket?: WebSocket;
  private readonly items = new Map<string, TranscriptItem>();
  private configTimer?: ReturnType<typeof setTimeout>;
  private finishTimer?: ReturnType<typeof setTimeout>;
  private ready = false;
  private ended = false;
  private stopping = false;
  private failure?: SpeechError;
  private bufferedBytes = 0;
  private silentBytes = 0;
  private heardVoice = false;
  private sentCommits = 0;
  private receivedCommits = 0;
  private readyResolve?: () => void;
  private readyReject?: (error: SpeechError) => void;
  private finishResolve?: (text: string) => void;
  private finishReject?: (error: SpeechError) => void;
  private audioReject?: (error: SpeechError) => void;
  constructor(private readonly options: AdapterOptions) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve; this.readyReject = reject;
      this.configTimer = setTimeout(() => this.fail(new SpeechError('Der Sprachanbieter hat die Live-Verbindung nicht rechtzeitig bestätigt.')), 15_000);
      const requestHeaders = headers(this.options);
      if (this.options.settings.realtimeProtocol === 'beta') requestHeaders['OpenAI-Beta'] = 'realtime=v1';
      try {
        this.socket = new WebSocket(this.options.settings.endpoint, { headers: requestHeaders, followRedirects: false, maxPayload: 256_000, handshakeTimeout: 15_000, perMessageDeflate: false });
      } catch { this.fail(new SpeechError('Die Live-Verbindung konnte nicht geöffnet werden.')); return; }
      this.socket.on('open', () => {
        try {
          const { model, language, realtimeProtocol } = this.options.settings;
          const transcription = { model, ...(language ? model.startsWith('gpt-live-transcribe') ? { languages: [language] } : { language } : {}) };
          this.send(realtimeProtocol === 'ga'
            ? { type: 'session.update', session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: SPEECH_SAMPLE_RATE }, transcription, turn_detection: null } } } }
            : { type: 'transcription_session.update', session: { input_audio_format: 'pcm16', input_audio_transcription: transcription, turn_detection: null } });
        } catch (error) { this.fail(speechError(error)); }
      });
      this.socket.on('message', (data, binary) => {
        if (this.ended) return;
        try {
          if (binary) throw new SpeechError('Der Live-Anbieter hat ein nicht unterstütztes Antwortformat geliefert.');
          this.receive(JSON.parse(data.toString()));
        } catch (error) { this.fail(speechError(error)); }
      });
      this.socket.on('unexpected-response', (_request, response) => { response.resume(); this.fail(statusError(response.statusCode ?? 502)); });
      this.socket.on('error', () => this.fail(new SpeechError('Die Verbindung zum Sprachanbieter ist fehlgeschlagen. Bitte URL und Zugang prüfen.')));
      this.socket.on('close', () => { if (!this.ended) this.fail(new SpeechError('Die Live-Verbindung wurde vor Abschluss der Transkription getrennt.')); });
    });
  }
  private send(value: object): void {
    if (this.ended) return;
    if (this.socket?.readyState !== WebSocket.OPEN) throw new SpeechError('Die Live-Verbindung ist nicht bereit.');
    if (this.socket.bufferedAmount > 512_000) throw new SpeechError('Die Live-Verbindung ist zu langsam. Bitte die Aufnahme erneut versuchen.');
    this.socket.send(JSON.stringify(value), error => { if (error) this.fail(new SpeechError('Audiodaten konnten nicht an den Sprachanbieter übertragen werden.')); });
  }
  async append(pcm: Buffer): Promise<void> {
    if (!this.ready || this.stopping || this.ended) throw this.failure ?? new SpeechError('Die Aufnahme ist nicht mehr aktiv.');
    // Await the socket write so a buffered recording cannot flood the transport on connect.
    await new Promise<void>((resolve, reject) => {
      this.audioReject = reject;
      if (this.socket?.readyState !== WebSocket.OPEN) { reject(new SpeechError('Die Live-Verbindung ist nicht bereit.')); return; }
      this.socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pcm.toString('base64') }), error => {
        this.audioReject = undefined;
        if (error) reject(new SpeechError('Audiodaten konnten nicht an den Sprachanbieter übertragen werden.'));
        else if (this.ended) reject(this.failure ?? new SpeechError('Die Aufnahme wurde abgebrochen.'));
        else resolve();
      });
    });
    if (this.ended) throw this.failure ?? new SpeechError('Die Aufnahme wurde abgebrochen.');
    this.bufferedBytes += pcm.length;
    let power = 0;
    for (let i = 0; i < pcm.length; i += 2) power += (pcm.readInt16LE(i) / 32768) ** 2;
    if (Math.sqrt(power / (pcm.length / 2)) >= 0.009) { this.heardVoice = true; this.silentBytes = 0; }
    else this.silentBytes += pcm.length;
    // Client-side end-of-turn detection also serves providers that emit only after commit.
    if ((this.heardVoice && this.silentBytes >= SPEECH_SAMPLE_RATE * 2 * 0.65) || this.bufferedBytes >= SPEECH_SAMPLE_RATE * 2 * 8) this.commit();
  }
  private commit(): void {
    if (!this.bufferedBytes) return;
    // Realtime providers require at least 100 ms per commit. Pad only the last short tail.
    const minimum = SPEECH_SAMPLE_RATE * 2 / 10;
    if (this.bufferedBytes < minimum) this.send({ type: 'input_audio_buffer.append', audio: Buffer.alloc(minimum - this.bufferedBytes).toString('base64') });
    if (this.sentCommits - this.receivedCommits > 32) throw new SpeechError('Der Live-Anbieter bestätigt die Aufnahme nicht mehr.');
    this.sentCommits++;
    this.send({ type: 'input_audio_buffer.commit' });
    this.bufferedBytes = 0; this.silentBytes = 0; this.heardVoice = false;
  }
  private item(id: unknown): TranscriptItem {
    if (typeof id !== 'string' || !id || id.length > 256) throw new SpeechError('Der Live-Anbieter hat eine ungültige Transkriptionskennung geliefert.');
    let item = this.items.get(id);
    if (!item) {
      if (this.items.size >= 256) throw new SpeechError('Der Live-Anbieter hat zu viele Transkriptionsabschnitte geliefert.');
      item = { text: '', completed: false, order: 10_000 + this.items.size, committed: false }; this.items.set(id, item);
    }
    return item;
  }
  private transcript(): string {
    return checkedText([...this.items.values()].sort((a, b) => a.order - b.order).map(item => item.text.trim()).filter(Boolean).join(' '));
  }
  private receive(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SpeechError('Der Live-Anbieter hat ungültige Ausgabedaten geliefert.');
    const event = value as Record<string, unknown>;
    if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') throw new SpeechError('Der Live-Anbieter hat die Transkription abgelehnt. Bitte Modell, Sprache und Protokoll prüfen.');
    if (event.type === 'session.updated' || event.type === 'transcription_session.updated') {
      if (!this.ready) { this.ready = true; clearTimeout(this.configTimer); this.readyResolve?.(); this.readyResolve = undefined; this.readyReject = undefined; }
      return;
    }
    if (event.type === 'input_audio_buffer.committed') {
      const item = this.item(event.item_id);
      if (!item.committed) {
        if (this.receivedCommits >= this.sentCommits) throw new SpeechError('Der Live-Anbieter hat einen unerwarteten Aufnahmeabschnitt bestätigt.');
        item.committed = true; item.order = this.receivedCommits++;
      }
      this.options.text(this.transcript()); this.checkFinished(); return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      const item = this.item(event.item_id);
      if (!item.completed) { item.text = checkedText(item.text + checkedText(event.delta)); this.options.text(this.transcript()); }
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const item = this.item(event.item_id); item.text = checkedText(event.transcript); item.completed = true;
      this.options.text(this.transcript()); this.checkFinished();
    }
  }
  finish(): Promise<string> {
    if (this.ended) return this.failure ? Promise.reject(this.failure) : Promise.resolve(this.transcript());
    if (this.stopping) return Promise.reject(new SpeechError('Die Transkription wird bereits abgeschlossen.'));
    this.stopping = true;
    return new Promise((resolve, reject) => {
      this.finishResolve = resolve; this.finishReject = reject;
      this.finishTimer = setTimeout(() => this.fail(new SpeechError('Der Live-Anbieter hat die Transkription nicht rechtzeitig abgeschlossen. Der bisherige Text bleibt erhalten.')), 30_000);
      try { this.commit(); this.checkFinished(); } catch (error) { this.fail(speechError(error)); }
    });
  }
  private checkFinished(): void {
    if (!this.stopping || this.receivedCommits < this.sentCommits || [...this.items.values()].some(item => !item.completed)) return;
    const text = this.transcript(); this.close(); this.finishResolve?.(text); this.finishResolve = undefined; this.finishReject = undefined;
  }
  private fail(error: SpeechError): void {
    if (this.ended) return;
    this.failure = error; this.close();
    this.readyReject?.(error); this.readyReject = undefined; this.readyResolve = undefined;
    this.finishReject?.(error); this.finishReject = undefined; this.finishResolve = undefined;
    this.options.failed(error);
  }
  private close(): void {
    this.ended = true; clearTimeout(this.configTimer); clearTimeout(this.finishTimer);
    this.audioReject?.(this.failure ?? new SpeechError('Die Aufnahme wurde abgebrochen.')); this.audioReject = undefined;
    this.socket?.terminate(); this.socket = undefined;
  }
  cancel(): void {
    if (this.ended) return;
    this.close();
    const error = new SpeechError('Die Aufnahme wurde abgebrochen.');
    this.readyReject?.(error); this.finishReject?.(error);
    this.readyResolve = undefined; this.readyReject = undefined; this.finishResolve = undefined; this.finishReject = undefined;
  }
}

/** Each provider transport is independent from chat credentials and chat adapters. */
export function createSpeechAdapter(options: AdapterOptions): SpeechAdapter {
  return options.settings.mode === 'live' ? new RealtimeAdapter(options) : new UploadAdapter(options);
}

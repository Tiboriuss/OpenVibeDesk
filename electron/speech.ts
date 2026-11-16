import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { localCredentialEntry } from './credential-store';
import { createSpeechAdapter, SpeechError, speechError, type SpeechAdapter } from './speech-adapters';
import {
  defaultSpeechSettings, SPEECH_MAX_AUDIO_BYTES, SPEECH_MAX_CHUNK_BYTES, SPEECH_MAX_PENDING_AUDIO_BYTES, SPEECH_MAX_RECORDING_SECONDS,
  speechSettingsInputSchema, speechSettingsSchema,
  type SpeechPublicSettings, type SpeechSettings, type SpeechSettingsInput, type SpeechSessionEvent, type SpeechSessionStart
} from '../shared/speech';

type OwnerId = number;
const savedSchema = z.object({ version: z.literal(1), settings: speechSettingsSchema, credentialId: z.string().uuid().nullable() }).strict();
type SavedSettings = z.infer<typeof savedSchema>;
interface Session {
  id: string; ownerId: OwnerId; mode: SpeechSettings['mode']; status: SpeechSessionEvent['status'];
  text: string; bytes: number; adapter: SpeechAdapter; emit(event: SpeechSessionEvent): void;
  saved: SavedSettings; chunks: Buffer[]; sentIndex: number; sentBytes: number; ready: boolean;
  connection?: Promise<void>; draining?: Promise<void>; stopped?: Promise<void>;
  timer?: ReturnType<typeof setTimeout>; finishTimer?: ReturnType<typeof setTimeout>;
}
interface RetainedRecording { id: string; saved: SavedSettings; chunks: Buffer[]; bytes: number; }
const credential = (id: string) => localCredentialEntry('OpenVibeDesk Speech', id);
const storageError = () => new SpeechError('Die Spracheinstellungen konnten nicht gelesen werden. Die vorhandene Datei wurde unverändert beibehalten.');

/** Main-process speech service. It neither sees nor changes conversations. */
export class SpeechService {
  private saved: SavedSettings = { version: 1, settings: { ...defaultSpeechSettings }, credentialId: null };
  private readonly file: string;
  private initialization?: Promise<void>;
  private fault?: SpeechError;
  private queue: Promise<unknown> = Promise.resolve();
  private sessions = new Map<string, Session>();
  private completedSessions = new Map<string, OwnerId>();
  private retained = new Map<OwnerId, RetainedRecording>();
  private startGenerations = new Map<OwnerId, number>();
  private disposed = false;
  constructor(private readonly options: { dataDirectory: string; changed(settings: SpeechPublicSettings): void }) {
    this.file = path.join(options.dataDirectory, 'speech-settings.json');
  }
  initialize(): Promise<void> {
    this.initialization ??= (async () => {
      try {
        let stat;
        try { stat = await fs.lstat(this.file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw storageError();
        const content = await fs.readFile(this.file, 'utf8');
        if (Buffer.byteLength(content, 'utf8') > 16_384) throw storageError();
        this.saved = savedSchema.parse(JSON.parse(content));
      } catch { this.fault = storageError(); }
    })();
    return this.initialization;
  }
  async getSettings(): Promise<SpeechPublicSettings> {
    await this.initialize();
    let hasApiKey = false, error = this.fault?.message;
    try { hasApiKey = !!(this.saved.credentialId && await credential(this.saved.credentialId).getPassword()); }
    catch { error = 'Der Zugangsdaten-Speicher für die Spracheingabe ist nicht verfügbar.'; }
    const settings = { ...this.saved.settings };
    const complete = !!settings.endpoint && (settings.provider === 'deepseek' || !!settings.model)
      && (settings.authMode === 'none' || hasApiKey) && speechSettingsSchema.safeParse({ ...settings, enabled: true }).success;
    return { ...settings, hasApiKey, configured: complete && !error, maxRecordingSeconds: SPEECH_MAX_RECORDING_SECONDS, ...(error ? { error } : {}) };
  }
  saveSettings(input: SpeechSettingsInput): Promise<SpeechPublicSettings> {
    const result = this.queue.then(async () => {
      await this.initialize();
      if (this.fault) throw this.fault;
      const parsed = speechSettingsInputSchema.safeParse(input);
      if (!parsed.success) throw new SpeechError(parsed.error.issues[0]?.message ?? 'Ungültige Spracheinstellungen.');
      const { apiKey, clearApiKey, ...settings } = parsed.data;
      const previous = this.saved;
      let credentialId = previous.credentialId;
      let newCredential: string | undefined;
      // A provider/authentication/host change must not silently reuse an unrelated key.
      const host = (value: string) => { try { return new URL(value).host; } catch { return ''; } };
      if (clearApiKey || settings.authMode === 'none' || settings.provider !== previous.settings.provider
        || settings.authMode !== previous.settings.authMode || host(settings.endpoint) !== host(previous.settings.endpoint)) credentialId = null;
      if (apiKey && settings.authMode !== 'none') {
        newCredential = randomUUID();
        try { await credential(newCredential).setPassword(apiKey); } catch { throw new SpeechError('Der API-Schlüssel für die Spracheingabe konnte nicht gespeichert werden.'); }
        credentialId = newCredential;
      }
      const next: SavedSettings = { version: 1, settings, credentialId };
      const temporary = path.join(path.dirname(this.file), `.speech-settings-${randomUUID()}.tmp`);
      let renamed = false;
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(next, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
        await fs.rename(temporary, this.file); renamed = true;
        if (process.platform !== 'win32') {
          const directory = await fs.open(path.dirname(this.file), 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } catch {
        if (renamed) this.fault = new SpeechError('Das Speichern der Spracheinstellungen konnte nicht bestätigt werden. Bitte OVD neu starten.');
        else if (newCredential) await credential(newCredential).deletePassword().catch(() => {});
        throw this.fault ?? new SpeechError('Die Spracheinstellungen konnten nicht gespeichert werden.');
      } finally { await fs.unlink(temporary).catch(() => {}); }
      this.saved = next;
      if (previous.credentialId && previous.credentialId !== credentialId) await credential(previous.credentialId).deletePassword().catch(() => {});
      // A changed configuration never leaves an old microphone session running.
      for (const ownerId of this.startGenerations.keys()) this.cancelOwner(ownerId);
      const publicSettings = await this.getSettings();
      try { this.options.changed(publicSettings); } catch { /* Settings remain saved if a window closed during notification. */ }
      return publicSettings;
    });
    this.queue = result.catch(() => {});
    return result;
  }
  async start(ownerId: OwnerId, emit: (event: SpeechSessionEvent) => void): Promise<SpeechSessionStart> {
    this.retained.delete(ownerId);
    const { saved, apiKey, generation } = await this.prepare(ownerId);
    const session = this.createSession(ownerId, saved, apiKey, generation, emit);
    this.connect(session);
    return this.started(session, 'connecting');
  }
  async retry(ownerId: OwnerId, id: string, emit: (event: SpeechSessionEvent) => void): Promise<SpeechSessionStart> {
    const recording = this.retained.get(ownerId);
    if (!recording || recording.id !== id) throw new SpeechError('Diese Aufnahme steht nicht mehr für einen erneuten Versuch zur Verfügung.');
    const { saved, apiKey, generation } = await this.prepare(ownerId);
    if (this.retained.get(ownerId) !== recording || saved !== recording.saved) throw new SpeechError('Die Aufnahme wurde abgebrochen oder die Spracheinstellungen wurden geändert.');
    const session = this.createSession(ownerId, saved, apiKey, generation, emit, recording);
    this.retained.delete(ownerId);
    this.connect(session);
    void this.finish(session).catch(() => {});
    return this.started(session, 'transcribing');
  }
  private started(session: Session, status: SpeechSessionStart['status']): SpeechSessionStart {
    return { id: session.id, mode: session.mode, status, maxRecordingSeconds: SPEECH_MAX_RECORDING_SECONDS };
  }
  private async prepare(ownerId: OwnerId): Promise<{ saved: SavedSettings; apiKey: string | null; generation: number }> {
    const generation = (this.startGenerations.get(ownerId) ?? 0) + 1;
    this.startGenerations.set(ownerId, generation);
    await this.initialize(); await this.queue;
    if (this.startGenerations.get(ownerId) !== generation) throw new SpeechError('Die Aufnahme wurde abgebrochen.');
    if (this.disposed) throw new SpeechError('Die Spracheingabe ist nicht mehr verfügbar.');
    if (this.sessions.size) throw new SpeechError('In einem Chat läuft bereits eine Sprachaufnahme.');
    const publicSettings = await this.getSettings();
    if (!publicSettings.enabled || !publicSettings.configured) throw new SpeechError(publicSettings.error ?? 'Bitte die Spracheingabe zuerst in den Einstellungen einrichten und aktivieren.');
    const saved = this.saved;
    let apiKey: string | null = null;
    try { if (saved.credentialId) apiKey = await credential(saved.credentialId).getPassword(); }
    catch { throw new SpeechError('Der API-Schlüssel für die Spracheingabe konnte nicht gelesen werden.'); }
    if (saved.settings.authMode !== 'none' && !apiKey) throw new SpeechError('Für die Spracheingabe fehlt ein API-Schlüssel.');
    // Configuration and vault reads are asynchronous; re-check before acquiring the slot.
    if (this.startGenerations.get(ownerId) !== generation || this.saved !== saved) throw new SpeechError('Die Aufnahme wurde abgebrochen.');
    if (this.disposed || this.sessions.size) throw new SpeechError('Die Spracheingabe ist momentan belegt.');
    return { saved, apiKey, generation };
  }
  private createSession(ownerId: OwnerId, saved: SavedSettings, apiKey: string | null, generation: number,
    emit: (event: SpeechSessionEvent) => void, recording?: RetainedRecording): Session {
    if (this.disposed || this.saved !== saved || this.startGenerations.get(ownerId) !== generation) throw new SpeechError('Die Aufnahme wurde abgebrochen.');
    if (this.sessions.size) throw new SpeechError('Die Spracheingabe ist momentan belegt.');
    const id = randomUUID();
    const session: Session = {
      id, ownerId, saved, mode: saved.settings.mode, status: recording ? 'transcribing' : 'connecting', text: '', emit,
      bytes: recording?.bytes ?? 0, chunks: recording?.chunks ?? [], sentIndex: 0, sentBytes: 0, ready: false,
      adapter: createSpeechAdapter({ settings: { ...saved.settings }, apiKey,
        text: text => { if (this.sessions.get(id) === session) { session.text = text; this.publish(session); } },
        failed: error => this.fail(session, error)
      })
    };
    this.sessions.set(id, session);
    this.publish(session);
    return session;
  }
  private connect(session: Session): void {
    if (this.sessions.get(session.id) !== session) return;
    session.connection = (async () => {
      try {
        await session.adapter.connect();
        if (this.sessions.get(session.id) !== session) return;
        session.ready = true;
        if (session.status === 'connecting') session.status = 'recording';
        this.publish(session);
        await this.drain(session);
      } catch (error) { this.fail(session, speechError(error)); throw speechError(error); }
    })();
    // start acknowledges local capture immediately; connection failures arrive as events.
    void session.connection.catch(() => {});
  }
  private owned(ownerId: OwnerId, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new SpeechError('Diese Sprachaufnahme ist nicht mehr aktiv.');
    return session;
  }
  async append(ownerId: OwnerId, id: string, pcm: ArrayBuffer | Uint8Array): Promise<void> {
    if (this.completedSessions.get(id) === ownerId) return;
    const session = this.owned(ownerId, id);
    // Queued renderer audio cannot extend a stopped or failed recording.
    if (session.status === 'transcribing') return;
    if (session.status !== 'connecting' && session.status !== 'recording') throw new SpeechError('Diese Sprachaufnahme nimmt keine Audiodaten mehr an.');
    try {
      if (!(pcm instanceof ArrayBuffer) && !(pcm instanceof Uint8Array)) throw new SpeechError('Ungültige Audiodaten.');
      const length = pcm.byteLength;
      if (!length || length % 2 || length > SPEECH_MAX_CHUNK_BYTES) throw new SpeechError('Ungültiger oder zu großer Audioabschnitt.');
      const acceptedLength = Math.min(length, SPEECH_MAX_AUDIO_BYTES - session.bytes);
      if (session.bytes - session.sentBytes + acceptedLength > SPEECH_MAX_PENDING_AUDIO_BYTES) throw new SpeechError('Die Sprachverbindung ist zu langsam. Die Aufnahme wurde angehalten.');
      const bytes = pcm instanceof ArrayBuffer ? Buffer.from(new Uint8Array(pcm)) : Buffer.from(pcm);
      const accepted = bytes.subarray(0, acceptedLength);
      // OS microphone permission may take time; only captured audio starts the duration clock.
      if (!session.bytes) session.timer = setTimeout(() => { void this.stop(ownerId, id).catch(() => {}); }, SPEECH_MAX_RECORDING_SECONDS * 1000);
      session.chunks.push(accepted); session.bytes += accepted.length;
      if (session.ready) void this.drain(session).catch(() => {});
      if (session.bytes === SPEECH_MAX_AUDIO_BYTES) void this.stop(ownerId, id).catch(() => {});
    } catch (error) { this.fail(session, speechError(error)); throw speechError(error); }
  }
  private drain(session: Session): Promise<void> {
    if (session.draining) return session.draining;
    if (!session.ready || this.sessions.get(session.id) !== session) return Promise.resolve();
    const draining = (async () => {
      try {
        while (this.sessions.get(session.id) === session && session.sentIndex < session.chunks.length) {
          const chunk = session.chunks[session.sentIndex];
          await session.adapter.append(chunk);
          if (this.sessions.get(session.id) !== session) return;
          session.sentIndex++; session.sentBytes += chunk.length;
        }
      } catch (error) { this.fail(session, speechError(error)); throw speechError(error); }
    })();
    session.draining = draining;
    void draining.finally(() => {
      if (session.draining !== draining) return;
      session.draining = undefined;
      // An append can land between the last iteration and this promise's settlement.
      if (this.sessions.get(session.id) === session && session.sentIndex < session.chunks.length) void this.drain(session).catch(() => {});
    }).catch(() => {});
    return draining;
  }
  stop(ownerId: OwnerId, id: string): Promise<void> {
    if (this.completedSessions.get(id) === ownerId) return Promise.resolve();
    let session: Session;
    try { session = this.owned(ownerId, id); } catch (error) { return Promise.reject(error); }
    return this.finish(session);
  }
  private finish(session: Session): Promise<void> {
    if (session.stopped) return session.stopped;
    clearTimeout(session.timer); session.status = 'transcribing'; this.publish(session);
    session.finishTimer = setTimeout(() => this.fail(session, new SpeechError('Die Spracherkennung hat zu lange gedauert. Der bisherige Text bleibt erhalten.')), 90_000);
    session.stopped = (async () => {
      try {
        await session.connection;
        if (this.sessions.get(session.id) !== session) return;
        do { await this.drain(session); }
        while (this.sessions.get(session.id) === session && session.sentIndex < session.chunks.length);
        if (this.sessions.get(session.id) !== session) return;
        const text = await session.adapter.finish();
        if (this.sessions.get(session.id) !== session) return;
        session.text = text; session.status = 'completed'; this.publish(session); this.cleanup(session);
      } catch (error) { this.fail(session, speechError(error)); throw speechError(error); }
    })();
    return session.stopped;
  }
  cancel(ownerId: OwnerId, id: string): void {
    if (this.retained.get(ownerId)?.id === id) this.retained.delete(ownerId);
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) return;
    session.status = 'cancelled'; this.publish(session); this.cleanup(session);
  }
  cancelOwner(ownerId: OwnerId): void {
    this.startGenerations.set(ownerId, (this.startGenerations.get(ownerId) ?? 0) + 1);
    this.retained.delete(ownerId);
    for (const session of [...this.sessions.values()]) if (session.ownerId === ownerId) this.cancel(ownerId, session.id);
  }
  dispose(): void {
    this.disposed = true; this.retained.clear();
    for (const session of [...this.sessions.values()]) this.cancel(session.ownerId, session.id);
  }
  private publish(session: Session, error?: string, canRetry?: boolean): void {
    try { session.emit({ id: session.id, status: session.status, text: session.text, ...(error ? { error } : {}), ...(canRetry ? { canRetry } : {}) }); } catch { /* The window may already have closed. */ }
  }
  private fail(session: Session, error: SpeechError): void {
    if (this.sessions.get(session.id) !== session) return;
    const canRetry = session.bytes > 0 && this.saved === session.saved && !this.disposed;
    if (canRetry) this.retained.set(session.ownerId, { id: session.id, saved: session.saved, chunks: session.chunks, bytes: session.bytes });
    session.status = 'failed'; this.publish(session, error.message, canRetry); this.cleanup(session);
  }
  private cleanup(session: Session): void {
    clearTimeout(session.timer); clearTimeout(session.finishTimer); this.sessions.delete(session.id);
    this.completedSessions.set(session.id, session.ownerId);
    if (this.completedSessions.size > 64) this.completedSessions.delete(this.completedSessions.keys().next().value!);
    session.adapter.cancel(); session.chunks = [];
  }
}

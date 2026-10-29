import { utilityProcess, type UtilityProcess } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModuleRuntimeRecord } from './modules';
import { attentionKeySchema, moduleAttentionInputSchema, type ModuleAttentionInput } from '../shared/module-attention';

const STARTUP_TIMEOUT_MS = 10_000;
const INVOCATION_TIMEOUT_MS = 60_000;
const ARGUMENT_BYTES = 16 * 1024;
const RESULT_BYTES = 32 * 1024;
const MAX_PENDING = 16;
type PendingCall = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout; removeAbort(): void; cancelled: boolean };
type Runtime = { fingerprint: string; record: ModuleRuntimeRecord; child?: UtilityProcess; ready: Promise<void>; resolveReady(): void; rejectReady(error: Error): void; startupTimer: NodeJS.Timeout; pending: Map<string, PendingCall>; started: boolean; stopped: boolean };

export interface ModuleRuntimeOptions {
  dataRoot: string;
  onFailure?(moduleId: string, reason: string): void;
  onAttention?(moduleId: string, notice: ModuleAttentionInput): void;
  onAttentionClear?(moduleId: string, key: string): void;
}

function abortError(): Error { return new DOMException('Abgebrochen', 'AbortError'); }
function encodeArguments(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Modulargumente müssen ein JSON-Objekt sein.');
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { throw new Error('Die Modulargumente sind kein gültiges JSON.'); }
  if (typeof encoded !== 'string') throw new Error('Die Modulargumente sind kein gültiges JSON.');
  if (Buffer.byteLength(encoded, 'utf8') > ARGUMENT_BYTES) throw new Error('Die Modulargumente sind größer als 16 KB.');
  return encoded;
}

/**
 * Separates module crashes from Electron main. This is not a security sandbox:
 * approved modules run with the current OS user's filesystem and network rights.
 * No credentials, workspace state, stdout or stderr are forwarded by this host.
 */
export class ModuleRuntimeManager {
  private readonly runtimes = new Map<string, Runtime>();
  private disposed = false;

  constructor(private readonly options: ModuleRuntimeOptions) {}

  start(record: ModuleRuntimeRecord): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Die Modullaufzeit wurde beendet.'));
    const { module } = record;
    if (module.status !== 'ready' || module.manifest?.runtime.type !== 'process' || !record.entryPath) return Promise.reject(new Error('Dieses Prozessmodul ist nicht freigegeben.'));
    const existing = this.runtimes.get(module.id);
    if (existing?.fingerprint === record.fingerprint) return existing.ready;
    if (existing) this.stop(module.id);
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const runtime: Runtime = { fingerprint: record.fingerprint, record, ready, resolveReady, rejectReady, pending: new Map(), started: false, stopped: false,
      startupTimer: setTimeout(() => this.fail(runtime, 'Das Modul hat nicht innerhalb von 10 Sekunden gestartet.'), STARTUP_TIMEOUT_MS) };
    this.runtimes.set(module.id, runtime);
    void this.launch(runtime);
    return ready;
  }

  private async launch(runtime: Runtime): Promise<void> {
    try {
      const dataDirectory = path.join(this.options.dataRoot, runtime.record.module.id);
      await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
      if (runtime.stopped) return;
      // Do not pass arbitrary application environment secrets or NODE_OPTIONS.
      const env: Record<string, string> = {};
      for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TZ']) if (process.env[key] !== undefined) env[key] = process.env[key]!;
      const child = utilityProcess.fork(path.join(__dirname, 'module-worker.js'), [], { cwd: runtime.record.rootPath, env, execArgv: [], stdio: 'ignore', serviceName: `OVD module: ${runtime.record.module.id}` });
      runtime.child = child;
      child.on('message', message => this.receive(runtime, message));
      child.on('error', () => this.fail(runtime, 'Der Modulprozess ist fehlgeschlagen.'));
      child.on('exit', () => { if (!runtime.stopped) this.fail(runtime, 'Der Modulprozess wurde unerwartet beendet.'); });
      child.once('spawn', () => {
        if (runtime.stopped) { child.kill(); return; }
        try { child.postMessage({ type: 'initialize', moduleId: runtime.record.module.id, entryPath: runtime.record.entryPath, dataDirectory, tools: runtime.record.module.manifest!.tools!.map(tool => tool.name) }); }
        catch { this.fail(runtime, 'Das Modul konnte nicht initialisiert werden.'); }
      });
    } catch { this.fail(runtime, 'Der Modulprozess konnte nicht gestartet werden.'); }
  }

  private receive(runtime: Runtime, raw: unknown): void {
    if (runtime.stopped) return;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { this.fail(runtime, 'Das Modul hat eine ungültige Antwort geliefert.'); return; }
    const message = raw as Record<string, unknown>;
    if (message.type === 'attention' || message.type === 'attention-clear') {
      // The child cannot choose another module's ID; old/retired runtimes cannot publish.
      if (this.runtimes.get(runtime.record.module.id) !== runtime || runtime.record.module.status !== 'ready') return;
      if (message.type === 'attention') {
        const notice = moduleAttentionInputSchema.safeParse(message.notice);
        if (!notice.success || Object.keys(message).some(key => !['type', 'notice'].includes(key))) { this.fail(runtime, 'Das Modul hat einen ungültigen Hinweis geliefert.'); return; }
        this.options.onAttention?.(runtime.record.module.id, notice.data);
      } else {
        const key = attentionKeySchema.safeParse(message.key);
        if (!key.success || Object.keys(message).some(key => !['type', 'key'].includes(key))) { this.fail(runtime, 'Das Modul hat einen ungültigen Hinweis geliefert.'); return; }
        this.options.onAttentionClear?.(runtime.record.module.id, key.data);
      }
      return;
    }
    if (message.type === 'ready') {
      const expected = runtime.record.module.manifest!.tools!.map(tool => tool.name).sort();
      if (runtime.started || !Array.isArray(message.tools) || message.tools.length !== expected.length || !message.tools.every((name, index) => name === expected[index])) { this.fail(runtime, 'Die Modulfunktionen stimmen nicht mit dem Manifest überein.'); return; }
      clearTimeout(runtime.startupTimer); runtime.started = true; runtime.resolveReady(); return;
    }
    if (message.type === 'fatal') { this.fail(runtime, 'Das Modul konnte seinen Laufzeitvertrag nicht erfüllen.'); return; }
    if (message.type !== 'result' || typeof message.id !== 'string') { this.fail(runtime, 'Das Modul hat eine ungültige Antwort geliefert.'); return; }
    const pending = runtime.pending.get(message.id);
    if (!pending) return;
    runtime.pending.delete(message.id); clearTimeout(pending.timer); pending.removeAbort();
    if (pending.cancelled) return;
    if (message.ok !== true) { pending.reject(new Error('Die Modulfunktion konnte nicht ausgeführt werden.')); return; }
    if (typeof message.json !== 'string' || Buffer.byteLength(message.json, 'utf8') > RESULT_BYTES) { pending.reject(new Error('Das Modulergebnis überschreitet die erlaubte Größe oder ist ungültig.')); return; }
    try { pending.resolve(JSON.parse(message.json)); } catch { pending.reject(new Error('Das Modul hat kein gültiges JSON-Ergebnis geliefert.')); }
  }

  async invoke(record: ModuleRuntimeRecord, toolName: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const runtime = this.runtimes.get(record.module.id);
    if (!runtime || runtime.fingerprint !== record.fingerprint || record.module.status !== 'ready') throw new Error('Das Modul ist nicht gestartet oder seine Freigabe ist nicht mehr gültig.');
    if (!record.module.manifest?.tools?.some(tool => tool.name === toolName)) throw new Error('Diese Funktion wurde vom Modul nicht deklariert.');
    const json = encodeArguments(args);
    await runtime.ready;
    signal?.throwIfAborted();
    if (runtime.stopped || !runtime.child) throw new Error('Der Modulprozess ist nicht verfügbar.');
    if (runtime.pending.size >= MAX_PENDING) throw new Error('Für dieses Modul laufen bereits zu viele Aufrufe.');
    return new Promise<unknown>((resolve, reject) => {
      const id = randomUUID();
      const onAbort = () => {
        const call = runtime.pending.get(id);
        if (!call || call.cancelled) return;
        call.cancelled = true; call.removeAbort(); reject(abortError());
        try { runtime.child?.postMessage({ type: 'cancel', id }); } catch { this.fail(runtime, 'Der Modulprozess ist nicht mehr erreichbar.'); }
      };
      const pending: PendingCall = { resolve, reject, cancelled: false, removeAbort: () => signal?.removeEventListener('abort', onAbort),
        timer: setTimeout(() => this.fail(runtime, 'Eine Modulfunktion hat die Frist von 60 Sekunden überschritten. Ihr Ergebnis ist unklar; es wird kein weiterer Versuch gestartet.'), INVOCATION_TIMEOUT_MS) };
      runtime.pending.set(id, pending);
      signal?.addEventListener('abort', onAbort, { once: true });
      try { runtime.child!.postMessage({ type: 'invoke', id, toolName, json }); }
      catch { this.fail(runtime, 'Der Modulaufruf konnte nicht übertragen werden.'); }
      if (signal?.aborted) onAbort();
    });
  }

  private fail(runtime: Runtime, reason: string): void {
    if (runtime.stopped) return;
    this.terminate(runtime, new Error(reason), true);
    try { this.options.onFailure?.(runtime.record.module.id, reason); } catch { /* A notification must not crash Electron main. */ }
  }

  private terminate(runtime: Runtime, error: Error, immediate: boolean): void {
    if (runtime.stopped) return;
    runtime.stopped = true;
    if (this.runtimes.get(runtime.record.module.id) === runtime) this.runtimes.delete(runtime.record.module.id);
    clearTimeout(runtime.startupTimer); runtime.rejectReady(error);
    for (const call of runtime.pending.values()) { clearTimeout(call.timer); call.removeAbort(); call.reject(error); }
    runtime.pending.clear();
    if (immediate) { runtime.child?.kill(); return; }
    try { runtime.child?.postMessage({ type: 'dispose' }); } catch { /* Already exited. */ }
    const child = runtime.child;
    if (child) { const timer = setTimeout(() => child.kill(), 250); timer.unref(); }
  }

  /** Cancelled calls remain busy until the worker acknowledges completion or exits. */
  isBusy(moduleId: string): boolean { const runtime = this.runtimes.get(moduleId); return !!runtime && (!runtime.started || runtime.pending.size > 0); }
  async stopAndWait(moduleId: string): Promise<void> {
    const runtime = this.runtimes.get(moduleId), child = runtime?.child;
    if (!runtime || !child) { this.stop(moduleId); return; }
    await new Promise<void>((resolve, reject) => {
      const finished = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { child.removeListener('exit', finished); child.kill(); reject(new Error('Der bisherige Modulprozess konnte nicht sicher beendet werden. Bitte OVD neu starten.')); }, 2000);
      child.once('exit', finished);
      this.stop(moduleId);
    });
  }
  stop(moduleId: string): void { const runtime = this.runtimes.get(moduleId); if (runtime) this.terminate(runtime, new Error('Das Modul wurde beendet.'), false); }
  dispose(): void { this.disposed = true; for (const id of [...this.runtimes.keys()]) this.stop(id); }
}

import { promises as fs, rmSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { simpleParser } from 'mailparser';
import type { MailTextPage } from '../../../shared/mail-content';

export const MAIL_TEXT_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAIL_HTML_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 8 * 1024 * 1024;
const CACHE_ENTRIES = 4;
const CACHE_IDLE_MS = 5 * 60_000;
const temporaryDirectories = new Set<string>();
process.once('exit', () => { for (const directory of temporaryDirectories) { try { rmSync(directory, { recursive: true, force: true }); } catch { /* OS temp cleanup remains available after an interrupted shutdown. */ } } });
let abandonedCleanup: Promise<void> | undefined;
async function removeAbandonedSpools(): Promise<void> {
  // Only this feature's directories from demonstrably dead processes are eligible.
  // Never remove another running OVD instance's cache, symlinks or another user's files.
  try {
    for (const name of await fs.readdir(os.tmpdir())) {
      const match = /^ovd-mail-text-(\d+)-[A-Za-z0-9]{6}$/.exec(name);
      if (!match) continue;
      const pid = Number(match[1]);
      if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) continue;
      try { process.kill(pid, 0); continue; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
      const directory = path.join(os.tmpdir(), name), info = await fs.lstat(directory).catch(() => undefined);
      if (!info?.isDirectory() || info.isSymbolicLink() || (typeof process.getuid === 'function' && info.uid !== process.getuid())) continue;
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
    }
  } catch { /* Normal expiry/exit cleanup still applies if temp enumeration is unavailable. */ }
}

/** Consumers share work, not cancellation: abort I/O only when nobody needs it. */
export class SharedMailReads<T> {
  private readonly pending = new Map<string, { controller: AbortController; promise: Promise<T>; consumers: number; settled: boolean }>();
  constructor(private readonly maxPending = Number.POSITIVE_INFINITY) {}
  run(key: string, signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.pending.get(key);
    if (entry?.controller.signal.aborted) { this.pending.delete(key); entry = undefined; }
    if (!entry) {
      if (this.pending.size >= this.maxPending) return Promise.reject(new MailContentError('Es werden bereits lange Mailtexte geladen. Bitte den laufenden Abruf abwarten.'));
      const controller = new AbortController();
      const created = { controller, promise: undefined! as Promise<T>, consumers: 0, settled: false };
      created.promise = Promise.resolve().then(() => work(controller.signal)).finally(() => {
        created.settled = true;
        if (this.pending.get(key) === created) this.pending.delete(key);
      });
      entry = created; this.pending.set(key, created);
    }
    const current = entry;
    current.consumers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const release = () => {
        if (finished) return false;
        finished = true; signal?.removeEventListener('abort', abort);
        current.consumers--;
        if (!current.consumers && !current.settled) current.controller.abort();
        return true;
      };
      const abort = () => { if (release()) reject(signal?.reason ?? new DOMException('Abgebrochen', 'AbortError')); };
      signal?.addEventListener('abort', abort, { once: true });
      current.promise.then(value => { if (release()) resolve(value); }, error => { if (release()) reject(error); });
      if (signal?.aborted) abort();
    });
  }
  cancel(prefix: string): void {
    for (const [key, entry] of this.pending) if (key.startsWith(prefix)) { this.pending.delete(key); entry.controller.abort(); }
  }
}

export class MailContentError extends Error {}

const high = (value: number) => value >= 0xd800 && value <= 0xdbff;
const low = (value: number) => value >= 0xdc00 && value <= 0xdfff;
async function writeAll(file: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) { const written = await file.write(bytes, offset, bytes.length - offset); if (!written.bytesWritten) throw new MailContentError('Der temporäre Mailtext konnte nicht gespeichert werden.'); offset += written.bytesWritten; }
}

/** The full text stays on disk; each page reads only a bounded UTF-16 window. */
export class MailTextSpool {
  private readers = 0;
  private retired = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly directory: string, private readonly filename: string, readonly totalCharacters: number, readonly sourceBytes: number, readonly sourceVersion: string, readonly observedAt: string) {}
  touch(onExpire: () => void): void { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(onExpire, CACHE_IDLE_MS); this.timer.unref(); }
  dispose(): void { this.retired = true; if (this.timer) clearTimeout(this.timer); if (!this.readers) this.remove(); }
  private remove(): void { void fs.rm(this.directory, { recursive: true, force: true }).then(() => temporaryDirectories.delete(this.directory), () => {}); }
  async page(offset: number, limit: number, signal?: AbortSignal): Promise<MailTextPage> {
    signal?.throwIfAborted();
    if (this.retired) throw new MailContentError('Der Mailtext wurde aus dem Zwischenspeicher entfernt. Bitte den Abschnitt erneut laden.');
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.totalCharacters) throw new MailContentError('Die Leseposition liegt außerhalb dieses Mailtexts.');
    this.readers++;
    let file: FileHandle | undefined;
    try {
      file = await fs.open(this.filename, 'r');
      const size = Math.min(limit + 1, this.totalCharacters - offset) * 2, bytes = Buffer.alloc(size);
      let count = 0;
      while (count < size) { signal?.throwIfAborted(); const read = await file.read(bytes, count, size - count, offset * 2 + count); if (!read.bytesRead) throw new MailContentError('Der gespeicherte Mailtext ist unvollständig. Bitte erneut laden.'); count += read.bytesRead; }
      signal?.throwIfAborted();
      const loaded = bytes.toString('utf16le');
      if (offset > 0 && low(loaded.charCodeAt(0))) throw new MailContentError('Ungültige Leseposition innerhalb eines Zeichens. Bitte den vorherigen Abschnitt verwenden.');
      let length = Math.min(limit, loaded.length);
      if (length < loaded.length && high(loaded.charCodeAt(length - 1)) && low(loaded.charCodeAt(length))) length--;
      const makePage = (): MailTextPage => {
        const complete = offset + length === this.totalCharacters;
        return { text: loaded.slice(0, length), offset, offsetUnit: 'UTF-16', returnedCharacters: length, totalCharacters: this.totalCharacters, sourceBytes: this.sourceBytes, sourceVersion: this.sourceVersion, observedAt: this.observedAt, complete,
          ...(!complete ? { nextCursor: Buffer.from(JSON.stringify({ v: 1, version: this.sourceVersion, offset: offset + length })).toString('base64url') } : {}) };
      };
      let page = makePage();
      // JSON escaping can multiply control characters sixfold. Leave room for
      // enclosing metadata without the host sanitizer discarding continuation.
      while (JSON.stringify(page).length > 16_000) {
        length = Math.max(2, Math.floor(length * 0.8));
        if (high(loaded.charCodeAt(length - 1)) && low(loaded.charCodeAt(length))) length--;
        page = makePage();
      }
      return page;
    } finally { try { await file?.close(); } finally { this.readers--; if (this.retired && !this.readers) this.remove(); } }
  }
}

export class MailTextCache {
  private readonly entries = new Map<string, MailTextSpool>();
  get(key: string): MailTextSpool | undefined {
    const value = this.entries.get(key);
    if (value) { this.entries.delete(key); this.entries.set(key, value); value.touch(() => this.delete(key, value)); }
    return value;
  }
  set(key: string, value: MailTextSpool): void {
    const prior = this.entries.get(key); if (prior && prior !== value) prior.dispose();
    this.entries.delete(key); this.entries.set(key, value); value.touch(() => this.delete(key, value));
    while (this.entries.size > CACHE_ENTRIES) { const first = this.entries.entries().next().value!; this.delete(first[0], first[1]); }
  }
  private delete(key: string, expected: MailTextSpool): void { if (this.entries.get(key) === expected) this.entries.delete(key); expected.dispose(); }
  clear(prefix: string): void { for (const [key, value] of this.entries) if (key.startsWith(prefix)) this.delete(key, value); }
}

/** ImapFlow.download already decodes transfer encoding and converts text to UTF-8. */
export async function spoolMailText(content: Readable, html: boolean, sourceVersion: string, signal: AbortSignal): Promise<MailTextSpool> {
  const sourceLimit = html ? MAIL_HTML_SOURCE_BYTES : MAIL_TEXT_SOURCE_BYTES;
  let directory: string | undefined, file: FileHandle | undefined;
  const abort = () => content.destroy(signal.reason instanceof Error ? signal.reason : new DOMException('Abgebrochen', 'AbortError'));
  content.on('error', () => { /* Iterator observes errors; also cover cancellation before iteration. */ });
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await (abandonedCleanup ??= removeAbandonedSpools()); signal.throwIfAborted();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), `ovd-mail-text-${process.pid}-`)); temporaryDirectories.add(directory);
    const filename = path.join(directory, 'body.utf16');
    file = await fs.open(filename, 'wx+', 0o600);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let sourceBytes = 0, totalCharacters = 0;
    const append = async (text: string) => {
      totalCharacters += text.length;
      if (totalCharacters > MAX_TEXT_CHARACTERS) throw new MailContentError('Der vollständige Mailtext überschreitet die Lesegrenze von 8 Millionen Zeichen.');
      await writeAll(file!, Buffer.from(text, 'utf16le'));
    };
    for await (const chunk of content) {
      signal.throwIfAborted();
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sourceBytes += bytes.length;
      if (sourceBytes > sourceLimit) throw new MailContentError(`Der Mailinhalt überschreitet die Lesegrenze von ${sourceLimit / 1024 / 1024} MiB. Die bisherigen Ausschnitte bleiben verfügbar.`);
      await append(decoder.decode(bytes, { stream: true }));
    }
    await append(decoder.decode()); signal.throwIfAborted();
    if (html) {
      // Conversion receives only one complete bounded text part, never attachments.
      // No renderer/network is involved, so remote images and styles stay untouched.
      const raw = (await fs.readFile(filename)).toString('utf16le');
      signal.throwIfAborted();
      const parsed = await simpleParser(`Content-Type: text/html; charset=utf-8\r\n\r\n${raw}`, { skipImageLinks: true, skipTextToHtml: true, maxHtmlLengthToParse: MAIL_HTML_SOURCE_BYTES });
      signal.throwIfAborted();
      const text = parsed.text ?? '';
      if (text.length > MAX_TEXT_CHARACTERS) throw new MailContentError('Der vollständige Mailtext überschreitet die Lesegrenze von 8 Millionen Zeichen.');
      await file.close(); file = await fs.open(filename, 'w', 0o600); totalCharacters = 0; await append(text);
    }
    await file.close(); file = undefined; signal.throwIfAborted();
    return new MailTextSpool(directory, filename, totalCharacters, sourceBytes, sourceVersion, new Date().toISOString());
  } catch (error) {
    content.destroy(); await file?.close().catch(() => {});
    if (directory) { await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); temporaryDirectories.delete(directory); }
    signal.throwIfAborted();
    if (error instanceof MailContentError) throw error;
    if (error instanceof TypeError) throw new MailContentError('Die Zeichenkodierung dieses Mailtexts konnte nicht vollständig gelesen werden.');
    throw new MailContentError('Der vollständige Mailtext konnte nicht geladen oder zwischengespeichert werden.');
  } finally { signal.removeEventListener('abort', abort); }
}

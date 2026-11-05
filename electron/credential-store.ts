import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const MAX_PLAINTEXT_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_SECRET_BYTES = 128 * 1024;
const associatedData = Buffer.from('OpenVibeDesk local credentials v1', 'utf8');
const payloadSchema = z.object({ version: z.literal(1), entries: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.string().max(MAX_SECRET_BYTES)) }).strict();
const envelopeSchema = z.object({ version: z.literal(1), nonce: z.string(), tag: z.string(), ciphertext: z.string() }).strict();
type Entries = Record<string, string>;
export interface CredentialStorageStatus { storage: 'local-encrypted-file'; available: boolean; hasCredentials: boolean; error?: string; }

function unavailable(): Error {
  return new Error('Der lokale Zugangsdaten-Speicher ist nicht verfügbar. Vorhandene Dateien wurden nicht zurückgesetzt. Bitte OVD neu starten und das Profil prüfen.');
}
function identity(service: string, account: string): string {
  if (typeof service !== 'string' || !service || service.length > 256 || typeof account !== 'string' || !account || account.length > 2048 || /[\u0000-\u001f\u007f]/.test(service + account)) throw new Error('Ungültige Zugangsdaten-Kennung.');
  return createHash('sha256').update(JSON.stringify([service, account])).digest('hex');
}
function decode(value: string, bytes?: number): Buffer {
  const buffer = Buffer.from(value, 'base64');
  if (buffer.toString('base64') !== value || bytes !== undefined && buffer.length !== bytes) throw unavailable();
  return buffer;
}

/** Prompt-free local encryption. The key lives beside the vault, not in an OS keychain. */
export class LocalCredentialStore {
  private readonly directory: string;
  private readonly keyFile: string;
  private readonly vaultFile: string;
  private key?: Buffer;
  private entries: Entries = Object.create(null) as Entries;
  private initialization?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private fault?: Error;

  constructor(readonly dataDirectory: string) {
    this.directory = path.join(path.resolve(dataDirectory), 'credentials');
    this.keyFile = path.join(this.directory, 'local.key');
    this.vaultFile = path.join(this.directory, 'vault.json');
  }
  private async syncDirectory(): Promise<void> {
    if (process.platform === 'win32') return;
    const directory = await fs.open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  private async readFile(file: string, maximum: number): Promise<Buffer | undefined> {
    let stat;
    try { stat = await fs.lstat(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw unavailable();
    if (process.platform !== 'win32') await fs.chmod(file, 0o600);
    const bytes = await fs.readFile(file);
    if (bytes.length > maximum) throw unavailable();
    return bytes;
  }
  initialize(): Promise<void> {
    if (!this.initialization) this.initialization = (async () => {
      try {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
        const directory = await fs.lstat(this.directory);
        if (!directory.isDirectory() || directory.isSymbolicLink()) throw unavailable();
        if (process.platform !== 'win32') await fs.chmod(this.directory, 0o700);
        const vault = await this.readFile(this.vaultFile, MAX_FILE_BYTES);
        let key = await this.readFile(this.keyFile, 32);
        if (!key) {
          // A missing key must never replace the key for an existing vault.
          if (vault) throw unavailable();
          key = randomBytes(32);
          const file = await fs.open(this.keyFile, 'wx', 0o600);
          try { await file.writeFile(key); await file.sync(); } finally { await file.close(); }
          await this.syncDirectory();
        }
        if (key.length !== 32) throw unavailable();
        if (vault) {
          const envelope = envelopeSchema.parse(JSON.parse(vault.toString('utf8')));
          const encrypted = decode(envelope.ciphertext);
          if (encrypted.length > MAX_PLAINTEXT_BYTES) throw unavailable();
          const decipher = createDecipheriv('aes-256-gcm', key, decode(envelope.nonce, 12));
          decipher.setAAD(associatedData); decipher.setAuthTag(decode(envelope.tag, 16));
          const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
          const payload = payloadSchema.parse(JSON.parse(plaintext.toString('utf8')));
          if (Object.keys(payload.entries).length > 10000 || Object.values(payload.entries).some(value => Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES)) throw unavailable();
          this.entries = Object.assign(Object.create(null) as Entries, payload.entries);
        }
        this.key = key;
      } catch {
        this.fault = unavailable();
        throw this.fault;
      }
    })();
    return this.initialization;
  }
  private assertAvailable(): void { if (this.fault || !this.key) throw this.fault ?? unavailable(); }
  async get(service: string, account: string): Promise<string | null> {
    const id = identity(service, account);
    await this.initialize(); await this.queue; this.assertAvailable();
    return this.entries[id] ?? null;
  }
  private write(change: (entries: Entries) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      await this.initialize(); this.assertAvailable();
      const entries = Object.assign(Object.create(null) as Entries, this.entries);
      change(entries);
      const plaintext = Buffer.from(JSON.stringify({ version: 1, entries }), 'utf8');
      if (Object.keys(entries).length > 10000 || plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('Der lokale Zugangsdaten-Speicher ist voll.');
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key!, nonce);
      cipher.setAAD(associatedData);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope = JSON.stringify({ version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
      const temporary = path.join(this.directory, `vault.${randomUUID()}.tmp`);
      let renamed = false;
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(envelope); await file.sync(); } finally { await file.close(); }
        await fs.rename(temporary, this.vaultFile); renamed = true;
        await this.syncDirectory();
        this.entries = entries;
      } catch {
        // A rename followed by an uncertain directory flush may have committed.
        // Never overwrite that version from stale in-memory credentials.
        if (renamed) this.fault = unavailable();
        throw this.fault ?? new Error('Die Zugangsdaten konnten nicht lokal gespeichert werden.');
      } finally { await fs.unlink(temporary).catch(() => {}); }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  set(service: string, account: string, value: string): Promise<void> {
    const id = identity(service, account);
    if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) return Promise.reject(new Error('Ungültige oder zu große Zugangsdaten.'));
    return this.write(entries => { entries[id] = value; });
  }
  delete(service: string, account: string): Promise<void> {
    const id = identity(service, account);
    return this.write(entries => { delete entries[id]; });
  }
  async status(): Promise<CredentialStorageStatus> {
    try { await this.initialize(); await this.queue; this.assertAvailable(); return { storage: 'local-encrypted-file', available: true, hasCredentials: Object.keys(this.entries).length > 0 }; }
    catch { return { storage: 'local-encrypted-file', available: false, hasCredentials: false, error: unavailable().message }; }
  }
}

let store: LocalCredentialStore | undefined;
export function initializeCredentialStore(options: { dataDirectory: string }): Promise<void> {
  if (store && path.resolve(store.dataDirectory) !== path.resolve(options.dataDirectory)) throw new Error('Der Zugangsdaten-Speicher wurde bereits für ein anderes Profil eingerichtet.');
  store ??= new LocalCredentialStore(options.dataDirectory);
  return store.initialize();
}
export async function credentialStorageStatus(): Promise<CredentialStorageStatus> {
  return store ? store.status() : { storage: 'local-encrypted-file', available: false, hasCredentials: false, error: unavailable().message };
}
/** Same service/account identity as before; no automatic access to legacy OS entries. */
export function localCredentialEntry(service: string, account: string) {
  identity(service, account);
  const current = () => { if (!store) throw unavailable(); return store; };
  return {
    getPassword: () => current().get(service, account),
    setPassword: (value: string) => current().set(service, account, value),
    deletePassword: () => current().delete(service, account)
  };
}

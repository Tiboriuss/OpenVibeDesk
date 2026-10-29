import { AsyncEntry } from '@napi-rs/keyring';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { moduleRepositoryInputSchema, repositoryCatalogSchema, repositoryInstallInputSchema, repositoryModuleIdSchema, repositoryVersionSchema, type ModuleRepositoryInput, type RepositoryCatalog, type RepositoryCatalogModule, type RepositoryInstallInput, type RepositoryInstallResult, type RepositoryModule, type RepositoryState } from '../shared/module-repositories';
import type { ModuleInfo } from '../shared/modules';
import { ModuleRegistry, type ModuleRuntimeRecord } from './modules';

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const CATALOG_NAME = 'ovd-modules.json';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const sourceSchema = z.object({ id: z.string().uuid(), title: z.string().min(1).max(120), url: z.string().max(2048), kind: z.enum(['github', 'https']), tokenKey: z.string().uuid().optional() }).strict();
const receiptSchema = z.object({ sourceId: z.string().uuid(), sourceUrl: z.string().max(2048), version: repositoryVersionSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const configSchema = z.object({ version: z.literal(1), sources: z.array(sourceSchema).max(50), installations: z.record(repositoryModuleIdSchema, receiptSchema) }).strict();
type StoredSource = z.infer<typeof sourceSchema>;
type StoredConfig = z.infer<typeof configSchema>;
type CatalogSnapshot = { catalog?: RepositoryCatalog; rootTree?: string; status: 'unloaded' | 'loading' | 'ready' | 'error'; error?: string; checkedAt?: string };
type GitTree = { path: string; mode: string; type: string; sha: string; size?: number }[];

export interface RepositorySecrets { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; }
const secretEntry = (key: string) => new AsyncEntry('OpenVibeDesk Module Repositories', key, { linux: { store: 'secret-service' } });
const keychain: RepositorySecrets = {
  async get(key) { try { return await secretEntry(key).getPassword(); } catch { throw new Error('Der sichere Zugangsdaten-Speicher ist nicht verfügbar.'); } },
  async set(key, value) { try { await secretEntry(key).setPassword(value); } catch { throw new Error('Das Repository-Token konnte nicht sicher gespeichert werden.'); } },
  async delete(key) { try { await secretEntry(key).deletePassword(); } catch { throw new Error('Das Repository-Token konnte nicht entfernt werden.'); } }
};
export interface RepositoryPackageInstallation {
  moduleId: string; stagedDirectory: string; expectedFingerprint?: string; commit(): Promise<void>;
}
export interface ModuleRepositoryOptions {
  configFile: string; userRoot: string;
  getInstalled(id: string): ModuleRuntimeRecord | undefined;
  installPackage(input: RepositoryPackageInstallation, signal?: AbortSignal): Promise<ModuleInfo>;
  changed(): void;
  /** Injected only for local practical checks. Production uses native HTTPS fetch and OS credentials. */
  fetch?: typeof fetch; secrets?: RepositorySecrets;
}

export function normalizeRepositoryUrl(raw: string): { url: string; kind: 'github' | 'https'; owner?: string; repository?: string } {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('Bitte eine GitHub-Repository-URL oder eine HTTPS-Katalog-URL eingeben.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Repository-URLs benötigen HTTPS und dürfen keine Zugangsdaten, Abfrageparameter oder Fragmente enthalten.');
  if (url.hostname.toLowerCase() === 'github.com') {
    const parts = url.pathname.replace(/\/$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
    if (url.port || parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_.-]+$/.test(part)) || parts.some(part => part === '.' || part === '..')) throw new Error('Für GitHub bitte die Repository-URL ohne Datei- oder Branch-Pfad eingeben.');
    return { url: `https://github.com/${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`, kind: 'github', owner: parts[0].toLowerCase(), repository: parts[1].toLowerCase() };
  }
  if (!url.pathname.toLowerCase().endsWith('.json')) throw new Error('Eine HTTPS-Quelle muss direkt auf ihren JSON-Modulkatalog verweisen.');
  return { url: url.toString(), kind: 'https' };
}

/** SemVer precedence; never offer a downgrade or silently replace a published version. */
function compareVersions(left: string, right: string): number {
  const [a, apre] = left.split(/-(.*)/s), [b, bpre] = right.split(/-(.*)/s);
  const an = a.split('.').map(BigInt), bn = b.split('.').map(BigInt);
  for (let index = 0; index < 3; index++) if (an[index] !== bn[index]) return an[index] > bn[index] ? 1 : -1;
  if (apre === undefined || bpre === undefined) return apre === bpre ? 0 : apre === undefined ? 1 : -1;
  const ap = apre.split('.'), bp = bpre.split('.');
  for (let index = 0; index < Math.max(ap.length, bp.length); index++) {
    if (ap[index] === bp[index]) continue;
    if (ap[index] === undefined || bp[index] === undefined) return ap[index] === undefined ? -1 : 1;
    const ai = /^\d+$/.test(ap[index]), bi = /^\d+$/.test(bp[index]);
    if (ai && bi) { if (BigInt(ap[index]) === BigInt(bp[index])) continue; return BigInt(ap[index]) > BigInt(bp[index]) ? 1 : -1; }
    if (ai !== bi) return ai ? -1 : 1;
    return ap[index] > bp[index] ? 1 : -1;
  }
  return 0;
}
function message(error: unknown): string {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return 'Der Modulkatalog entspricht nicht dem unterstützten Format (Version 1).';
  return error instanceof Error ? error.message.slice(0, 500) : 'Die Modulquelle konnte nicht verarbeitet werden.';
}

/** Repository content is metadata until a separately approved module is activated by ModuleHost. */
export class ModuleRepositoryService {
  private config: StoredConfig = { version: 1, sources: [], installations: {} };
  private available = true;
  private busy = false;
  private readonly snapshots = new Map<string, CatalogSnapshot>();
  private readonly trees = new Map<string, GitTree>();
  private readonly fetcher: typeof fetch;
  private readonly secrets: RepositorySecrets;
  constructor(private readonly options: ModuleRepositoryOptions) { this.fetcher = options.fetch ?? fetch; this.secrets = options.secrets ?? keychain; }

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.options.configFile), { recursive: true });
    await fs.mkdir(this.options.userRoot, { recursive: true });
    try {
      const stat = await fs.lstat(this.options.configFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CATALOG_BYTES) throw new Error('Ungültige Quellenkonfiguration.');
      const parsed = configSchema.parse(JSON.parse(await fs.readFile(this.options.configFile, 'utf8')));
      if (new Set(parsed.sources.map(source => source.id)).size !== parsed.sources.length || new Set(parsed.sources.map(source => normalizeRepositoryUrl(source.url).url)).size !== parsed.sources.length) throw new Error('Doppelte Quellenkonfiguration.');
      for (const source of parsed.sources) { const normalized = normalizeRepositoryUrl(source.url); if (normalized.kind !== source.kind) throw new Error('Ungültiger Quellentyp.'); source.url = normalized.url; }
      for (const receipt of Object.values(parsed.installations)) normalizeRepositoryUrl(receipt.sourceUrl);
      this.config = parsed;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.available = false; }
  }
  list(): RepositoryState {
    const sources = this.config.sources.map(source => {
      const snapshot = this.snapshots.get(source.id);
      return { id: source.id, title: source.title, url: source.url, kind: source.kind, tokenConfigured: !!source.tokenKey, status: snapshot?.status ?? 'unloaded' as const, moduleCount: snapshot?.catalog?.modules.length ?? 0, ...(snapshot?.error ? { error: snapshot.error } : {}), ...(snapshot?.checkedAt ? { checkedAt: snapshot.checkedAt } : {}) };
    });
    const modules = this.config.sources.flatMap(source => (this.snapshots.get(source.id)?.catalog?.modules ?? []).map(entry => this.moduleSummary(source, entry)));
    return { sources, modules, busy: this.busy, ...(!this.available ? { error: 'Die gespeicherte Quellenkonfiguration ist nicht lesbar. Sie wurde nicht überschrieben; bitte die Konfigurationsdatei prüfen oder aus einer Sicherung wiederherstellen.' } : {}) };
  }
  /** Startup recovery must distinguish a completed receipt commit from an interrupted swap. */
  isPackageCommitted(moduleId: string, fingerprint: string): boolean { return this.available && Object.hasOwn(this.config.installations, moduleId) && this.config.installations[moduleId]?.fingerprint === fingerprint; }
  private moduleSummary(source: StoredSource, entry: RepositoryCatalogModule): RepositoryModule {
    const installed = this.options.getInstalled(entry.id), receipt = Object.hasOwn(this.config.installations, entry.id) ? this.config.installations[entry.id] : undefined;
    const summary: RepositoryModule = { sourceId: source.id, id: entry.id, title: entry.title, description: entry.description, version: entry.version, apiVersion: entry.apiVersion, status: 'available', ...(installed ? { installedVersion: installed.module.version } : {}) };
    if (entry.apiVersion !== 1) return { ...summary, status: 'incompatible', reason: 'Diese Modul-API-Version wird von OVD nicht unterstützt.' };
    if (installed) {
      if (installed.module.source !== 'user' || !receipt || normalizeRepositoryUrl(receipt.sourceUrl).url !== source.url || receipt.sourceId !== source.id || installed.fingerprint !== receipt.fingerprint || path.resolve(installed.rootPath) !== path.resolve(this.options.userRoot, entry.id)) return { ...summary, status: 'conflict', reason: 'Diese Modul-ID ist bereits lokal oder aus einer anderen Quelle installiert bzw. wurde lokal verändert.' };
      const order = compareVersions(entry.version, installed.module.version);
      return { ...summary, status: order > 0 ? 'update' : 'installed', ...(order < 0 ? { reason: 'Lokal ist bereits eine neuere Version installiert.' } : {}) };
    }
    return summary;
  }
  private assertAvailable(): void { if (!this.available) throw new Error('Die Quellenkonfiguration konnte nicht gelesen werden. Die vorhandene Datei wurde nicht überschrieben.'); }
  private notify(): void { try { this.options.changed(); } catch { /* A closed renderer does not undo a committed operation. */ } }
  private async operation<T>(run: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    if (this.busy) throw new Error('Die Modulquellen werden gerade verarbeitet. Bitte kurz warten.');
    this.busy = true; this.notify();
    try { return await run(); } finally { this.busy = false; this.notify(); }
  }
  private source(id: string): StoredSource {
    z.string().uuid().parse(id);
    const source = this.config.sources.find(item => item.id === id);
    if (!source) throw new Error('Modulquelle nicht gefunden.');
    return source;
  }
  private async persist(next: StoredConfig): Promise<void> {
    this.assertAvailable();
    const parsed = configSchema.parse(next), temp = `${this.options.configFile}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(parsed, null, 2), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, this.options.configFile);
      this.config = parsed;
    } catch { throw new Error('Die Modulquellen konnten nicht gespeichert werden. Die bisherige Konfiguration bleibt erhalten.'); }
    finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  /** Do not commit removal/replacement metadata until the old secret is actually removed. */
  private async persistWithToken(next: StoredConfig, oldKey?: string, newKey?: string, newToken?: string): Promise<void> {
    if (oldKey === newKey) { await this.persist(next); return; }
    const oldToken = oldKey ? await this.secrets.get(oldKey) : null;
    let replacementAttempted = false, deletionAttempted = false;
    try {
      if (newKey && newToken) { replacementAttempted = true; await this.secrets.set(newKey, newToken); }
      if (oldKey && oldToken !== null) { deletionAttempted = true; await this.secrets.delete(oldKey); }
      await this.persist(next);
    } catch (error) {
      let restoreFailed = false, cleanupFailed = false;
      // A credential provider may delete and then fail; restore even when deletion rejected.
      if (deletionAttempted && oldKey && oldToken !== null) try { await this.secrets.set(oldKey, oldToken); } catch { restoreFailed = true; }
      if (replacementAttempted && newKey) try { await this.secrets.delete(newKey); } catch { cleanupFailed = true; }
      if (restoreFailed || cleanupFailed) throw new Error('Die Modulquelle wurde nicht geändert. Der Zugangsdaten-Speicher konnte die vorherigen Tokens nicht vollständig wiederherstellen. Bitte den sicheren Speicher prüfen und das Token erneut eingeben.');
      throw error;
    }
  }
  async save(raw: ModuleRepositoryInput): Promise<RepositoryState> {
    await this.operation(async () => {
      const input = moduleRepositoryInputSchema.parse(raw), normalized = normalizeRepositoryUrl(input.url), old = input.id ? this.source(input.id) : undefined;
      if (!old && this.config.sources.length >= 50) throw new Error('Es können höchstens 50 Modulquellen eingerichtet werden.');
      if (this.config.sources.some(item => item.id !== old?.id && normalizeRepositoryUrl(item.url).url === normalized.url)) throw new Error('Diese Modulquelle ist bereits eingerichtet.');
      if (old?.tokenKey && old.url !== normalized.url && !input.token && !input.removeToken) throw new Error('Für eine geänderte Repository-URL bitte ein neues Token eingeben oder das gespeicherte Token entfernen.');
      const tokenKey = input.token ? randomUUID() : input.removeToken ? undefined : old?.tokenKey;
      // Re-adding the exact former source restores update provenance, never grants execution approval.
      const priorSourceId = Object.values(this.config.installations).find(receipt => normalizeRepositoryUrl(receipt.sourceUrl).url === normalized.url && !this.config.sources.some(item => item.id === receipt.sourceId))?.sourceId;
      const next: StoredSource = { id: old?.id ?? priorSourceId ?? randomUUID(), title: input.title || normalized.repository || new URL(normalized.url).hostname, url: normalized.url, kind: normalized.kind, ...(tokenKey ? { tokenKey } : {}) };
      await this.persistWithToken({ ...this.config, sources: old ? this.config.sources.map(item => item.id === old.id ? next : item) : [...this.config.sources, next] }, old?.tokenKey, tokenKey, input.token);
      this.snapshots.delete(next.id); this.trees.clear();
    });
    return this.list();
  }
  async remove(id: string): Promise<RepositoryState> {
    await this.operation(async () => {
      const old = this.source(id);
      await this.persistWithToken({ ...this.config, sources: this.config.sources.filter(item => item.id !== id) }, old.tokenKey);
      this.snapshots.delete(id); this.trees.clear();
    });
    return this.list();
  }
  private async token(source: StoredSource): Promise<string | undefined> {
    if (!source.tokenKey) return undefined;
    const token = await this.secrets.get(source.tokenKey);
    if (!token) throw new Error('Das gespeicherte Repository-Token fehlt. Bitte in den Einstellungen erneut eingeben.');
    return token;
  }
  private async request(url: string, source: StoredSource, token: string | undefined, maxBytes: number, signal: AbortSignal, raw = false): Promise<Buffer> {
    const destination = new URL(url), origin = source.kind === 'github' ? 'https://api.github.com' : new URL(source.url).origin;
    if (destination.protocol !== 'https:' || destination.origin !== origin || destination.username || destination.password) throw new Error('Paketdateien müssen vom selben Repository-Ursprung stammen.');
    const headers: Record<string, string> = { Accept: source.kind === 'github' ? raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': 'OpenVibeDesk' };
    if (source.kind === 'github') headers['X-GitHub-Api-Version'] = '2026-03-10';
    if (token) headers.Authorization = `Bearer ${token}`;
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    let response: Response;
    try { response = await this.fetcher(destination, { headers, signal: requestSignal, redirect: 'manual', credentials: 'omit' }); }
    catch { if (signal.aborted) throw new Error('Der Repository-Vorgang wurde abgebrochen.'); throw new Error('Die Modulquelle ist nicht erreichbar oder antwortet nicht rechtzeitig.'); }
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('Die Modulquelle leitet auf eine andere Adresse um. Bitte die endgültige URL direkt eintragen.'); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new Error('Zugriff verweigert oder API-Limit erreicht. Token, Repository-Berechtigung und gegebenenfalls Organisationsfreigabe prüfen.');
      if (response.status === 404) throw new Error('Repository, Katalog oder Paketdatei nicht gefunden. Bei privaten Repositories bitte das Token und dessen Leseberechtigung prüfen.');
      if (response.status === 409) throw new Error('Das Repository ist noch leer oder momentan nicht lesbar. Bitte zuerst einen Modulkatalog veröffentlichen.');
      throw new Error(`Die Modulquelle meldet HTTP ${response.status}.`);
    }
    const length = response.headers.get('content-length');
    if (length && Number(length) > maxBytes) { await response.body?.cancel(); throw new Error('Die Antwort der Modulquelle überschreitet die zulässige Größe.'); }
    if (!response.body) throw new Error('Die Modulquelle lieferte keine Datei.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        requestSignal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        if ((size += chunk.value.byteLength) > maxBytes) throw new Error('Die Antwort der Modulquelle überschreitet die zulässige Größe.');
        chunks.push(chunk.value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); if (requestSignal.aborted) throw new Error('Der Repository-Abruf wurde abgebrochen oder hat zu lange gedauert.'); if (error instanceof Error && error.message === 'Die Antwort der Modulquelle überschreitet die zulässige Größe.') throw error; throw new Error('Die Datei konnte nicht vollständig von der Modulquelle geladen werden.'); }
    finally { reader.releaseLock(); }
    return Buffer.concat(chunks, size);
  }
  private gitApi(source: StoredSource): string {
    const parsed = normalizeRepositoryUrl(source.url);
    return `https://api.github.com/repos/${encodeURIComponent(parsed.owner!)}/${encodeURIComponent(parsed.repository!)}`;
  }
  private async json(url: string, source: StoredSource, token: string | undefined, signal: AbortSignal): Promise<unknown> { return JSON.parse((await this.request(url, source, token, MAX_CATALOG_BYTES, signal)).toString('utf8')); }
  private async githubFile(source: StoredSource, rootTree: string, filePath: string, token: string | undefined, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
    let current = rootTree;
    const parts = filePath.split('/');
    for (let index = 0; index < parts.length; index++) {
      const cacheKey = `${source.id}:${current}`;
      let tree = this.trees.get(cacheKey);
      if (!tree) {
        const value = z.object({ truncated: z.boolean().optional(), tree: z.array(z.object({ path: z.string().max(1024), mode: z.string().max(10), type: z.string().max(10), sha, size: z.number().int().nonnegative().optional() })).max(10000) }).parse(await this.json(`${this.gitApi(source)}/git/trees/${sha.parse(current)}`, source, token, signal));
        if (value.truncated) throw new Error('Ein Repository-Verzeichnis ist zu groß und wurde unvollständig geliefert.');
        tree = value.tree;
        this.trees.set(cacheKey, tree);
        while (this.trees.size > 64 || [...this.trees.values()].reduce((total, entries) => total + entries.length, 0) > 20_000) this.trees.delete(this.trees.keys().next().value!);
      }
      const entry = tree.find(item => item.path === parts[index]);
      if (!entry) throw new Error(`Die Datei ${filePath.slice(0, 240)} fehlt im veröffentlichten Repository-Stand.`);
      if (index < parts.length - 1) {
        if (entry.type !== 'tree' || entry.mode !== '040000') throw new Error('Paketpfade dürfen keine Symlinks oder Git-Submodule enthalten.');
        current = entry.sha;
      } else {
        if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) throw new Error('Paketdateien müssen reguläre Dateien sein; Symlinks und Git-Submodule sind nicht zulässig.');
        if (entry.size !== undefined && entry.size > maxBytes) throw new Error('Die Paketdatei überschreitet die zulässige Größe.');
        return this.request(`${this.gitApi(source)}/git/blobs/${entry.sha}`, source, token, maxBytes, signal, true);
      }
    }
    throw new Error('Ungültiger Paketpfad.');
  }
  async refresh(sourceId?: string, signal?: AbortSignal): Promise<RepositoryState> {
    await this.operation(async () => {
      const selected = sourceId ? [this.source(sourceId)] : this.config.sources;
      for (const source of selected) {
        signal?.throwIfAborted();
        const previous = this.snapshots.get(source.id);
        this.snapshots.set(source.id, { ...previous, status: 'loading', error: undefined }); this.notify();
        try {
          const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60_000)]), token = await this.token(source);
          let bytes: Buffer, rootTree: string | undefined;
          if (source.kind === 'github') {
            const commits = z.array(z.object({ sha, commit: z.object({ tree: z.object({ sha }) }) })).min(1).max(1).parse(await this.json(`${this.gitApi(source)}/commits?per_page=1`, source, token, requestSignal));
            rootTree = commits[0].commit.tree.sha;
            bytes = await this.githubFile(source, rootTree, CATALOG_NAME, token, MAX_CATALOG_BYTES, requestSignal);
          } else bytes = await this.request(source.url, source, token, MAX_CATALOG_BYTES, requestSignal);
          const catalog = repositoryCatalogSchema.parse(JSON.parse(bytes.toString('utf8')));
          this.snapshots.set(source.id, { status: 'ready', catalog, ...(rootTree ? { rootTree } : {}), checkedAt: new Date().toISOString() });
        } catch (error) { this.snapshots.set(source.id, { ...previous, status: 'error', error: message(error) }); }
        this.notify();
      }
    });
    return this.list();
  }
  async install(raw: RepositoryInstallInput, signal?: AbortSignal): Promise<RepositoryInstallResult> {
    return this.operation(async () => {
      const input = repositoryInstallInputSchema.parse(raw), source = this.source(input.sourceId), snapshot = this.snapshots.get(source.id);
      if (snapshot?.status !== 'ready' || !snapshot.catalog) throw new Error('Die Modulquelle bitte zuerst erfolgreich aktualisieren.');
      const entry = snapshot.catalog.modules.find(item => item.id === input.moduleId && item.version === input.version);
      if (!entry) throw new Error('Diese Modulversion wird von der Quelle nicht mehr angeboten. Bitte die Liste aktualisieren.');
      const summary = this.moduleSummary(source, entry);
      if (!['available', 'update'].includes(summary.status)) throw new Error(summary.reason ?? 'Diese Modulversion ist bereits installiert oder kann nicht installiert werden.');
      const installed = this.options.getInstalled(entry.id), token = await this.token(source);
      const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(180_000)]);
      const stage = path.join(this.options.userRoot, `.repository-stage-${randomUUID()}`);
      await fs.mkdir(stage, { mode: 0o700 });
      try {
        let total = 0;
        for (const file of entry.package.files) {
          requestSignal.throwIfAborted();
          const relative = `${entry.package.path}/${file.path}`, remaining = Math.min(MAX_PACKAGE_BYTES - total, file.path === 'module.json' ? 64 * 1024 : MAX_PACKAGE_BYTES);
          let bytes: Buffer;
          if (source.kind === 'github') bytes = await this.githubFile(source, snapshot.rootTree!, relative, token, remaining, requestSignal);
          else bytes = await this.request(new URL(relative, new URL('.', source.url)).toString(), source, token, remaining, requestSignal);
          total += bytes.length;
          if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`Die Prüfsumme von ${file.path} stimmt nicht mit dem Katalog überein. Die vorhandene Installation bleibt erhalten.`);
          const target = path.join(stage, file.path);
          await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
        }
        // Validation reads metadata and fingerprints files; it never executes package code.
        const record = await new ModuleRegistry().inspectUserModule(stage, entry.id);
        if (record.module.status !== 'approval_required' || record.module.version !== entry.version || record.module.apiVersion !== entry.apiVersion) throw new Error('Das Paket ist ungültig oder Modul-ID, Version und API-Version stimmen nicht mit dem Katalog überein.');
        const receipt = { sourceId: source.id, sourceUrl: source.url, version: entry.version, fingerprint: record.fingerprint };
        const result = await this.options.installPackage({ moduleId: entry.id, stagedDirectory: stage, ...(installed ? { expectedFingerprint: installed.fingerprint } : {}), commit: () => this.persist({ ...this.config, installations: { ...this.config.installations, [entry.id]: receipt } }) }, requestSignal);
        return { moduleId: entry.id, version: entry.version, status: result.status === 'disabled' ? 'disabled' as const : 'approval_required' as const };
      } finally { await fs.rm(stage, { recursive: true, force: true }).catch(() => {}); }
    });
  }
}

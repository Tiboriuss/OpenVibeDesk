import { localCredentialEntry } from '../../../electron/credential-store';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { mcpAuthModeSchema, mcpOAuthClientAuthMethodSchema, mcpServerInputSchema, mcpServerIdSchema, validateMcpOAuthEndpointUrl, type McpServerConfig, type McpServerInput } from '../../../shared/mcp';

const storedServerSchema = z.object({
  id: mcpServerIdSchema, name: z.string().min(1).max(100), description: z.string().max(500), transport: z.enum(['stdio', 'http']),
  command: z.string().min(1).max(4096).optional(), args: z.array(z.string().max(4096)).max(100), cwd: z.string().max(4096).optional(), url: z.string().max(2048).optional(),
  autoConnect: z.boolean(), allowedTools: z.array(z.string().min(1).max(200)).max(500), hasToken: z.boolean(), envKeys: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(100)).max(100),
  authMode: mcpAuthModeSchema.optional(), oauthClientId: z.string().max(2048).optional(), oauthIssuer: z.string().max(2048).optional(), oauthScopes: z.string().max(2000).optional(),
  oauthAuthorizationUrl: z.string().max(2048).optional(), oauthTokenUrl: z.string().max(2048).optional(),
  oauthClientAuthMethod: mcpOAuthClientAuthMethodSchema.optional(),
  oauthRedirectPort: z.number().int().min(1024).max(65535).default(43189), hasOAuthClientSecret: z.boolean().default(false), hasOAuthTokens: z.boolean().default(false), oauthRevision: z.string().uuid().default(() => randomUUID())
}).strict().transform(value => ({ ...value, authMode: value.authMode ?? (value.transport === 'http' && value.hasToken ? 'bearer' as const : 'none' as const) }));
const storeSchema = z.object({ version: z.literal(1), servers: z.array(storedServerSchema).max(100) }).strict();
export interface McpSecretStore { get(id: string, key: string): Promise<string | null>; set(id: string, key: string, value: string): Promise<void>; delete(id: string, key: string): Promise<void>; }
function entry(id: string, key: string) { return localCredentialEntry('OpenVibeDesk MCP', `${id}:${key}`); }
const rawLocalSecrets: McpSecretStore = {
  async get(id, key) { try { return await entry(id, key).getPassword(); } catch { throw new Error('Der lokale MCP-Zugangsdaten-Speicher ist nicht verfügbar.'); } },
  async set(id, key, value) { try { await entry(id, key).setPassword(value); } catch { throw new Error('MCP-Zugangsdaten konnten nicht lokal gespeichert werden.'); } },
  async delete(id, key) { try { await entry(id, key).deletePassword(); } catch { throw new Error('MCP-Zugangsdaten konnten nicht entfernt werden.'); } }
};
const chunkPrefix = 'OVD-MCP-CHUNKS-v1:';
const chunkManifestSchema = z.object({ generation: z.string().uuid(), count: z.number().int().min(1).max(96), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
/** Compatibility adapter for secret stores with small entry limits; local storage needs no chunking. */
export function chunkedOAuthSecrets(raw: McpSecretStore): McpSecretStore {
  const manifest = (value: string | null) => value?.startsWith(chunkPrefix) ? chunkManifestSchema.parse(JSON.parse(value.slice(chunkPrefix.length))) : undefined;
  const chunkKey = (key: string, generation: string, index: number) => `${key}:chunk:${generation}:${index}`;
  const removeChunks = async (id: string, key: string, value: string | null) => {
    let old: z.infer<typeof chunkManifestSchema> | undefined;
    try { old = manifest(value); } catch { return; }
    if (old) for (let index = 0; index < old.count; index++) try { await raw.delete(id, chunkKey(key, old.generation, index)); } catch { /* Orphans are inaccessible after the pointer changes. */ }
  };
  return {
    async get(id, key) {
      const value = await raw.get(id, key);
      if (key !== 'oauth' || !value?.startsWith(chunkPrefix)) return value;
      try {
        const descriptor = manifest(value)!; let encoded = '';
        for (let index = 0; index < descriptor.count; index++) {
          const part = await raw.get(id, chunkKey(key, descriptor.generation, index));
          if (!part || part.length > 960 || !/^[A-Za-z0-9+/=]+$/.test(part)) throw new Error();
          encoded += part;
        }
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length > 65536 || createHash('sha256').update(bytes).digest('hex') !== descriptor.hash) throw new Error();
        return bytes.toString('utf8');
      } catch { throw new Error('Die sicheren MCP-Anmeldedaten sind unvollständig. Bitte abmelden und neu anmelden.'); }
    },
    async set(id, key, value) {
      if (key !== 'oauth') return raw.set(id, key, value);
      const bytes = Buffer.from(value, 'utf8');
      if (bytes.length > 65536) throw new Error('Die MCP-Anmeldedaten sind zu groß.');
      const previous = await raw.get(id, key);
      if (Buffer.byteLength(value, 'utf16le') <= 1920 && !value.startsWith(chunkPrefix)) {
        await raw.set(id, key, value); await removeChunks(id, key, previous); return;
      }
      const encoded = bytes.toString('base64'), generation = randomUUID(), count = Math.ceil(encoded.length / 960);
      // 960 ASCII characters stay below the Windows credential limit even as UTF-16.
      try { for (let index = 0; index < count; index++) await raw.set(id, chunkKey(key, generation, index), encoded.slice(index * 960, (index + 1) * 960)); }
      catch (error) { for (let index = 0; index < count; index++) try { await raw.delete(id, chunkKey(key, generation, index)); } catch { /* Never published. */ } throw error; }
      // Do not delete this generation if publication fails ambiguously: the OS
      // might already have replaced the pointer. A later save can recover it.
      await raw.set(id, key, chunkPrefix + JSON.stringify({ generation, count, hash: createHash('sha256').update(bytes).digest('hex') }));
      await removeChunks(id, key, previous);
    },
    async delete(id, key) {
      const previous = key === 'oauth' ? await raw.get(id, key) : null;
      await raw.delete(id, key);
      if (key === 'oauth') await removeChunks(id, key, previous);
    }
  };
}
export const localSecrets = rawLocalSecrets;
export function validateMcpUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Bitte eine gültige MCP-URL eingeben.'); }
  if (url.username || url.password || url.hash || url.search) throw new Error('Die MCP-URL darf keine Zugangsdaten, Abfrageparameter oder Fragmente enthalten. Bearer-Token separat eingeben.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('MCP über HTTP ist nur auf Loopback-Adressen erlaubt; entfernte Server benötigen HTTPS.');
  return url.toString();
}
/** Binds credentials to both their target and the current saved authorization generation. */
export function mcpOAuthBinding(config: McpServerConfig): string {
  const identity: unknown[] = [config.id, config.transport, config.url, config.authMode, config.oauthClientId, config.oauthIssuer, config.oauthScopes, config.oauthRedirectPort, config.oauthRevision];
  // Keep the v0.1.4 binding stable when automatic discovery remains selected.
  if (config.oauthAuthorizationUrl || config.oauthTokenUrl) identity.push({ authorizationUrl: config.oauthAuthorizationUrl, tokenUrl: config.oauthTokenUrl });
  if (config.oauthClientAuthMethod && config.oauthClientAuthMethod !== 'auto') identity.push({ clientAuthMethod: config.oauthClientAuthMethod });
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}
type SecretChange = { key: string; value: string | null; previous?: string | null };
export class McpConfigStore {
  private servers: McpServerConfig[] = [];
  private available = true;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly dataRoot: string, readonly secrets: McpSecretStore = localSecrets) {}
  async initialize() {
    await fs.mkdir(this.dataRoot, { recursive: true });
    try {
      const value = storeSchema.parse(JSON.parse(await fs.readFile(path.join(this.dataRoot, 'servers.json'), 'utf8')));
      this.servers = await Promise.all(value.servers.map(async server => ({
        ...server,
        hasToken: server.hasToken && !!await this.secrets.get(server.id, 'token'),
        hasOAuthClientSecret: server.hasOAuthClientSecret && !!await this.secrets.get(server.id, 'oauth-client-secret'),
        hasOAuthTokens: server.hasOAuthTokens && !!await this.secrets.get(server.id, 'oauth')
      })));
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.available = false; }
  }
  list(): McpServerConfig[] { return this.servers.map(server => ({ ...server, args: [...server.args], envKeys: [...server.envKeys], allowedTools: [...server.allowedTools] })); }
  get(id: string): McpServerConfig { if (!this.available) throw new Error('Die MCP-Speicherung ist nicht verfügbar. Bitte OVD neu starten und die Einstellungen prüfen.'); const found = this.list().find(server => server.id === id); if (!found) throw new Error('MCP-Server nicht gefunden.'); return found; }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const next = this.queue.then(operation); this.queue = next.catch(() => {}); return next; }
  private async persist(servers: McpServerConfig[]) {
    if (!this.available) throw new Error('Die MCP-Konfiguration konnte nicht gelesen werden. Die vorhandene Datei wurde nicht überschrieben.');
    const value = storeSchema.parse({ version: 1, servers }), target = path.join(this.dataRoot, 'servers.json'), temporary = `${target}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, target); renamed = true;
      if (process.platform !== 'win32') { const directory = await fs.open(this.dataRoot, 'r'); try { await directory.sync(); } finally { await directory.close(); } }
      this.servers = value.servers;
    } catch (error) {
      if (renamed) { this.available = false; throw new Error('Die dauerhafte MCP-Speicherung konnte nicht bestätigt werden. Bitte OVD neu starten.'); }
      throw error;
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  private async commitSecrets(id: string, changes: SecretChange[], servers: McpServerConfig[]) {
    if (!this.available) throw new Error('Die MCP-Konfiguration ist nicht verfügbar.');
    try {
      for (const change of changes) {
        change.previous = await this.secrets.get(id, change.key);
        if (change.value === null) { if (change.previous !== null) await this.secrets.delete(id, change.key); }
        else await this.secrets.set(id, change.key, change.value);
      }
      await this.persist(servers);
    } catch (error) {
      // After rename the file may already contain the new generation. Keep its
      // matching credentials and fail closed until restart instead of restoring
      // an older refresh token under a newer acknowledged public configuration.
      if (!this.available) throw error;
      for (const change of [...changes].reverse()) if (change.previous !== undefined) {
        try {
          if (change.previous === null) { if (await this.secrets.get(id, change.key) !== null) await this.secrets.delete(id, change.key); }
          else await this.secrets.set(id, change.key, change.previous);
        } catch { this.available = false; }
      }
      if (!this.available) throw new Error('MCP-Zugangsdaten konnten nicht zuverlässig gespeichert werden. Bitte OVD neu starten und die Anmeldung prüfen.');
      throw error;
    }
  }
  save(raw: McpServerInput): Promise<McpServerConfig> {
    return this.serial(async () => {
      const input = mcpServerInputSchema.parse(raw), old = input.id ? this.get(input.id) : undefined, id = old?.id ?? randomUUID();
      const envKeys = [...new Set([...(old?.envKeys ?? []).filter(key => !(input.removeEnvKeys ?? []).includes(key)), ...Object.keys(input.env ?? {})])];
      const authMode = input.transport === 'stdio' ? 'none' : input.authMode ?? old?.authMode ?? (input.token ? 'bearer' : 'none');
      const optional = (value: string | undefined, previous?: string) => (value === undefined ? previous : value.trim()) || undefined;
      const selectedClientAuthMethod = input.oauthClientAuthMethod ?? old?.oauthClientAuthMethod;
      const oauthClientAuthMethod = selectedClientAuthMethod === 'auto' ? undefined : selectedClientAuthMethod;
      const next: McpServerConfig = {
        id, name: input.name, description: input.description, transport: input.transport, args: input.transport === 'stdio' ? input.args : [],
        ...(input.transport === 'stdio' ? { command: input.command, ...(input.cwd ? { cwd: input.cwd } : {}) } : { url: validateMcpUrl(input.url!) }),
        autoConnect: input.autoConnect, allowedTools: [...new Set(input.allowedTools)], hasToken: false, envKeys, authMode,
        ...(authMode === 'oauth' ? { oauthClientId: optional(input.oauthClientId, old?.oauthClientId), oauthIssuer: optional(input.oauthIssuer, old?.oauthIssuer), oauthScopes: optional(input.oauthScopes, old?.oauthScopes), oauthAuthorizationUrl: optional(input.oauthAuthorizationUrl, old?.oauthAuthorizationUrl), oauthTokenUrl: optional(input.oauthTokenUrl, old?.oauthTokenUrl), ...(oauthClientAuthMethod ? { oauthClientAuthMethod } : {}) } : {}),
        oauthRedirectPort: input.oauthRedirectPort ?? old?.oauthRedirectPort ?? 43189,
        hasOAuthClientSecret: false, hasOAuthTokens: false, oauthRevision: old?.oauthRevision ?? randomUUID()
      };
      // An issuer is an exact identifier. Validate its URL without changing
      // its spelling, including a provider's intentionally absent final slash.
      if (next.oauthIssuer) validateMcpUrl(next.oauthIssuer);
      if (next.oauthAuthorizationUrl) next.oauthAuthorizationUrl = validateMcpOAuthEndpointUrl(next.oauthAuthorizationUrl, next.url);
      if (next.oauthTokenUrl) next.oauthTokenUrl = validateMcpOAuthEndpointUrl(next.oauthTokenUrl, next.url);
      if (next.oauthAuthorizationUrl && next.oauthTokenUrl && (!next.oauthClientId || !next.oauthIssuer)) throw new Error('Für manuelle OAuth-Endpunkte bitte eine registrierte Client-ID und den zugehörigen OAuth-Issuer angeben.');
      const sameTarget = !!old && JSON.stringify([old.transport, old.command, old.args, old.cwd, old.url]) === JSON.stringify([next.transport, next.command, next.args, next.cwd, next.url]);
      const sameClient = sameTarget && old!.authMode === authMode && old!.oauthClientId === next.oauthClientId && old!.oauthIssuer === next.oauthIssuer;
      const sameAuth = sameClient && old!.oauthScopes === next.oauthScopes && old!.oauthRedirectPort === next.oauthRedirectPort && old!.oauthAuthorizationUrl === next.oauthAuthorizationUrl && old!.oauthTokenUrl === next.oauthTokenUrl && (old!.oauthClientAuthMethod ?? 'auto') === (next.oauthClientAuthMethod ?? 'auto') && !input.oauthClientSecret && !input.clearOAuthClientSecret && !input.token && !input.clearToken;
      next.hasToken = authMode === 'bearer' && !input.clearToken && (!!input.token || sameClient && old!.hasToken);
      next.hasOAuthClientSecret = authMode === 'oauth' && !input.clearOAuthClientSecret && (!!input.oauthClientSecret || sameClient && old!.hasOAuthClientSecret);
      if (next.oauthClientAuthMethod && (!next.oauthClientId || !next.hasOAuthClientSecret)) throw new Error('Für dieses Client-Anmeldeverfahren sind eine registrierte Client-ID und ein gespeichertes Client-Secret erforderlich.');
      next.hasOAuthTokens = sameAuth && old!.hasOAuthTokens;
      if (old && !sameAuth) { next.oauthRevision = randomUUID(); next.allowedTools = []; }
      const changes: SecretChange[] = [];
      if (input.token && authMode === 'bearer') changes.push({ key: 'token', value: input.token });
      else if (input.clearToken || old?.hasToken && !next.hasToken) changes.push({ key: 'token', value: null });
      if (input.oauthClientSecret && authMode === 'oauth') changes.push({ key: 'oauth-client-secret', value: input.oauthClientSecret });
      else if (input.clearOAuthClientSecret || old?.hasOAuthClientSecret && !next.hasOAuthClientSecret) changes.push({ key: 'oauth-client-secret', value: null });
      if (old && !sameAuth) changes.push({ key: 'oauth', value: null });
      for (const [key, value] of Object.entries(input.env ?? {})) changes.push({ key: `env:${key}`, value });
      for (const key of input.removeEnvKeys ?? []) if (!Object.hasOwn(input.env ?? {}, key)) changes.push({ key: `env:${key}`, value: null });
      await this.commitSecrets(id, changes, old ? this.servers.map(server => server.id === id ? next : server) : [...this.servers, next]);
      return this.get(id);
    });
  }
  private assertOAuth(config: McpServerConfig) {
    if (!this.available) throw new Error('Die MCP-Konfiguration ist nicht verfügbar.');
    const current = this.get(config.id);
    if (current.authMode !== 'oauth' || current.transport !== 'http' || mcpOAuthBinding(current) !== mcpOAuthBinding(config)) throw new Error('Die MCP-Anmeldung wurde geändert oder widerrufen. Bitte neu anmelden.');
    return current;
  }
  readOAuth(config: McpServerConfig): Promise<Record<string, unknown> | undefined> {
    return this.serial(async () => {
      this.assertOAuth(config);
      const raw = await this.secrets.get(config.id, 'oauth');
      if (raw === null) return undefined;
      try {
        if (Buffer.byteLength(raw, 'utf8') > 66000) throw new Error();
        const stored = z.object({ binding: z.string(), value: z.record(z.string(), z.unknown()) }).strict().parse(JSON.parse(raw));
        return stored.binding === mcpOAuthBinding(config) ? stored.value : undefined;
      } catch { throw new Error('Die gespeicherte MCP-Anmeldung ist beschädigt. Bitte abmelden und neu anmelden.'); }
    });
  }
  writeOAuth(config: McpServerConfig, value: Record<string, unknown>): Promise<void> {
    return this.serial(async () => {
      const current = this.assertOAuth(config), encoded = JSON.stringify({ binding: mcpOAuthBinding(config), value });
      if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(encoded, 'utf8') > 65536) throw new Error('Die MCP-Anmeldedaten überschreiten das unterstützte Format.');
      const token = value.tokens && typeof value.tokens === 'object' ? (value.tokens as Record<string, unknown>).access_token : undefined;
      const next = { ...current, hasOAuthTokens: typeof token === 'string' && !!token && value.refreshPending !== true };
      await this.commitSecrets(config.id, [{ key: 'oauth', value: encoded }], this.servers.map(server => server.id === current.id ? next : server));
    });
  }
  oauthClientSecret(config: McpServerConfig): Promise<string | undefined> {
    return this.serial(async () => { const current = this.assertOAuth(config); return current.hasOAuthClientSecret ? (await this.secrets.get(config.id, 'oauth-client-secret')) ?? undefined : undefined; });
  }
  clearOAuth(id: string): Promise<void> {
    return this.serial(async () => {
      const old = this.get(id), next = { ...old, hasOAuthTokens: false, oauthRevision: randomUUID() };
      // Revoke the old generation durably before touching a possibly damaged
      // credential. A failed cleanup must never restore the prior login.
      await this.persist(this.servers.map(server => server.id === id ? next : server));
      let present = true;
      try { present = await this.secrets.get(id, 'oauth') !== null; } catch { /* Corrupt chunks must still be removable. */ }
      if (present) try { await this.secrets.delete(id, 'oauth'); }
      catch { throw new Error('Die MCP-Anmeldung wurde lokal gesperrt. Ihre gespeicherten Zugangsdaten konnten nicht vollständig entfernt werden; bitte erneut abmelden.'); }
    });
  }
  permissions(id: string, allowedTools: string[]): Promise<McpServerConfig> { return this.serial(async () => { const old = this.get(id); await this.persist(this.servers.map(server => server.id === id ? { ...old, allowedTools: [...new Set(allowedTools)] } : server)); return this.get(id); }); }
  remove(id: string): Promise<void> { return this.serial(async () => { const old = this.get(id); await this.persist(this.servers.filter(server => server.id !== id)); for (const key of [...old.envKeys.map(key => `env:${key}`), 'token', 'oauth', 'oauth-client-secret']) try { if (await this.secrets.get(id, key) !== null) await this.secrets.delete(id, key); } catch { /* Deleted config never makes orphaned secrets available. */ } }); }
}

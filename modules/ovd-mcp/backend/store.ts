import { AsyncEntry } from '@napi-rs/keyring';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { mcpServerInputSchema, mcpServerIdSchema, type McpServerConfig, type McpServerInput } from '../../../shared/mcp';

const storedServerSchema = z.object({
  id: mcpServerIdSchema, name: z.string().min(1).max(100), description: z.string().max(500), transport: z.enum(['stdio', 'http']),
  command: z.string().min(1).max(4096).optional(), args: z.array(z.string().max(4096)).max(100), cwd: z.string().max(4096).optional(), url: z.string().max(2048).optional(),
  autoConnect: z.boolean(), allowedTools: z.array(z.string().min(1).max(200)).max(500), hasToken: z.boolean(), envKeys: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(100)).max(100)
}).strict();
const storeSchema = z.object({ version: z.literal(1), servers: z.array(storedServerSchema).max(100) }).strict();
export interface McpSecretStore { get(id: string, key: string): Promise<string | null>; set(id: string, key: string, value: string): Promise<void>; delete(id: string, key: string): Promise<void>; }
function entry(id: string, key: string) { return new AsyncEntry('OpenVibeDesk MCP', `${id}:${key}`, { linux: { store: 'secret-service' } }); }
export const keychainSecrets: McpSecretStore = {
  async get(id, key) { try { return await entry(id, key).getPassword(); } catch { throw new Error('Der sichere MCP-Zugangsdaten-Speicher ist nicht verfügbar.'); } },
  async set(id, key, value) { try { await entry(id, key).setPassword(value); } catch { throw new Error('MCP-Zugangsdaten konnten nicht sicher gespeichert werden.'); } },
  async delete(id, key) { try { await entry(id, key).deletePassword(); } catch { throw new Error('MCP-Zugangsdaten konnten nicht entfernt werden.'); } }
};
export function validateMcpUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Bitte eine gültige MCP-URL eingeben.'); }
  if (url.username || url.password || url.hash || url.search) throw new Error('Die MCP-URL darf keine Zugangsdaten, Abfrageparameter oder Fragmente enthalten. Bearer-Token separat eingeben.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('MCP über HTTP ist nur auf Loopback-Adressen erlaubt; entfernte Server benötigen HTTPS.');
  return url.toString();
}
export class McpConfigStore {
  private servers: McpServerConfig[] = [];
  private available = true;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly dataRoot: string, readonly secrets: McpSecretStore = keychainSecrets) {}
  async initialize() {
    await fs.mkdir(this.dataRoot, { recursive: true });
    try { const value = storeSchema.parse(JSON.parse(await fs.readFile(path.join(this.dataRoot, 'servers.json'), 'utf8'))); this.servers = value.servers; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.available = false; }
  }
  list(): McpServerConfig[] { return this.servers.map(server => ({ ...server, args: [...server.args], envKeys: [...server.envKeys], allowedTools: [...server.allowedTools] })); }
  get(id: string): McpServerConfig { const found = this.list().find(server => server.id === id); if (!found) throw new Error('MCP-Server nicht gefunden.'); return found; }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const next = this.queue.then(operation); this.queue = next.catch(() => {}); return next; }
  private async persist(servers: McpServerConfig[]) {
    if (!this.available) throw new Error('Die MCP-Konfiguration konnte nicht gelesen werden. Die vorhandene Datei wurde nicht überschrieben.');
    const value = storeSchema.parse({ version: 1, servers }), target = path.join(this.dataRoot, 'servers.json');
    await fs.writeFile(`${target}.tmp`, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(`${target}.tmp`, target);
    this.servers = value.servers;
  }
  save(raw: McpServerInput): Promise<McpServerConfig> {
    return this.serial(async () => {
      const input = mcpServerInputSchema.parse(raw), old = input.id ? this.get(input.id) : undefined, id = old?.id ?? randomUUID();
      const envKeys = [...new Set([...(old?.envKeys ?? []).filter(key => !(input.removeEnvKeys ?? []).includes(key)), ...Object.keys(input.env ?? {})])];
      const next: McpServerConfig = {
        id, name: input.name, description: input.description, transport: input.transport, args: input.transport === 'stdio' ? input.args : [],
        ...(input.transport === 'stdio' ? { command: input.command, ...(input.cwd ? { cwd: input.cwd } : {}) } : { url: validateMcpUrl(input.url!) }),
        autoConnect: input.autoConnect, allowedTools: [...new Set(input.allowedTools)], hasToken: input.clearToken ? false : !!input.token || old?.hasToken === true, envKeys
      };
      const changes: { key: string; value: string | null; previous?: string | null }[] = [];
      if (input.token || input.clearToken) changes.push({ key: 'token', value: input.clearToken ? null : input.token! });
      for (const [key, value] of Object.entries(input.env ?? {})) changes.push({ key: `env:${key}`, value });
      for (const key of input.removeEnvKeys ?? []) if (!Object.hasOwn(input.env ?? {}, key)) changes.push({ key: `env:${key}`, value: null });
      try {
        for (const change of changes) {
          change.previous = await this.secrets.get(id, change.key);
          if (change.value === null) { if (change.previous !== null) await this.secrets.delete(id, change.key); }
          else await this.secrets.set(id, change.key, change.value);
        }
        await this.persist(old ? this.servers.map(server => server.id === id ? next : server) : [...this.servers, next]);
      } catch (error) {
        for (const change of changes.reverse()) if (change.previous !== undefined) {
          try { if (change.previous === null) await this.secrets.delete(id, change.key); else await this.secrets.set(id, change.key, change.previous); } catch { /* Keep the original actionable error without exposing a secret. */ }
        }
        throw error;
      }
      return this.get(id);
    });
  }
  permissions(id: string, allowedTools: string[]): Promise<McpServerConfig> { return this.serial(async () => { const old = this.get(id); await this.persist(this.servers.map(server => server.id === id ? { ...old, allowedTools: [...new Set(allowedTools)] } : server)); return this.get(id); }); }
  remove(id: string): Promise<void> { return this.serial(async () => { const old = this.get(id); await this.persist(this.servers.filter(server => server.id !== id)); for (const key of [...old.envKeys.map(key => `env:${key}`), ...(old.hasToken ? ['token'] : [])]) try { await this.secrets.delete(id, key); } catch { /* Deleted config never makes orphaned secrets available. */ } }); }
}

import { createHash, randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020';
import Ajv2019 from 'ajv/dist/2019';
import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CapabilityContext } from '../../../electron/workspace-capabilities';
import type { ModuleToolProvider } from '../../../shared/module-tool-provider';
import type { ModuleSummary, ModuleToolDescriptor, ModuleToolQuery } from '../../../shared/modules';
import type { OperationBinding } from '../../../shared/operations';
import { mcpAuditQuerySchema, mcpPermissionsSchema, mcpServerIdSchema, mcpServerInputSchema, mcpToolQuerySchema, type McpAuditEntry, type McpAuditPage, type McpAuditQuery, type McpCallResult, type McpServerConfig, type McpServerInput, type McpServerSummary, type McpToolInfo, type McpToolPermissions, type McpToolQuery } from '../../../shared/mcp';
import { McpConfigStore, validateMcpUrl } from './store';

type CachedTool = { name: string; info: McpToolInfo; validate?: ValidateFunction; fingerprint: string };
type Connection = { id: string; generation: string; client: Client; transport: Transport; status: McpServerSummary['status']; tools: Map<string, CachedTool>; secrets: string[]; error?: string; warning?: string; connectedAt?: string; refresh?: Promise<void> };
type Host = { confirm(context: CapabilityContext, message: string, detail: string): Promise<boolean>; changed(): void; requestTimeoutMs?(): number; operationFingerprint?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase('de-DE');

function hasRemoteReference(value: unknown, depth = 0): boolean {
  if (depth > 30) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => (key === '$ref' || key === '$dynamicRef') && (typeof item !== 'string' || !item.startsWith('#')) || key === '$id' && typeof item === 'string' && !item.startsWith('#') || hasRemoteReference(item, depth + 1));
}
function redact(value: string, secrets: readonly string[]): string {
  let result = value.replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [entfernt]');
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('[entfernt]');
  return result;
}
function containsSecret(value: unknown, secrets: readonly string[], depth = 0): boolean {
  if (depth > 30) return true;
  const matches = (text: string) => secrets.filter(Boolean).some(secret => secret.length >= 8 ? text.includes(secret) : text === secret);
  if (typeof value === 'string') return matches(value);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => matches(key) || containsSecret(item, secrets, depth + 1));
}
function boundedValue(value: unknown, secrets: readonly string[], state: { truncated: boolean }, depth = 0): unknown {
  if (depth > 6) { state.truncated = true; return '[gekürzt]'; }
  if (typeof value === 'string') { const text = redact(value, secrets); if (text.length > 12000) state.truncated = true; return text.slice(0, 12000); }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) { if (value.length > 30) state.truncated = true; return value.slice(0, 30).map(item => boundedValue(item, secrets, state, depth + 1)); }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value), filtered = entries.slice(0, 30).filter(([key]) => !/^(?:password|token|apikey|authorization|accesstoken|refreshtoken|privatekey)$/i.test(key));
    if (filtered.length < entries.length) state.truncated = true;
    return Object.fromEntries(filtered.map(([key, item]) => { const clean = redact(key, secrets); if (clean.length > 200) state.truncated = true; return [clean.slice(0, 200), boundedValue(item, secrets, state, depth + 1)]; }));
  }
  return null;
}
function callResult(serverId: string, tool: string, outcome: McpCallResult['outcome'], secrets: readonly string[], raw?: unknown, message?: string): McpCallResult {
  const result: McpCallResult = { ok: outcome === 'completed', outcome, serverId, tool, content: [], untrusted: true, ...(message ? { message } : {}) };
  if (!raw || typeof raw !== 'object') return result;
  const record = raw as Record<string, unknown>;
  for (const item of Array.isArray(record.content) ? record.content.slice(0, 30) : []) {
    const block = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const text = block.type === 'text' && typeof block.text === 'string' ? redact(block.text, secrets) : `[MCP-Inhalt vom Typ ${typeof block.type === 'string' ? redact(block.type, secrets).slice(0, 40) : 'unbekannt'} wird in dieser Version nicht übertragen.]`;
    for (let offset = 0; offset < text.length || offset === 0; offset += 12000) {
      const next = { type: 'text' as const, text: text.slice(offset, offset + 12000) };
      if (JSON.stringify({ ...result, content: [...result.content, next], truncated: true }).length > 27000) {
        let low = 0, high = next.text.length;
        while (low < high) { const middle = Math.ceil((low + high) / 2); if (JSON.stringify({ ...result, content: [...result.content, { ...next, text: next.text.slice(0, middle) }], truncated: true }).length <= 26700) low = middle; else high = middle - 1; }
        if (low) result.content.push({ ...next, text: next.text.slice(0, low) });
        result.truncated = true; break;
      }
      result.content.push(next);
    }
    if (result.truncated) break;
  }
  if (record.structuredContent !== undefined) {
    const state = { truncated: false };
    const candidate = { ...result, structuredContent: boundedValue(record.structuredContent, secrets, state) };
    if (state.truncated) result.truncated = true;
    if (JSON.stringify(candidate).length <= 27000) result.structuredContent = candidate.structuredContent;
    else result.truncated = true;
  }
  if (Array.isArray(record.content) && record.content.length > 30) result.truncated = true;
  if (result.truncated && !result.message) result.message = 'Das MCP-Ergebnis wurde für den Chat begrenzt und ist nicht vollständig wiedergegeben.';
  return result;
}

/** The server catalog stays cached and outside the initial model prompt. */
export class McpService {
  private active = false;
  private lifecycle = 0;
  private readonly connections = new Map<string, Connection>();
  private readonly connecting = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  private readonly audits: McpAuditEntry[] = [];
  private readonly changing = new Set<string>();
  private readonly ajvOptions = { strict: false, validateFormats: false, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false, addUsedSchema: false };
  private readonly ajv2020 = new Ajv2020(this.ajvOptions);
  private readonly ajv2019 = new Ajv2019(this.ajvOptions);
  private readonly ajv07 = new Ajv(this.ajvOptions);
  readonly toolProvider: ModuleToolProvider<CapabilityContext>;
  constructor(readonly store: McpConfigStore, private readonly host: Host) {
    this.toolProvider = {
      parentModuleId: 'ovd-mcp', listModules: () => this.sourceModules(),
      getTools: query => {
        const tools = this.toolsForModule(query.moduleId), terms = fold(query.query ?? '').split(/[\s._-]+/).filter(Boolean);
        const ranked = tools.map(tool => ({ tool, score: terms.filter(term => fold(`${tool.name} ${tool.description} ${tool.label}`).includes(term)).length })).filter(item => !terms.length || item.score > 0).sort((a, b) => b.score - a.score);
        const offset = query.offset ?? 0, limit = query.limit ?? 6, hasMore = offset + limit < ranked.length;
        return { moduleId: query.moduleId, tools: ranked.slice(offset, offset + limit).map(item => item.tool), hasMore, ...(hasMore ? { nextOffset: offset + limit } : {}) };
      },
      getTool: (moduleId, name) => this.toolsForModule(moduleId).find(tool => tool.name === name),
      getOperationTool: binding => {
        const id = this.serverIdForModule(binding.moduleId), tool = this.requireConnection(id).tools.get(binding.action);
        return tool && this.allowed(id, tool) && this.operationBinding(id, tool).fingerprint === binding.fingerprint ? this.descriptor(id, tool) : undefined;
      },
      prepareOperation: async (moduleId, name, args, context) => {
        this.assertActive(context);
        const id = this.serverIdForModule(moduleId), connection = this.requireConnection(id);
        const tool = [...connection.tools.values()].find(item => this.allowed(id, item) && this.descriptor(id, item).name === name);
        if (!tool || !tool.validate!(args)) throw new Error('Die MCP-Funktion oder ihre Argumente sind nicht mehr in der freigegebenen Version verfügbar.');
        return { binding: this.operationBinding(id, tool), args: structuredClone(args), label: (tool.info.title ?? tool.name).slice(0, 120) };
      },
      reconcileOperation: async (binding, _args, _operation, context) => {
        this.assertActive(context);
        const id = this.serverIdForModule(binding.moduleId), tool = this.requireConnection(id).tools.get(binding.action);
        if (!tool || !this.allowed(id, tool) || this.operationBinding(id, tool).fingerprint !== binding.fingerprint) throw new Error('MCP-Konfiguration, Schema oder Freigabe haben sich geändert. Der alte Aufruf wird nicht erneut ausgeführt.');
        return { state: 'unknown', detail: 'Dieser MCP-Server bietet keinen verlässlichen Abgleich über die OVD-Aktions-ID. Bitte den tatsächlichen Status im verbundenen System prüfen; der Aufruf wird nicht wiederholt.' };
      },
      invoke: async (moduleId, name, args, context) => {
        const id = this.serverIdForModule(moduleId), connection = this.requireConnection(id);
        const tool = [...connection.tools.values()].find(tool => this.allowed(id, tool) && this.descriptor(id, tool).name === name);
        if (!tool) throw new Error('Dieses MCP-Werkzeug ist nicht mehr verbunden oder freigegeben. Bitte den Katalog neu laden.');
        return this.callTool(id, tool.name, args, context, name);
      }
    };
  }
  private assertActive(context?: CapabilityContext) { if (!this.active) throw new Error('Das MCP-Modul ist nicht verfügbar.'); context?.signal.throwIfAborted(); }
  private timeout() { return Math.max(1000, this.host.requestTimeoutMs?.() ?? 60000); }
  private audit(server: McpServerConfig, action: McpAuditEntry['action'], outcome: McpAuditEntry['outcome'], start: number, tool?: string) {
    this.audits.unshift({ id: randomUUID(), timestamp: new Date().toISOString(), serverId: server.id, serverName: server.name, action, outcome, durationMs: Date.now() - start, ...(tool ? { tool } : {}) }); this.audits.splice(100); this.host.changed();
  }
  async initialize() { await this.store.initialize(); await this.activate(); }
  async activate() {
    if (this.active) return;
    this.active = true; this.lifecycle++;
    // Saved opt-in may connect in the background without delaying the dock.
    void Promise.all(this.store.list().filter(server => server.autoConnect).map(server => this.connect(server.id, { origin: 'ui', signal: new AbortController().signal }, true).catch(() => {})));
  }
  async deactivate() { this.active = false; this.lifecycle++; this.connecting.clear(); await Promise.all([...this.connections.keys()].map(id => this.close(id))); this.host.changed(); }
  listServers(): McpServerSummary[] {
    return this.store.list().map(server => { const connection = this.connections.get(server.id), error = connection?.error ?? this.errors.get(server.id); return { ...server, status: connection?.status ?? (this.connecting.has(server.id) ? 'connecting' : error ? 'error' : 'disconnected'), toolCount: connection?.tools.size ?? 0, allowedToolCount: [...(connection?.tools.values() ?? [])].filter(tool => this.allowed(server.id, tool)).length, ...(error ? { error } : {}), ...(connection?.warning ? { warning: connection.warning } : {}), ...(connection?.connectedAt ? { connectedAt: connection.connectedAt } : {}) }; });
  }
  private requireConnection(id: string): Connection {
    this.assertActive();
    const connection = this.connections.get(mcpServerIdSchema.parse(id));
    if (!connection || connection.status !== 'connected' || this.changing.has(id)) throw new Error('Der MCP-Server ist nicht verbunden. Bitte zuerst verbinden.');
    return connection;
  }
  private async close(id: string) {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    if (connection.transport instanceof StreamableHTTPClientTransport) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Session deletion is cleanup only. It never resends a tools/call;
        // closing the transport below aborts a stalled DELETE after this bound.
        await Promise.race([connection.transport.terminateSession().catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); })]);
      } finally { if (timer) clearTimeout(timer); }
    }
    try { await connection.client.close(); } catch { try { await connection.transport.close(); } catch { /* Closing has no retry of a tool call. */ } }
  }
  async disconnect(id: string, context: CapabilityContext) { this.assertActive(context); const server = this.store.get(mcpServerIdSchema.parse(id)), start = Date.now(); this.connecting.delete(id); await this.close(id); this.errors.delete(id); this.audit(server, 'disconnect', 'completed', start); return { serverId: id, disconnected: true }; }
  async connect(id: string, context: CapabilityContext, automatic = false) {
    this.assertActive(context); id = mcpServerIdSchema.parse(id);
    const server = this.store.get(id), previous = this.connections.get(id), start = Date.now(), lifecycle = this.lifecycle, attempt = randomUUID();
    if (previous?.status === 'connected') return { serverId: id, connected: true, alreadyConnected: true };
    if (previous?.status === 'connecting' || this.changing.has(id) || this.connecting.has(id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.');
    this.connecting.set(id, attempt); this.errors.delete(id); this.host.changed();
    const secretValues: string[] = [];
    let connection: Connection | undefined;
    try {
      if (!automatic && context.origin === 'agent' && !await this.host.confirm(context, `${server.name} verbinden?`, server.transport === 'stdio' ? 'Der gespeicherte lokale MCP-Prozess wird mit deinen Benutzerrechten gestartet.' : 'Eine Verbindung zum gespeicherten MCP-Endpunkt wird geöffnet.')) return { serverId: id, cancelled: true };
      this.assertActive(context);
      if (this.lifecycle !== lifecycle || this.connecting.get(id) !== attempt) throw new Error('MCP_CONNECTION_CHANGED');
      await this.close(id);
      const client = new Client({ name: 'OpenVibeDesk', version: '0.1.0' }, { capabilities: {} });
      let transport: Transport;
      if (server.transport === 'stdio') {
        const env = getDefaultEnvironment();
        for (const key of server.envKeys) { const value = await this.store.secrets.get(id, `env:${key}`); if (value === null) throw new Error('MCP_ENV_MISSING'); env[key] = value; secretValues.push(value); }
        transport = new StdioClientTransport({ command: server.command!, args: server.args, ...(server.cwd ? { cwd: server.cwd } : {}), env, stderr: 'ignore', maxBufferSize: 2_000_000 });
      } else {
        const url = new URL(validateMcpUrl(server.url!)), token = server.hasToken ? await this.store.secrets.get(id, 'token') : null;
        if (server.hasToken && !token) throw new Error('MCP_TOKEN_MISSING');
        if (token) secretValues.push(token);
        const safeFetch: typeof fetch = async (input, init) => {
          const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
          if (target.origin !== url.origin) throw new Error('MCP_CROSS_ORIGIN');
          const response = await fetch(input, { ...init, redirect: 'error' });
          if (!response.body) return response;
          let size = 0;
          const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { size += chunk.byteLength; if (size > 4_000_000) { controller.error(new Error('MCP_RESPONSE_LIMIT')); return; } controller.enqueue(chunk); } }));
          return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
        };
        transport = new StreamableHTTPClientTransport(url, { fetch: safeFetch, requestInit: { redirect: 'error', ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }, reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 0, initialReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 } });
      }
      this.assertActive(context);
      if (this.lifecycle !== lifecycle || this.connecting.get(id) !== attempt) throw new Error('MCP_CONNECTION_CHANGED');
      connection = { id, generation: randomUUID(), client, transport, status: 'connecting', tools: new Map(), secrets: secretValues };
      this.connections.set(id, connection); this.host.changed();
      const current = connection;
      client.onclose = () => { if (this.connections.get(id) === current) { current.status = current.status === 'error' ? 'error' : 'disconnected'; current.tools.clear(); this.host.changed(); } };
      client.onerror = () => { if (this.connections.get(id) === current && current.status === 'connected') { current.status = 'error'; current.error = 'Die MCP-Verbindung wurde unterbrochen. Laufende Aufrufe werden nicht automatisch wiederholt.'; current.tools.clear(); this.host.changed(); void current.client.close().catch(() => {}); } };
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { if (this.connections.get(id) === current && current.status === 'connected') try { await this.refresh(id, new AbortController().signal); } catch { current.warning = 'Der Werkzeugkatalog konnte nicht aktualisiert werden. Bitte erneut laden.'; this.host.changed(); } });
      await client.connect(transport, { signal: context.signal, timeout: this.timeout() });
      this.assertActive(context);
      if (this.connections.get(id) !== connection || this.lifecycle !== lifecycle || this.connecting.get(id) !== attempt) throw new Error('MCP_CONNECTION_CHANGED');
      connection.status = 'connected'; connection.connectedAt = new Date().toISOString();
      await this.refresh(id, context.signal);
      this.audit(server, 'connect', 'completed', start);
      return { serverId: id, connected: true, toolCount: connection.tools.size };
    } catch (error) {
      const message = context.signal.aborted ? 'Verbinden wurde abgebrochen.' : /401|403|Unauthorized|TOKEN_MISSING/.test(String(error)) ? 'MCP-Anmeldung fehlgeschlagen. Bearer-Token prüfen; OAuth wird noch nicht unterstützt.' : 'MCP-Verbindung fehlgeschlagen. Programm, Argumente, Arbeitsordner beziehungsweise URL und Zugangsdaten in den Einstellungen prüfen.';
      if (connection) { if (this.connections.get(id) === connection) await this.close(id); else try { await connection.client.close(); } catch { /* Only this attempt owns this transport. */ } }
      const cancelled = context.signal.aborted || this.lifecycle !== lifecycle || this.connecting.get(id) !== attempt;
      if (this.active && this.lifecycle === lifecycle && this.connecting.get(id) === attempt) this.errors.set(id, message);
      this.audit(server, 'connect', cancelled ? 'cancelled' : 'failed', start);
      throw new Error(message);
    } finally { if (this.connecting.get(id) === attempt) this.connecting.delete(id); this.host.changed(); }
  }
  async refresh(id: string, signal: AbortSignal) {
    const connection = this.requireConnection(id);
    if (connection.refresh) return connection.refresh;
    const operation = (async () => {
      const tools = new Map<string, CachedTool>(), seen = new Set<string>(); let cursor: string | undefined, limited = false;
      for (let page = 0; page < 25; page++) {
        signal.throwIfAborted();
        const result = await connection.client.listTools(cursor ? { cursor } : {}, { signal, timeout: this.timeout() });
        for (const raw of result.tools) {
          if (tools.size >= 500) { limited = true; break; }
          if (raw.name.length > 200 || tools.has(raw.name)) continue;
          const encoded = JSON.stringify(raw.inputSchema);
          if (containsSecret(raw.name, connection.secrets)) { limited = true; continue; }
          let reason: string | undefined, validate: ValidateFunction | undefined;
          const privateMetadata = containsSecret(raw.inputSchema, connection.secrets) || containsSecret(raw.description ?? '', connection.secrets) || containsSecret(raw.title ?? '', connection.secrets);
          if (privateMetadata) reason = 'Die Werkzeugmetadaten enthalten geschützte Werte und werden nicht angeboten.';
          else if (encoded.length > 12000) reason = 'Das Eingabeschema überschreitet 12.000 Zeichen.';
          else if (hasRemoteReference(raw.inputSchema)) reason = 'Nur lokale Schema-Referenzen werden unterstützt.';
          else try {
            const dialect = raw.inputSchema.$schema;
            let validator: Ajv | Ajv2019 | Ajv2020 = this.ajv2020, canonical: string | undefined;
            if (dialect !== undefined) {
              if (typeof dialect !== 'string') throw new Error('MCP_SCHEMA_DIALECT');
              if (/^https?:\/\/json-schema\.org\/draft-07\/schema#?$/.test(dialect)) { validator = this.ajv07; canonical = 'http://json-schema.org/draft-07/schema#'; }
              else if (/^https?:\/\/json-schema\.org\/draft\/2019-09\/schema#?$/.test(dialect)) { validator = this.ajv2019; canonical = 'https://json-schema.org/draft/2019-09/schema'; }
              else if (/^https?:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/.test(dialect)) canonical = 'https://json-schema.org/draft/2020-12/schema';
              else throw new Error('MCP_SCHEMA_DIALECT');
            }
            // Normalize the equivalent dialect URI for compilation only. The
            // offered schema and its fingerprint remain exactly as advertised.
            validate = validator.compile(canonical ? { ...JSON.parse(encoded), $schema: canonical } : JSON.parse(encoded));
            if ((validate as ValidateFunction & { $async?: boolean }).$async) { validate = undefined; reason = 'Asynchrone Eingabeschemas werden nicht unterstützt.'; }
          } catch (error) { reason = error instanceof Error && error.message === 'MCP_SCHEMA_DIALECT' ? 'Unterstützt werden JSON-Schema Draft-07, 2019-09 und 2020-12.' : 'Dieses Eingabeschema wird noch nicht unterstützt.'; }
          const info: McpToolInfo = { name: raw.name, ...(!privateMetadata && raw.title ? { title: raw.title.slice(0, 200) } : {}), description: privateMetadata ? 'Werkzeugmetadaten wurden zum Schutz gespeicherter Zugangsdaten ausgeblendet.' : (raw.description ?? '').slice(0, 1600), inputSchema: reason ? { type: 'object', properties: {} } : JSON.parse(encoded), allowed: this.store.get(id).allowedTools.includes(raw.name), supported: !!validate, ...(reason ? { reason } : {}), readOnly: raw.annotations?.readOnlyHint === true };
          tools.set(raw.name, { name: raw.name, info, validate, fingerprint: hash(JSON.stringify(info)) });
        }
        if (!result.nextCursor || limited) { cursor = undefined; break; }
        if (seen.has(result.nextCursor)) throw new Error('MCP_LIST_CURSOR_LOOP');
        seen.add(result.nextCursor); cursor = result.nextCursor;
        if (page === 24) limited = true;
      }
      this.assertActive();
      if (this.connections.get(id) !== connection || connection.status !== 'connected') throw new Error('Die MCP-Verbindung wurde beim Laden geändert.');
      connection.tools = tools; connection.warning = limited ? 'Der Werkzeugkatalog wurde auf 500 Werkzeuge beziehungsweise 25 Seiten begrenzt oder enthält nicht übertragbare Metadaten.' : undefined;
      this.host.changed();
    })();
    connection.refresh = operation;
    try { await operation; } finally { if (connection.refresh === operation) connection.refresh = undefined; }
  }
  async listTools(raw: McpToolQuery, context: CapabilityContext) {
    this.assertActive(context); const query = mcpToolQuerySchema.parse(raw);
    if (query.refresh) await this.refresh(query.serverId, context.signal);
    const connection = this.requireConnection(query.serverId), terms = fold(query.query ?? '').split(/\s+/).filter(Boolean);
    const all = [...connection.tools.values()].map(tool => ({ ...tool.info, allowed: this.store.get(query.serverId).allowedTools.includes(tool.name) })).filter(tool => !terms.length || terms.some(term => fold(`${tool.name} ${tool.description}`).includes(term)));
    const offset = query.offset ?? 0, limit = query.limit ?? 25, tools: McpToolInfo[] = []; let next = offset;
    while (next < all.length && tools.length < limit && JSON.stringify([...tools, all[next]]).length < 25000) tools.push(all[next++]);
    const hasMore = next < all.length;
    return { serverId: query.serverId, tools, total: all.length, hasMore, ...(hasMore ? { nextOffset: next } : {}), observedAt: new Date().toISOString() };
  }
  async saveServer(raw: McpServerInput, context: CapabilityContext) {
    this.assertActive(context);
    if (context.origin !== 'ui') throw new Error('MCP-Verbindungen können nur nach Prüfung in den Einstellungen gespeichert werden.');
    const input = mcpServerInputSchema.parse(raw);
    if (input.transport === 'http') input.url = validateMcpUrl(input.url!);
    const old = input.id ? this.store.get(input.id) : undefined;
    const selected = input.allowedTools ?? [], known = new Set([...(this.connections.get(input.id ?? '')?.tools.values() ?? [])].filter(tool => tool.validate).map(tool => tool.name));
    if (selected.some(name => !old?.allowedTools.includes(name) && !known.has(name))) throw new Error('Neue Werkzeugfreigaben erst nach dem Verbinden aus dem tatsächlichen Katalog auswählen.');
    if (old) { if (this.changing.has(old.id) || this.connecting.has(old.id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.'); this.changing.add(old.id); }
    const targetChanged = old && JSON.stringify([old.transport, old.command, old.args, old.cwd, old.url]) !== JSON.stringify([input.transport, input.command, input.args ?? [], input.cwd, input.url]);
    try { if (old) await this.close(old.id); const result = await this.store.save(targetChanged ? { ...input, allowedTools: [] } : input); this.errors.delete(result.id); this.host.changed(); return this.listServers().find(server => server.id === result.id)!; }
    finally { if (old) this.changing.delete(old.id); }
  }
  async removeServer(id: string, context: CapabilityContext) {
    this.assertActive(context); const server = this.store.get(mcpServerIdSchema.parse(id));
    if (this.connecting.has(id) || this.changing.has(id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.');
    if (!await this.host.confirm(context, `${server.name} entfernen?`, 'Die MCP-Verbindung, ihre lokalen Einstellungen und gespeicherten Zugangsdaten werden entfernt.')) return { cancelled: true };
    this.assertActive(context); await this.close(id); await this.store.remove(id); this.errors.delete(id); this.host.changed(); return { removed: true, serverId: id };
  }
  async permissions(raw: McpToolPermissions, context: CapabilityContext) {
    this.assertActive(context);
    if (context.origin !== 'ui') throw new Error('MCP-Werkzeugrechte können nur in den Einstellungen gespeichert werden.');
    const input = mcpPermissionsSchema.parse(raw), old = this.store.get(input.serverId), connection = this.connections.get(input.serverId);
    for (const name of input.allowedTools) if (!old.allowedTools.includes(name) && (!connection || connection.status !== 'connected' || !connection.tools.get(name)?.validate)) throw new Error('Nur unterstützte Werkzeuge aus dem verbundenen Serverkatalog können freigegeben werden.');
    await this.store.permissions(input.serverId, input.allowedTools); this.host.changed(); return this.listServers().find(server => server.id === input.serverId)!;
  }
  auditPage(raw: McpAuditQuery = {}): McpAuditPage { const query = mcpAuditQuerySchema.parse(raw), entries = this.audits.filter(entry => !query.serverId || entry.serverId === query.serverId), offset = query.offset ?? 0, limit = query.limit ?? 30, hasMore = offset + limit < entries.length; return { entries: entries.slice(offset, offset + limit), total: entries.length, hasMore, ...(hasMore ? { nextOffset: offset + limit } : {}) }; }
  private allowed(id: string, tool: CachedTool) { return !!tool.validate && this.store.get(id).allowedTools.includes(tool.name); }
  private descriptor(id: string, tool: CachedTool): ModuleToolDescriptor {
    const connection = this.requireConnection(id), config = this.store.get(id), revision = hash(`${connection.generation}\0${JSON.stringify(config)}\0${tool.fingerprint}`);
    return { name: `mcp_${hash(id).slice(0, 10)}_${revision.slice(0, 32)}`, description: tool.info.description || `MCP-Werkzeug ${tool.name}.`, parameters: JSON.parse(JSON.stringify(tool.info.inputSchema)), label: (tool.info.title ?? tool.name).slice(0, 120) };
  }
  private operationBinding(id: string, tool: CachedTool): OperationBinding {
    // Reconnecting changes the offered name, not the durable logical action.
    return { moduleId: `ovd-mcp.${id}`, action: tool.name, fingerprint: hash(`ovd-mcp-operation-v1\0${this.host.operationFingerprint ?? 'unversioned'}\0${JSON.stringify(this.store.get(id))}\0${tool.fingerprint}`), effect: 'unknown' };
  }
  private serverIdForModule(moduleId: string) { if (!moduleId.startsWith('ovd-mcp.')) throw new Error('Unbekannte MCP-Quelle.'); return mcpServerIdSchema.parse(moduleId.slice('ovd-mcp.'.length)); }
  private toolsForModule(moduleId: string): ModuleToolDescriptor[] { const id = this.serverIdForModule(moduleId), connection = this.connections.get(id); if (!this.active || !connection || connection.status !== 'connected' || this.changing.has(id)) return []; return [...connection.tools.values()].filter(tool => this.allowed(id, tool)).map(tool => this.descriptor(id, tool)); }
  private sourceModules(): ModuleSummary[] { if (!this.active) return []; return this.listServers().filter(server => server.status === 'connected' && server.allowedToolCount > 0).map(server => ({ id: `ovd-mcp.${server.id}`, title: server.name, description: server.description || 'Verbundener MCP-Server mit ausdrücklich freigegebenen Werkzeugen.' })); }
  async callTool(id: string, name: string, args: unknown, context: CapabilityContext, expectedName?: string): Promise<McpCallResult> {
    this.assertActive(context); const server = this.store.get(id), connection = this.requireConnection(id), tool = connection.tools.get(name), start = Date.now();
    if (!tool || !this.allowed(id, tool)) throw new Error('Dieses MCP-Werkzeug ist nicht freigegeben oder unterstützt.');
    if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 16000 || !tool.validate!(args)) throw new Error('Die MCP-Werkzeugargumente entsprechen nicht dem angebotenen Schema.');
    const offered = expectedName ?? this.descriptor(id, tool).name;
    if (this.descriptor(id, tool).name !== offered) throw new Error('Die MCP-Werkzeugbeschreibung wurde geändert. Bitte neu laden.');
    if (context.origin === 'agent' && !await this.host.confirm(context, `${server.name}: ${tool.info.title ?? name} ausführen?`, 'Das freigegebene MCP-Werkzeug kann externe Daten lesen oder ändern. Die Wirkung wird vom verbundenen Server bestimmt.')) {
      this.audit(server, 'call', 'cancelled', start, name); return callResult(id, name, 'cancelled', [], undefined, 'Der MCP-Aufruf wurde nicht ausgeführt.');
    }
    this.assertActive(context);
    const current = this.requireConnection(id), currentTool = current.tools.get(name);
    if (current !== connection || !currentTool || !this.allowed(id, currentTool) || this.descriptor(id, currentTool).name !== offered) throw new Error('MCP-Verbindung, Schema oder Freigabe wurden geändert. Bitte das Werkzeug neu laden.');
    let sent = false;
    try {
      await context.validateOperation?.();
      await context.beforeDispatch?.();
      await context.validateOperation?.();
      this.assertActive(context);
      const latest = this.requireConnection(id), latestTool = latest.tools.get(name);
      if (latest !== connection || !latestTool || !this.allowed(id, latestTool) || this.descriptor(id, latestTool).name !== offered) throw new Error('MCP-Verbindung, Schema oder Freigabe wurden während der Speicherung geändert. Es wurde kein MCP-Aufruf gestartet.');
      context.signal.throwIfAborted(); sent = true;
      const result = await connection.client.callTool({ name, arguments: args as Record<string, unknown> }, undefined, { signal: context.signal, timeout: this.timeout(), resetTimeoutOnProgress: false });
      const outcome = result.isError === true ? 'failed' : 'completed'; this.audit(server, 'call', outcome, start, name); return callResult(id, name, outcome, connection.secrets, result);
    } catch {
      const outcome = sent ? 'uncertain' : context.signal.aborted ? 'cancelled' : 'failed';
      this.audit(server, 'call', outcome, start, name);
      return callResult(id, name, outcome, [], undefined, sent ? 'Die Antwort des MCP-Servers ist ausgeblieben oder die Verbindung wurde unterbrochen. Der Aufruf könnte ausgeführt worden sein; er wurde nicht erneut gesendet.' : 'Der MCP-Aufruf wurde nicht ausgeführt.');
    }
  }
}

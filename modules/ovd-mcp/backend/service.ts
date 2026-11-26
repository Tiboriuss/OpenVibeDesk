import { createHash, randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020';
import Ajv2019 from 'ajv/dist/2019';
import Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import { CatalogClient } from './catalog-client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CapabilityContext } from '../../../electron/workspace-capabilities';
import type { ModuleToolProvider } from '../../../shared/module-tool-provider';
import type { ModuleSummary, ModuleToolDescriptor, ModuleToolQuery } from '../../../shared/modules';
import type { OperationBinding } from '../../../shared/operations';
import { mcpAuditQuerySchema, mcpPermissionsSchema, mcpServerIdSchema, mcpServerInputSchema, mcpToolQuerySchema, type McpAuditEntry, type McpAuditPage, type McpAuditQuery, type McpCallResult, type McpConnectFailure, type McpServerConfig, type McpServerInput, type McpServerSummary, type McpToolInfo, type McpToolPermissions, type McpToolQuery } from '../../../shared/mcp';
import { McpConfigStore, mcpOAuthBinding, validateMcpUrl } from './store';
import { McpOAuthSession } from './oauth';
import { defaultUiLocale, type UiLocale } from '../../../shared/locale';
import { connectFailureText, permissionFeedback } from '../connection-feedback';

// SDK v1 publishes the negotiated revision through this hook on both transports.
// Its HTTP transport already stores it for subsequent request headers.
class McpStdioTransport extends StdioClientTransport {
  protocolVersion?: string;
  setProtocolVersion(version: string) { this.protocolVersion = version; }
}
type McpTransport = McpStdioTransport | StreamableHTTPClientTransport;

function initializeErrorCode(error: unknown): number | undefined {
  if (error instanceof McpError) return error.code;
  // A non-2xx POST in SDK v1 wraps the response body in a transport error.
  const prefix = 'Streamable HTTP error: Error POSTing to endpoint: ';
  if (!(error instanceof StreamableHTTPError) || (error.code !== 400 && error.code !== 404) || error.message.length > 8192 || !error.message.startsWith(prefix)) return;
  try {
    const reply = JSON.parse(error.message.slice(prefix.length));
    if (reply?.jsonrpc !== '2.0' || !('id' in reply) || 'result' in reply || !Number.isInteger(reply.error?.code)) return;
    if (error.code === 400 || reply.error.code === ErrorCode.MethodNotFound) return reply.error.code;
  } catch { /* A proxy or non-RPC error body gives no protocol evidence. */ }
}

function classifyConnectFailure(error: unknown, initializing: boolean, cancelled: boolean, needsLogin: boolean): McpConnectFailure {
  if (cancelled) return 'cancelled';
  if (needsLogin) return 'oauth_required';
  const authRejected = error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403);
  if (authRejected || (error instanceof Error && error.message === 'MCP_TOKEN_MISSING')) return 'authentication';
  if (initializing) {
    const code = initializeErrorCode(error);
    if (code === -32022 || (error instanceof Error && error.message.startsWith("Server's protocol version is not supported: "))) return 'unsupported_version';
    if (code === ErrorCode.MethodNotFound) return 'initialize_unavailable';
    if (code === -32020) return 'header_mismatch';
  }
  return 'connection_failed';
}

type CachedTool = { name: string; info: McpToolInfo; validate?: ValidateFunction };
type Connection = { id: string; generation: string; client: CatalogClient; transport: McpTransport; status: McpServerSummary['status']; tools: Map<string, CachedTool>; catalogRevision?: string; catalogEpoch: number; secrets: string[]; oauth?: McpOAuthSession; abort: AbortController; error?: string; warning?: string; connectedAt?: string; refresh?: Promise<void> };
type Host = { confirm(context: CapabilityContext, message: string, detail: string): Promise<boolean>; changed(): void; requestTimeoutMs?(): number; operationFingerprint?: string; openExternal?(url: string): Promise<void>; getLocale?(): UiLocale };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase('de-DE');

function definitionFingerprint(definition: Record<string, unknown>): string {
  // JSON object members are unordered. Arrays retain their advertised order.
  const canonical = JSON.stringify(definition, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return hash('ovd-mcp-definition-v1\0' + canonical);
}

function savedApprovals(server: McpServerConfig) {
  const approvals = new Map<string, string | null>(server.allowedTools.map(name => [name, null]));
  for (const grant of server.reviewedTools) approvals.set(grant.name, grant.fingerprint);
  return approvals;
}

function permissionState(tool: CachedTool, approvals: ReadonlyMap<string, string | null>): Pick<McpToolInfo, 'allowed' | 'reviewStatus'> {
  const saved = approvals.get(tool.name);
  if (saved === null) return { allowed: false, reviewStatus: 'legacy' };
  if (saved === undefined) return { allowed: false };
  if (!tool.validate || saved !== tool.info.fingerprint) return { allowed: false, reviewStatus: 'changed' };
  return { allowed: true };
}

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
  private readonly errors = new Map<string, McpConnectFailure>();
  private readonly audits: McpAuditEntry[] = [];
  private readonly changing = new Set<string>();
  private readonly signingIn = new Map<string, AbortController>();
  private readonly connectControllers = new Map<string, AbortController>();
  private readonly oauthStates = new Map<string, { status: NonNullable<McpServerSummary['oauthStatus']>; error?: string }>();
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
      getTool: (moduleId, name) => this.toolsForModule(moduleId, name)[0],
      getOperationTool: binding => {
        const id = this.serverIdForModule(binding.moduleId), tool = this.requireConnection(id).tools.get(binding.action);
        return tool && this.allowed(id, tool) && this.operationBinding(id, tool).fingerprint === binding.fingerprint ? this.descriptor(id, tool) : undefined;
      },
      prepareOperation: async (moduleId, name, args, context) => {
        this.assertActive(context);
        const id = this.serverIdForModule(moduleId), tool = this.findOfferedTool(id, name);
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
        const id = this.serverIdForModule(moduleId), tool = this.findOfferedTool(id, name);
        if (!tool) throw new Error('Dieses MCP-Werkzeug ist nicht mehr verbunden oder freigegeben. Bitte den Katalog neu laden.');
        return this.callTool(id, tool.name, args, context, name);
      }
    };
  }
  private assertActive(context?: CapabilityContext) { if (!this.active) throw new Error('Das MCP-Modul ist nicht verfügbar.'); context?.signal.throwIfAborted(); }
  private timeout() { return Math.max(1000, this.host.requestTimeoutMs?.() ?? 60000); }
  private permissionText() { return permissionFeedback[this.host.getLocale?.() ?? defaultUiLocale]; }
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
  async deactivate() { this.active = false; this.lifecycle++; for (const controller of [...this.signingIn.values(), ...this.connectControllers.values()]) controller.abort(); this.connecting.clear(); await Promise.all([...this.connections.keys()].map(id => this.close(id))); this.host.changed(); }
  listServers(): McpServerSummary[] {
    return this.store.list().map(server => {
      const connection = this.connections.get(server.id);
      const connectFailure = this.errors.get(server.id);
      const error = connection?.error ?? (connectFailure && connectFailureText[this.host.getLocale?.() ?? defaultUiLocale][connectFailure]);
      const oauth = this.oauthStates.get(server.id);
      const status = connection?.status ?? (this.connecting.has(server.id) ? 'connecting' : error ? 'error' : 'disconnected');
      const approvals = savedApprovals(server);
      const tools = status === 'connected' && connection?.catalogRevision ? [...connection.tools.values()] : [];
      const permissions = tools.map(tool => permissionState(tool, approvals));
      return {
        ...server, status, toolCount: tools.length, allowedToolCount: permissions.filter(row => row.allowed).length,
        reviewRequiredCount: permissions.filter(row => row.reviewStatus).length,
        ...(status === 'connected' && connection?.catalogRevision ? { catalogRevision: connection.catalogRevision } : {}),
        ...(status === 'connected' && connection?.transport.protocolVersion ? { protocolVersion: connection.transport.protocolVersion } : {}),
        ...(server.authMode === 'oauth' ? { oauthStatus: this.signingIn.has(server.id) ? 'signing_in' as const : oauth?.status ?? (server.hasOAuthTokens ? 'signed_in' as const : 'signed_out' as const), ...(oauth?.error ? { oauthError: oauth.error } : {}) } : {}),
        ...(connectFailure ? { connectFailure } : {}), ...(error ? { error } : {}),
        ...(connection?.warning ? { warning: connection.warning } : {}), ...(connection?.connectedAt ? { connectedAt: connection.connectedAt } : {})
      };
    });
  }
  private oauthRequired(id: string) {
    const error = 'OAuth-Anmeldung erforderlich. Bitte in den MCP-Einstellungen erneut anmelden; der Aufruf wird nicht wiederholt.';
    this.oauthStates.set(id, { status: 'required', error });
    const connection = this.connections.get(id);
    if (connection) { connection.status = 'error'; connection.error = error; connection.tools.clear(); }
    this.host.changed();
  }
  async signIn(id: string, context: CapabilityContext) {
    this.assertActive(context); const server = this.store.get(mcpServerIdSchema.parse(id));
    if (server.transport !== 'http' || server.authMode !== 'oauth') throw new Error('Zuerst OAuth für diese HTTP-Verbindung in den Einstellungen speichern.');
    if (this.signingIn.has(id) || this.connecting.has(id) || this.changing.has(id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.');
    if (context.origin === 'agent' && !await this.host.confirm(context, `${server.name}: im Browser anmelden?`, 'Die gespeicherte OAuth-Anmeldung wird geöffnet. Die Anmeldung erfolgt im Browser; Werkzeugfreigaben bleiben unverändert.')) return { serverId: id, authenticated: false, cancelled: true };
    await context.validateOperation?.(); await context.beforeDispatch?.(); await context.validateOperation?.();
    this.assertActive(context);
    if (mcpOAuthBinding(this.store.get(id)) !== mcpOAuthBinding(server)) throw new Error('Die MCP-Anmeldeeinstellungen wurden geändert. Bitte die Anmeldung erneut starten.');
    if (this.signingIn.has(id) || this.connecting.has(id) || this.changing.has(id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.');
    const controller = new AbortController(), lifecycle = this.lifecycle, start = Date.now();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    this.signingIn.set(id, controller); this.oauthStates.delete(id); this.errors.delete(id); this.host.changed();
    let session: McpOAuthSession | undefined;
    try {
      await this.close(id); signal.throwIfAborted();
      session = new McpOAuthSession(this.store, server, { signal, openExternal: this.host.openExternal });
      await session.signIn(); signal.throwIfAborted(); this.assertActive(context);
      if (lifecycle !== this.lifecycle) throw new Error('MCP_CONNECTION_CHANGED');
      this.oauthStates.set(id, { status: 'signed_in' });
      this.audit(server, 'sign_in', 'completed', start);
    } catch (error) {
      if (signal.aborted || lifecycle !== this.lifecycle) { this.oauthStates.delete(id); this.audit(server, 'sign_in', 'cancelled', start); return { serverId: id, authenticated: false, cancelled: true }; }
      // The OAuth implementation only emits bounded, actionable public errors.
      const message = error instanceof Error ? error.message : 'Die OAuth-Anmeldung ist fehlgeschlagen.';
      this.oauthStates.set(id, { status: 'error', error: message }); this.audit(server, 'sign_in', 'failed', start); throw new Error(message);
    } finally { session?.dispose(); if (this.signingIn.get(id) === controller) this.signingIn.delete(id); this.host.changed(); }
    // Connecting discovers tools; it never changes their saved permissions.
    try { await this.connect(id, context, true); }
    catch { return { serverId: id, authenticated: true, connected: false, message: 'Angemeldet. Die MCP-Verbindung konnte noch nicht hergestellt werden; Verbindungsstatus prüfen.' }; }
    return { serverId: id, authenticated: true, connected: true };
  }
  async cancelSignIn(id: string, context: CapabilityContext) {
    this.assertActive(context); this.store.get(mcpServerIdSchema.parse(id));
    await context.validateOperation?.(); await context.beforeDispatch?.(); await context.validateOperation?.(); this.assertActive(context);
    this.signingIn.get(id)?.abort(); return { serverId: id, cancelled: true };
  }
  async signOut(id: string, context: CapabilityContext) {
    this.assertActive(context); const server = this.store.get(mcpServerIdSchema.parse(id)), start = Date.now();
    if (server.authMode !== 'oauth') throw new Error('Diese Verbindung verwendet kein OAuth.');
    if (this.changing.has(id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.');
    if (context.origin === 'agent' && !await this.host.confirm(context, `${server.name}: abmelden?`, 'Die Verbindung wird getrennt und die gespeicherte lokale OAuth-Anmeldung entfernt. Externe Kontodaten bleiben erhalten.')) return { serverId: id, cancelled: true };
    await context.validateOperation?.(); await context.beforeDispatch?.(); await context.validateOperation?.();
    this.assertActive(context);
    if (this.changing.has(id) || mcpOAuthBinding(this.store.get(id)) !== mcpOAuthBinding(server)) throw new Error('Die MCP-Anmeldeeinstellungen wurden geändert. Bitte erneut prüfen.');
    this.changing.add(id);
    try {
      this.signingIn.get(id)?.abort(); this.connectControllers.get(id)?.abort(); this.connecting.delete(id);
      await this.close(id); await this.store.clearOAuth(id); this.oauthStates.set(id, { status: 'signed_out' }); this.errors.delete(id);
      this.audit(server, 'sign_out', 'completed', start);
      return { serverId: id, signedOut: true };
    } catch {
      const error = 'Die lokale OAuth-Anmeldung konnte nicht vollständig entfernt werden. Den lokalen Zugangsdaten-Speicher prüfen und die Anmeldung erneut zurücksetzen.';
      this.oauthStates.set(id, { status: 'error', error }); this.audit(server, 'sign_out', 'failed', start); throw new Error(error);
    } finally { this.changing.delete(id); this.host.changed(); }
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
    connection.abort.abort(); connection.oauth?.dispose();
    try { await connection.client.close(); } catch { try { await connection.transport.close(); } catch { /* Closing has no retry of a tool call. */ } }
  }
  async disconnect(id: string, context: CapabilityContext) { this.assertActive(context); const server = this.store.get(mcpServerIdSchema.parse(id)), start = Date.now(); this.signingIn.get(id)?.abort(); this.connectControllers.get(id)?.abort(); this.connecting.delete(id); await this.close(id); this.errors.delete(id); this.audit(server, 'disconnect', 'completed', start); return { serverId: id, disconnected: true }; }
  async connect(id: string, context: CapabilityContext, automatic = false) {
    this.assertActive(context); id = mcpServerIdSchema.parse(id);
    const server = this.store.get(id), previous = this.connections.get(id), start = Date.now(), lifecycle = this.lifecycle, attempt = randomUUID();
    if (previous?.status === 'connected') return { serverId: id, connected: true, alreadyConnected: true, protocolVersion: previous.transport.protocolVersion };
    if (previous?.status === 'connecting' || this.changing.has(id) || this.connecting.has(id) || this.signingIn.has(id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.');
    this.connecting.set(id, attempt); this.errors.delete(id); this.host.changed();
    const secretValues: string[] = [];
    const abort = new AbortController(), cancel = () => abort.abort(); context.signal.addEventListener('abort', cancel, { once: true });
    this.connectControllers.set(id, abort);
    let oauth: McpOAuthSession | undefined;
    let connection: Connection | undefined;
    try {
      if (!automatic && context.origin === 'agent' && !await this.host.confirm(context, `${server.name} verbinden?`, server.transport === 'stdio' ? 'Der gespeicherte lokale MCP-Prozess wird mit deinen Benutzerrechten gestartet.' : 'Eine Verbindung zum gespeicherten MCP-Endpunkt wird geöffnet.')) return { serverId: id, cancelled: true };
      this.assertActive(context);
      if (this.lifecycle !== lifecycle || this.connecting.get(id) !== attempt) throw new Error('MCP_CONNECTION_CHANGED');
      await this.close(id);
      const client = new CatalogClient({ name: 'OpenVibeDesk', version: '0.1.0' }, { capabilities: {} });
      let transport: McpTransport;
      if (server.transport === 'stdio') {
        const env = getDefaultEnvironment();
        for (const key of server.envKeys) { const value = await this.store.secrets.get(id, `env:${key}`); if (value === null) throw new Error('MCP_ENV_MISSING'); env[key] = value; secretValues.push(value); }
        transport = new McpStdioTransport({ command: server.command!, args: server.args, ...(server.cwd ? { cwd: server.cwd } : {}), env, stderr: 'ignore', maxBufferSize: 2_000_000 });
      } else {
        const url = new URL(validateMcpUrl(server.url!)), token = server.authMode === 'bearer' && server.hasToken ? await this.store.secrets.get(id, 'token') : null;
        if (server.authMode === 'bearer' && !token) throw new Error('MCP_TOKEN_MISSING');
        if (server.authMode === 'oauth') oauth = new McpOAuthSession(this.store, server, { signal: abort.signal, openExternal: this.host.openExternal });
        if (token) secretValues.push(token);
        const safeFetch: typeof fetch = async (input, init) => {
          const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
          if (target.origin !== url.origin) throw new Error('MCP_CROSS_ORIGIN');
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (oauth) {
            try { headers.set('Authorization', `Bearer ${await oauth.accessToken()}`); }
            catch (error) { if (!abort.signal.aborted) this.oauthRequired(id); throw error; }
            for (const value of oauth.secrets()) if (!secretValues.includes(value)) secretValues.push(value);
          }
          const signal = AbortSignal.any([abort.signal, ...(init?.signal ? [init.signal] : [])]);
          const response = await fetch(input, { ...init, headers, signal, redirect: 'error' });
          if (oauth && (response.status === 401 || response.status === 403)) this.oauthRequired(id);
          if (!response.body) return response;
          let size = 0;
          const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { size += chunk.byteLength; if (size > 4_000_000) { controller.error(new Error('MCP_RESPONSE_LIMIT')); return; } controller.enqueue(chunk); } }));
          return new Response(bounded, { status: response.status, statusText: response.statusText, headers: response.headers });
        };
        transport = new StreamableHTTPClientTransport(url, { fetch: safeFetch, requestInit: { redirect: 'error', ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }, reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 0, initialReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 } });
      }
      this.assertActive(context);
      if (this.lifecycle !== lifecycle || this.connecting.get(id) !== attempt) throw new Error('MCP_CONNECTION_CHANGED');
      connection = { id, generation: randomUUID(), client, transport, status: 'connecting', tools: new Map(), catalogEpoch: 0, secrets: secretValues, abort, ...(oauth ? { oauth } : {}) };
      this.connections.set(id, connection); this.host.changed();
      const current = connection;
      client.onclose = () => { if (this.connections.get(id) === current) { current.status = current.status === 'error' ? 'error' : 'disconnected'; current.tools.clear(); this.host.changed(); } };
      client.onerror = () => { if (this.connections.get(id) === current && current.status === 'connected') { current.status = 'error'; current.error = 'Die MCP-Verbindung wurde unterbrochen. Laufende Aufrufe werden nicht automatisch wiederholt.'; current.tools.clear(); this.host.changed(); void current.client.close().catch(() => {}); } };
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        if (this.connections.get(id) !== current || current.status !== 'connected') return;
        current.catalogEpoch++;
        await this.refresh(id, current.abort.signal).catch(() => { /* Refresh publishes the unavailable catalog. */ });
      });
      await client.connect(transport, { signal: abort.signal, timeout: this.timeout() });
      this.assertActive(context);
      if (this.connections.get(id) !== connection || this.lifecycle !== lifecycle || this.connecting.get(id) !== attempt) throw new Error('MCP_CONNECTION_CHANGED');
      connection.status = 'connected'; connection.connectedAt = new Date().toISOString();
      await this.refresh(id, context.signal);
      if (oauth) this.oauthStates.set(id, { status: 'signed_in' });
      this.audit(server, 'connect', 'completed', start);
      return { serverId: id, connected: true, protocolVersion: transport.protocolVersion, toolCount: connection.tools.size };
    } catch (error) {
      const cancelled = context.signal.aborted || abort.signal.aborted || this.lifecycle !== lifecycle || this.connecting.get(id) !== attempt;
      const initializing = !!connection && !connection.transport.protocolVersion;
      const issue = classifyConnectFailure(error, initializing, cancelled, this.oauthStates.get(id)?.status === 'required');
      if (connection) { if (this.connections.get(id) === connection) await this.close(id); else try { await connection.client.close(); } catch { /* Only this attempt owns this transport. */ } }
      if (this.active && this.lifecycle === lifecycle && this.connecting.get(id) === attempt) this.errors.set(id, issue);
      this.audit(server, 'connect', cancelled ? 'cancelled' : 'failed', start);
      throw new Error(connectFailureText[this.host.getLocale?.() ?? defaultUiLocale][issue]);
    } finally { context.signal.removeEventListener('abort', cancel); if (!connection || this.connections.get(id) !== connection) { abort.abort(); oauth?.dispose(); } if (this.connectControllers.get(id) === abort) this.connectControllers.delete(id); if (this.connecting.get(id) === attempt) this.connecting.delete(id); this.host.changed(); }
  }
  private async readCatalog(connection: Connection, signal: AbortSignal) {
    const tools = new Map<string, CachedTool>(), seen = new Set<string>(); let cursor: string | undefined, limited = false;
    for (let page = 0; page < 25; page++) {
      signal.throwIfAborted();
      const result = await connection.client.listTools(cursor ? { cursor } : {}, { signal, timeout: this.timeout() });
      for (const raw of result.tools) {
        if (tools.size >= 500) { limited = true; break; }
        if (!raw.name || raw.name.length > 200) continue;
        if (tools.has(raw.name)) throw new Error(this.permissionText().duplicate);
        const encoded = JSON.stringify(raw.inputSchema);
        if (containsSecret(raw.name, connection.secrets)) { limited = true; continue; }
        let reason: string | undefined, validate: ValidateFunction | undefined;
        const { name, title, description, inputSchema, outputSchema, annotations, execution } = raw;
        const definition = { name, title, description, inputSchema, outputSchema, annotations, execution };
        const privateMetadata = containsSecret(definition, connection.secrets);
        const incomplete = connection.client.incompleteDefinitions.has(raw);
        const reviewable = !incomplete && !privateMetadata && JSON.stringify(definition).length <= 48000;
        const fingerprint = reviewable ? definitionFingerprint(definition) : '';
        const previous = connection.tools.get(name);
        if (previous?.validate && fingerprint === previous.info.fingerprint) {
          tools.set(name, previous);
          continue;
        }
        if (privateMetadata) reason = 'Die Werkzeugmetadaten enthalten geschützte Werte und werden nicht angeboten.';
        else if (incomplete) reason = this.permissionText().incomplete;
        else if (!reviewable) reason = this.permissionText().largeDefinition;
        else if (execution?.taskSupport === 'required') reason = this.permissionText().requiresTask;
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
          const schema = canonical ? { ...inputSchema, $schema: canonical } : inputSchema;
          try { validate = validator.compile(schema); } finally { validator.removeSchema(schema); }
          if ((validate as ValidateFunction & { $async?: boolean }).$async) { validate = undefined; reason = 'Asynchrone Eingabeschemas werden nicht unterstützt.'; }
        } catch (error) { reason = error instanceof Error && error.message === 'MCP_SCHEMA_DIALECT' ? 'Unterstützt werden JSON-Schema Draft-07, 2019-09 und 2020-12.' : 'Dieses Eingabeschema wird noch nicht unterstützt.'; }
        const info: McpToolInfo = {
          name, ...(!privateMetadata && title ? { title: title.slice(0, 200) } : {}),
          description: privateMetadata ? 'Werkzeugmetadaten wurden zum Schutz gespeicherter Zugangsdaten ausgeblendet.' : (description ?? '').slice(0, 1600),
          inputSchema: reason ? { type: 'object', properties: {} } : inputSchema, readOnly: annotations?.readOnlyHint === true,
          allowed: false, supported: !!validate, ...(reason ? { reason } : {}), ...(reviewable ? { definition } : {}),
          fingerprint
        };
        tools.set(name, { name, info, validate });
      }
      if (!result.nextCursor || limited) { cursor = undefined; break; }
      if (seen.has(result.nextCursor)) throw new Error('MCP_LIST_CURSOR_LOOP');
      seen.add(result.nextCursor); cursor = result.nextCursor;
      if (page === 24) limited = true;
    }
    return { tools, limited };
  }
  async refresh(id: string, signal: AbortSignal, invalidate = true) {
    const connection = this.requireConnection(id);
    if (invalidate) connection.catalogRevision = undefined;
    if (connection.refresh) return connection.refresh;
    const operation = (async () => {
      // A list-changed notification can arrive between inventory pages.
      for (let attempt = 0; attempt < 2; attempt++) {
        const epoch = connection.catalogEpoch;
        const { tools, limited } = await this.readCatalog(connection, signal);
        this.assertActive();
        if (this.requireConnection(id) !== connection) throw new Error('MCP_CONNECTION_CHANGED');
        if (epoch !== connection.catalogEpoch) continue;
        connection.tools = tools;
        connection.catalogRevision = hash(JSON.stringify([connection.generation, [...tools.values()].map(tool => [tool.name, tool.info.fingerprint, tool.info.reason])]));
        connection.warning = limited ? 'Der Werkzeugkatalog wurde auf 500 Werkzeuge beziehungsweise 25 Seiten begrenzt oder enthält nicht übertragbare Metadaten.' : undefined;
        return;
      }
      throw new Error(this.permissionText().catalogChanged);
    })();
    connection.refresh = operation;
    try { await operation; }
    catch (error) { connection.catalogRevision = undefined; connection.tools.clear(); connection.warning = this.permissionText().refreshFailed; throw error; }
    finally { connection.refresh = undefined; this.host.changed(); }
  }
  private async checkCurrentCatalog(id: string, signal: AbortSignal) {
    const connection = this.requireConnection(id);
    if (!connection.client.getServerCapabilities()?.tools?.listChanged) await this.refresh(id, signal, false);
    else if (connection.refresh) await connection.refresh;
  }
  async listTools(raw: McpToolQuery, context: CapabilityContext) {
    this.assertActive(context); const query = mcpToolQuerySchema.parse(raw);
    const connection = this.requireConnection(query.serverId);
    if (query.refresh) await this.refresh(query.serverId, context.signal);
    else if (connection.refresh) await connection.refresh;
    this.assertActive(context);
    if (!connection.catalogRevision || this.requireConnection(query.serverId) !== connection) throw new Error(this.permissionText().refreshFailed);
    const terms = fold(query.query ?? '').split(/\s+/).filter(Boolean);
    const server = this.store.get(query.serverId), approvals = savedApprovals(server);
    const all = [...connection.tools.values()].map(tool => ({ ...tool.info, ...permissionState(tool, approvals) }))
      .filter(tool => !terms.length || terms.some(term => fold(`${tool.name} ${tool.description}`).includes(term)))
      .sort((a, b) => Number(!!b.reviewStatus) - Number(!!a.reviewStatus));
    const offset = query.offset ?? 0, limit = query.limit ?? 25, tools: McpToolInfo[] = []; let next = offset;
    while (next < all.length && tools.length < limit && (!tools.length || JSON.stringify([...tools, all[next]]).length < 25000)) tools.push(all[next++]);
    const hasMore = next < all.length;
    return { serverId: query.serverId, tools, total: all.length, hasMore, ...(hasMore ? { nextOffset: next } : {}), observedAt: new Date().toISOString(), catalogRevision: connection.catalogRevision, permissionRevision: server.permissionRevision };
  }
  async saveServer(raw: McpServerInput, context: CapabilityContext) {
    this.assertActive(context);
    if (context.origin !== 'ui') throw new Error('MCP-Verbindungen können nur nach Prüfung in den Einstellungen gespeichert werden.');
    const input = mcpServerInputSchema.parse(raw);
    if (input.transport === 'http') input.url = validateMcpUrl(input.url!);
    const old = input.id ? this.store.get(input.id) : undefined;
    if (old) { if (this.changing.has(old.id) || this.connecting.has(old.id) || this.signingIn.has(old.id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.'); this.changing.add(old.id); }
    try { if (old) await this.close(old.id); const result = await this.store.save(input); this.errors.delete(result.id); this.oauthStates.delete(result.id); this.host.changed(); return this.listServers().find(server => server.id === result.id)!; }
    finally { if (old) this.changing.delete(old.id); }
  }
  async removeServer(id: string, context: CapabilityContext) {
    this.assertActive(context); const server = this.store.get(mcpServerIdSchema.parse(id));
    if (this.connecting.has(id) || this.changing.has(id) || this.signingIn.has(id)) throw new Error('Für diesen MCP-Server läuft bereits ein Vorgang.');
    if (!await this.host.confirm(context, `${server.name} entfernen?`, 'Die MCP-Verbindung, ihre lokalen Einstellungen und gespeicherten Zugangsdaten werden entfernt.')) return { cancelled: true };
    this.assertActive(context); await this.close(id); await this.store.remove(id); this.errors.delete(id); this.oauthStates.delete(id); this.host.changed(); return { removed: true, serverId: id };
  }
  async permissions(raw: McpToolPermissions, context: CapabilityContext) {
    this.assertActive(context);
    if (context.origin !== 'ui') throw new Error('MCP-Werkzeugrechte können nur in den Einstellungen gespeichert werden.');
    const input = mcpPermissionsSchema.parse(raw), id = input.serverId;
    try {
      if (input.changes.some(change => change.fingerprint !== null)) await this.checkCurrentCatalog(id, context.signal);
      await this.store.permissions(input, () => {
        this.assertActive(context);
        const connection = this.connections.get(id);
        for (const { name, fingerprint } of input.changes) {
          if (fingerprint === null) continue;
          const tool = connection?.tools.get(name);
          if (this.changing.has(id) || connection?.status !== 'connected' || !connection.catalogRevision || !tool?.validate || tool.info.fingerprint !== fingerprint) throw new Error(this.permissionText().catalogChanged);
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'MCP_PERMISSION_REVISION_CHANGED') throw new Error(this.permissionText().permissionsChanged);
      if (error instanceof Error && error.message === 'MCP_PERMISSION_LIMIT') throw new Error(this.permissionText().limit);
      throw error;
    }
    this.host.changed(); return this.listServers().find(server => server.id === id)!;
  }
  auditPage(raw: McpAuditQuery = {}): McpAuditPage { const query = mcpAuditQuerySchema.parse(raw), entries = this.audits.filter(entry => !query.serverId || entry.serverId === query.serverId), offset = query.offset ?? 0, limit = query.limit ?? 30, hasMore = offset + limit < entries.length; return { entries: entries.slice(offset, offset + limit), total: entries.length, hasMore, ...(hasMore ? { nextOffset: offset + limit } : {}) }; }
  private allowed(id: string, tool: CachedTool) { return !!this.connections.get(id)?.catalogRevision && !!tool.validate && this.store.get(id).reviewedTools.some(row => row.name === tool.name && row.fingerprint === tool.info.fingerprint); }
  private offerName(connection: Connection, config: McpServerConfig, tool: CachedTool) {
    const revision = hash([connection.generation, config.permissionRevision, tool.info.fingerprint].join('\0'));
    return `mcp_${hash(config.id).slice(0, 10)}_${revision.slice(0, 32)}`;
  }
  private descriptor(id: string, tool: CachedTool, offered = this.offerName(this.requireConnection(id), this.store.get(id), tool)): ModuleToolDescriptor {
    return { name: offered, description: tool.info.description || `MCP-Werkzeug ${tool.name}.`, parameters: structuredClone(tool.info.inputSchema), label: (tool.info.title ?? tool.name).slice(0, 120) };
  }
  private operationBinding(id: string, tool: CachedTool): OperationBinding {
    // Reconnecting changes the offered name, not the durable logical action.
    return { moduleId: `ovd-mcp.${id}`, action: tool.name, fingerprint: hash(`ovd-mcp-operation-v2\0${this.host.operationFingerprint ?? 'unversioned'}\0${JSON.stringify(this.store.get(id))}\0${tool.info.fingerprint}`), effect: 'unknown' };
  }
  private serverIdForModule(moduleId: string) { if (!moduleId.startsWith('ovd-mcp.')) throw new Error('Unbekannte MCP-Quelle.'); return mcpServerIdSchema.parse(moduleId.slice('ovd-mcp.'.length)); }
  private findOfferedTool(id: string, name: string) {
    const connection = this.requireConnection(id), config = this.store.get(id), approvals = savedApprovals(config);
    if (!connection.catalogRevision) return;
    return [...connection.tools.values()].find(tool => permissionState(tool, approvals).allowed && this.offerName(connection, config, tool) === name);
  }
  private toolsForModule(moduleId: string, name?: string): ModuleToolDescriptor[] {
    const id = this.serverIdForModule(moduleId), connection = this.connections.get(id);
    if (!this.active || connection?.status !== 'connected' || !connection.catalogRevision || this.changing.has(id)) return [];
    const server = this.store.get(id), approvals = savedApprovals(server), result: ModuleToolDescriptor[] = [];
    for (const tool of connection.tools.values()) {
      if (!permissionState(tool, approvals).allowed) continue;
      const offered = this.offerName(connection, server, tool);
      if (!name || name === offered) result.push(this.descriptor(id, tool, offered));
    }
    return result;
  }
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
    if (current !== connection || !currentTool || !this.allowed(id, currentTool) || this.descriptor(id, currentTool).name !== offered) throw new Error(this.permissionText().offerChanged);
    let sent = false;
    try {
      // Refresh before dispatch, without ever replaying a failed MCP request.
      if (connection.oauth) {
        try { await connection.oauth.accessToken(); }
        catch (error) { if (!context.signal.aborted) this.oauthRequired(id); throw error; }
      }
      await context.validateOperation?.();
      await context.beforeDispatch?.();
      await context.validateOperation?.();
      await this.checkCurrentCatalog(id, context.signal);
      this.assertActive(context);
      const latest = this.requireConnection(id), latestTool = latest.tools.get(name);
      if (latest !== connection || !latestTool || !this.allowed(id, latestTool) || this.descriptor(id, latestTool).name !== offered) {
        this.audit(server, 'call', 'failed', start, name);
        return callResult(id, name, 'failed', [], undefined, this.permissionText().offerChanged);
      }
      context.signal.throwIfAborted(); sent = true;
      const result = await connection.client.callTool({ name, arguments: args as Record<string, unknown> }, undefined, { signal: context.signal, timeout: this.timeout(), resetTimeoutOnProgress: false });
      const outcome = result.isError === true ? 'failed' : 'completed'; this.audit(server, 'call', outcome, start, name); return callResult(id, name, outcome, connection.secrets, result);
    } catch {
      const outcome = sent ? 'uncertain' : context.signal.aborted ? 'cancelled' : 'failed';
      this.audit(server, 'call', outcome, start, name);
      return callResult(id, name, outcome, [], undefined, sent ? 'Die Antwort des MCP-Servers ist ausgeblieben oder die Verbindung wurde unterbrochen. Der Aufruf könnte ausgeführt worden sein; er wurde nicht erneut gesendet.' : this.oauthStates.get(id)?.status === 'required' ? 'OAuth-Anmeldung erforderlich. Der MCP-Aufruf wurde nicht ausgeführt; zuerst erneut anmelden.' : 'Der MCP-Aufruf wurde nicht ausgeführt.');
    }
  }
}

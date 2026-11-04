import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { auth, discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, exchangeAuthorization, extractWWWAuthenticateParams, refreshAuthorization, selectResourceURL, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthClientInformationFullSchema, OAuthClientInformationSchema, OAuthTokensSchema, type OAuthClientInformationMixed, type OAuthClientMetadata, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { validateMcpOAuthEndpointUrl, type McpServerConfig } from '../../../shared/mcp';
import { McpConfigStore } from './store';

export class McpOAuthRequiredError extends Error {
  constructor(message = 'Für diesen MCP-Server ist eine Anmeldung erforderlich. In den MCP-Einstellungen „Anmelden“ wählen.') { super(message); this.name = 'McpOAuthRequiredError'; }
}
type Credentials = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; expiresAt?: number; refreshPending?: boolean; discovery?: OAuthDiscoveryState };
type Options = { signal: AbortSignal; openExternal?(url: string): Promise<void>; fetcher?: FetchLike };
const isLoopback = (url: URL) => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
const sameUrl = (left: string, right: string) => new URL(left).href === new URL(right).href;
const invalid = () => new McpOAuthRequiredError('Die OAuth-Konfiguration des MCP-Servers ist ungültig oder wird nicht unterstützt. Serverangaben und OAuth-Einstellungen prüfen.');
const oauthErrorMessages: Record<string, string> = {
  invalid_client: 'Der OAuth-Anbieter hat die Client-Anmeldung abgelehnt (invalid_client). Client-ID, Client-Secret und Client-Anmeldung (Basic/POST) prüfen.',
  invalid_grant: 'Der OAuth-Anbieter hat den Autorisierungscode abgelehnt (invalid_grant). Der Code kann abgelaufen oder bereits verwendet sein. Rückrufadresse und PKCE-Einrichtung prüfen und die Anmeldung neu starten.',
  invalid_scope: 'Der OAuth-Anbieter akzeptiert die angeforderten Berechtigungen nicht (invalid_scope). Die OAuth-Scopes prüfen.',
  invalid_request: 'Der OAuth-Anbieter hat die Anfrage abgelehnt (invalid_request). Client-Angaben und registrierte Rückrufadresse prüfen.',
  unauthorized_client: 'Die registrierte Anwendung darf diesen OAuth-Ablauf nicht verwenden (unauthorized_client). Die Freigabe für Authorization Code beim Anbieter prüfen.',
  unsupported_grant_type: 'Der OAuth-Anbieter unterstützt den benötigten Authorization-Code-Ablauf nicht (unsupported_grant_type). Die Anbieter-Konfiguration prüfen.',
  unsupported_response_type: 'Der OAuth-Anbieter unterstützt die benötigte Code-Antwort nicht (unsupported_response_type). Die Anbieter-Konfiguration prüfen.',
  invalid_target: 'Der OAuth-Anbieter akzeptiert die angeforderte MCP-Ressource nicht (invalid_target). MCP-URL und Anbieter-Konfiguration prüfen.',
  access_denied: 'Die OAuth-Anmeldung wurde beim Anbieter abgelehnt (access_denied).',
  temporarily_unavailable: 'Der OAuth-Anbieter ist vorübergehend nicht verfügbar (temporarily_unavailable). Die Anmeldung später erneut starten.',
  server_error: 'Der OAuth-Anbieter hat einen Fehler gemeldet (server_error). Die Anbieter-Konfiguration prüfen oder die Anmeldung später erneut starten.'
};

/** A session never opens a browser from a transport request and never retries MCP calls. */
export class McpOAuthSession implements OAuthClientProvider {
  private readonly lifetime = new AbortController();
  private readonly signal: AbortSignal;
  private credentials: Credentials = {};
  private loaded = false;
  private loading?: Promise<void>;
  private refreshing?: Promise<string>;
  private interactive = false;
  private listener?: Server;
  private stateValue?: string;
  private verifier?: string;
  private authorizationUrl?: URL;
  private discovery?: OAuthDiscoveryState;
  private challengeScope?: string;
  private responseIssuerRequired = false;
  private suppliedSecret?: string;
  private readonly knownSecrets = new Set<string>();
  constructor(private readonly store: McpConfigStore, private readonly config: McpServerConfig, private readonly options: Options) {
    this.signal = AbortSignal.any([options.signal, this.lifetime.signal]);
    if (config.transport !== 'http' || config.authMode !== 'oauth' || !config.url) throw invalid();
  }
  get redirectUrl() { return `http://127.0.0.1:${this.config.oauthRedirectPort ?? 43189}/oauth/callback`; }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'OpenVibeDesk', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: this.suppliedSecret ? 'client_secret_basic' : 'none', ...(this.config.oauthScopes ? { scope: this.config.oauthScopes } : {}) };
  }
  private check() { this.signal.throwIfAborted(); }
  private safeUrl(raw: string | URL): URL {
    let url: URL; try { url = new URL(raw); } catch { throw invalid(); }
    if (url.username || url.password || url.hash || url.href.length > 8192 || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url) && isLoopback(new URL(this.config.url!))))) throw invalid();
    return url;
  }
  private remember() { for (const value of [this.suppliedSecret, this.credentials.client?.client_secret, this.credentials.tokens?.access_token, this.credentials.tokens?.refresh_token, this.credentials.tokens?.id_token]) if (value) this.knownSecrets.add(value); }
  secrets(): string[] { return [...this.knownSecrets]; }
  private async load(): Promise<void> {
    if (this.loaded) { this.check(); return; }
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const raw = await this.store.readOAuth(this.config); this.check();
      if (raw) {
        try {
          const client = raw.client === undefined ? undefined : (raw.client && typeof raw.client === 'object' && 'redirect_uris' in raw.client ? OAuthClientInformationFullSchema : OAuthClientInformationSchema).parse(raw.client);
          const tokens = raw.tokens === undefined ? undefined : OAuthTokensSchema.parse(raw.tokens);
          if (client && !client.issuer || tokens && !tokens.issuer || raw.expiresAt !== undefined && (typeof raw.expiresAt !== 'number' || !Number.isFinite(raw.expiresAt))) throw invalid();
          this.credentials = { ...(client ? { client } : {}), ...(tokens ? { tokens } : {}), ...(typeof raw.expiresAt === 'number' ? { expiresAt: raw.expiresAt } : {}), ...(raw.refreshPending === true ? { refreshPending: true } : {}), ...(raw.discovery && typeof raw.discovery === 'object' ? { discovery: raw.discovery as OAuthDiscoveryState } : {}) };
        } catch { throw new McpOAuthRequiredError('Die gespeicherte MCP-Anmeldung ist nicht lesbar. Bitte erneut anmelden.'); }
      }
      this.suppliedSecret = await this.store.oauthClientSecret(this.config); this.check(); this.remember(); this.loaded = true;
    })();
    try { await this.loading; } finally { this.loading = undefined; }
  }
  private async persist(next: Credentials): Promise<void> {
    this.check(); await this.store.writeOAuth(this.config, next as Record<string, unknown>); this.check(); this.credentials = next; this.remember();
  }
  private readonly fetchOAuth: FetchLike = async (input, init) => {
    this.check(); const url = this.safeUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const metadata = this.discovery?.authorizationServerMetadata;
    if (method !== 'GET' && (method !== 'POST' || ![metadata?.token_endpoint, metadata?.registration_endpoint].some(endpoint => endpoint && sameUrl(endpoint, url.href)))) throw invalid();
    const signal = AbortSignal.any([this.signal, AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])]);
    let response: Response;
    try { response = await (this.options.fetcher ?? fetch)(url, { ...init, redirect: 'error', signal }); }
    catch { this.check(); throw new McpOAuthRequiredError('Der OAuth-Server ist nicht erreichbar. Verbindung prüfen und die Anmeldung erneut starten.'); }
    const reader = response.body?.getReader(); if (!reader) return response;
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) throw invalid(); chunks.push(part.value); }
      const body = Buffer.concat(chunks);
      // SDK v1 strips this newer metadata member. Retain only its boolean value
      // from the issuer's metadata, never an unvalidated endpoint or instruction.
      if (method === 'GET' && response.ok) try {
        const parsed = JSON.parse(body.toString('utf8'));
        if (parsed && typeof parsed.issuer === 'string' && typeof parsed.authorization_endpoint === 'string' && typeof parsed.token_endpoint === 'string') this.responseIssuerRequired = parsed.authorization_response_iss_parameter_supported === true;
      } catch { /* The SDK reports invalid JSON without exposing response content. */ }
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { await reader.cancel().catch(() => {}); }
  };
  private validateDiscovery(state: OAuthDiscoveryState): void {
    const issuer = this.safeUrl(state.authorizationServerUrl), metadata = state.authorizationServerMetadata;
    if (!metadata || !sameUrl(metadata.issuer, issuer.href) || this.config.oauthIssuer && !sameUrl(this.config.oauthIssuer, issuer.href) || !metadata.code_challenge_methods_supported?.includes('S256') || !metadata.response_types_supported.includes('code')) throw invalid();
    this.safeUrl(metadata.authorization_endpoint); this.safeUrl(metadata.token_endpoint);
    if (metadata.registration_endpoint) this.safeUrl(metadata.registration_endpoint);
    if (state.resourceMetadata && !state.resourceMetadata.authorization_servers?.some(value => sameUrl(value, issuer.href))) throw invalid();
  }
  private async discover(probe: boolean): Promise<OAuthDiscoveryState> {
    const manualEndpoints = !!this.config.oauthAuthorizationUrl && !!this.config.oauthTokenUrl;
    if (manualEndpoints && (!this.config.oauthIssuer || !this.config.oauthClientId)) throw new McpOAuthRequiredError('Für manuelle OAuth-Endpunkte bitte auch die registrierte Client-ID und den zugehörigen Issuer angeben.');
    let resourceMetadataUrl = !probe && this.credentials.discovery?.resourceMetadataUrl ? this.safeUrl(this.credentials.discovery.resourceMetadataUrl) : undefined;
    if (probe) {
      // A credential-free GET may provide a path-specific RFC 9728 challenge; no tool executes.
      const response = await (this.options.fetcher ?? fetch)(this.config.url!, { method: 'GET', headers: { Accept: 'application/json, text/event-stream' }, redirect: 'error', signal: AbortSignal.any([this.signal, AbortSignal.timeout(10_000)]) });
      try {
        const challenge = extractWWWAuthenticateParams(response); resourceMetadataUrl = challenge.resourceMetadataUrl;
        if (resourceMetadataUrl) this.safeUrl(resourceMetadataUrl);
        if (challenge.scope) { if (challenge.scope.length > 2000 || /[\r\n\0]/.test(challenge.scope)) throw invalid(); this.challengeScope = challenge.scope; }
      }
      finally { await response.body?.cancel().catch(() => {}); }
    }
    let resourceMetadata: OAuthDiscoveryState['resourceMetadata'];
    try { resourceMetadata = await discoverOAuthProtectedResourceMetadata(this.config.url!, { resourceMetadataUrl }, this.fetchOAuth); }
    catch { this.check(); if (resourceMetadataUrl && !manualEndpoints) throw invalid(); }
    const issuers = resourceMetadata?.authorization_servers ?? [];
    const authorizationServerUrl = this.config.oauthIssuer ?? issuers[0] ?? new URL('/', this.config.url).href;
    this.safeUrl(authorizationServerUrl);
    if (this.config.oauthIssuer && issuers.length && !issuers.some(value => sameUrl(value, authorizationServerUrl))) throw invalid();
    let authorizationServerMetadata: OAuthDiscoveryState['authorizationServerMetadata'];
    if (manualEndpoints) {
      // These endpoints are explicitly saved by the user for a registered
      // Authorization Code client. PKCE remains mandatory without discovery.
      this.responseIssuerRequired = false;
      authorizationServerMetadata = {
        issuer: authorizationServerUrl,
        authorization_endpoint: validateMcpOAuthEndpointUrl(this.config.oauthAuthorizationUrl!, this.config.url),
        token_endpoint: validateMcpOAuthEndpointUrl(this.config.oauthTokenUrl!, this.config.url),
        response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: this.suppliedSecret ? ['client_secret_basic', 'client_secret_post'] : ['none']
      };
    } else {
      authorizationServerMetadata = await discoverAuthorizationServerMetadata(authorizationServerUrl, { fetchFn: this.fetchOAuth });
      const discovered = { authorizationServerUrl, authorizationServerMetadata, ...(resourceMetadata ? { resourceMetadata } : {}) };
      this.validateDiscovery(discovered);
      if (this.config.oauthAuthorizationUrl) authorizationServerMetadata = { ...authorizationServerMetadata!, authorization_endpoint: validateMcpOAuthEndpointUrl(this.config.oauthAuthorizationUrl, this.config.url) };
      if (this.config.oauthTokenUrl) authorizationServerMetadata = { ...authorizationServerMetadata!, token_endpoint: validateMcpOAuthEndpointUrl(this.config.oauthTokenUrl, this.config.url) };
    }
    const state: OAuthDiscoveryState = { authorizationServerUrl, authorizationServerMetadata, ...(resourceMetadata ? { resourceMetadata } : {}), ...(resourceMetadataUrl ? { resourceMetadataUrl: resourceMetadataUrl.href } : {}) };
    this.validateDiscovery(state); this.discovery = state; await selectResourceURL(this.config.url!, this, resourceMetadata); return state;
  }
  async discoveryState() { return this.discovery; }
  async saveDiscoveryState(state: OAuthDiscoveryState) { this.validateDiscovery(state); this.discovery = state; }
  async state() { if (!this.interactive || !this.stateValue) throw invalid(); return this.stateValue; }
  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    await this.load();
    if (this.config.oauthClientId) {
      const issuer = this.config.oauthIssuer ?? this.discovery?.authorizationServerUrl;
      if (!issuer) throw invalid();
      const method = this.config.oauthClientAuthMethod;
      if (method && method !== 'auto') {
        if (!this.suppliedSecret) throw new McpOAuthRequiredError('Für die gewählte Client-Anmeldung muss ein Client-Secret gespeichert sein.');
        const supported = this.discovery?.authorizationServerMetadata?.token_endpoint_auth_methods_supported;
        if (supported?.length && !supported.includes(method)) throw new McpOAuthRequiredError('Der OAuth-Anbieter bietet das gewählte Client-Anmeldeverfahren nicht an. Die Client-Anmeldung in den OAuth-Einstellungen prüfen.');
      }
      const information = { client_id: this.config.oauthClientId, issuer, ...(this.suppliedSecret ? { client_secret: this.suppliedSecret } : {}), ...(method && method !== 'auto' ? { token_endpoint_auth_method: method } : {}) };
      return information;
    }
    const client = this.credentials.client;
    if (client && this.discovery && !sameUrl(client.issuer!, this.discovery.authorizationServerUrl)) throw new McpOAuthRequiredError('Der OAuth-Anbieter dieses MCP-Servers hat sich geändert. Anmeldung zuerst entfernen und anschließend neu einrichten.');
    return client;
  }
  async saveClientInformation(client: OAuthClientInformationMixed) {
    if (!client.issuer || !this.discovery || !sameUrl(client.issuer, this.discovery.authorizationServerUrl)) throw invalid();
    await this.persist({ ...this.credentials, client });
  }
  async tokens() { await this.load(); return this.interactive ? undefined : this.credentials.tokens; }
  async saveTokens(raw: OAuthTokens) {
    const tokens = OAuthTokensSchema.parse(raw);
    if (!tokens.access_token || tokens.access_token.length > 32768 || tokens.refresh_token && tokens.refresh_token.length > 32768 || tokens.token_type.toLowerCase() !== 'bearer' || !tokens.issuer || !this.discovery || !sameUrl(tokens.issuer, this.discovery.authorizationServerUrl) || tokens.expires_in !== undefined && (!Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)) throw invalid();
    const { refreshPending: _pending, expiresAt: _expiresAt, ...retained } = this.credentials;
    await this.persist({ ...retained, client: await this.clientInformation(), tokens, ...(tokens.expires_in !== undefined ? { expiresAt: Date.now() + tokens.expires_in * 1000 } : {}), discovery: this.discovery });
  }
  async saveCodeVerifier(verifier: string) { if (!this.interactive || verifier.length > 256) throw invalid(); this.verifier = verifier; }
  async codeVerifier() { if (!this.interactive || !this.verifier) throw invalid(); return this.verifier; }
  async redirectToAuthorization(url: URL) {
    if (!this.interactive || !this.options.openExternal || !this.discovery?.authorizationServerMetadata || !sameUrl(new URL(url.pathname, url.origin).href, new URL(new URL(this.discovery.authorizationServerMetadata.authorization_endpoint).pathname, new URL(this.discovery.authorizationServerMetadata.authorization_endpoint).origin).href)) throw invalid();
    this.safeUrl(url); this.authorizationUrl = url;
  }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'verifier') { this.verifier = undefined; return; }
    if (scope === 'discovery') { this.discovery = undefined; return; }
    const next = { ...this.credentials };
    if (scope === 'all' || scope === 'client') delete next.client;
    if (scope === 'all' || scope === 'tokens') { delete next.tokens; delete next.expiresAt; delete next.refreshPending; }
    await this.persist(next);
  }
  async signIn(): Promise<void> {
    this.check(); if (!this.options.openExternal || this.interactive) throw invalid();
    await this.load(); this.interactive = true; this.stateValue = randomBytes(32).toString('base64url');
    const timeout = setTimeout(() => this.lifetime.abort(new McpOAuthRequiredError('Die MCP-Anmeldung ist abgelaufen. Bitte erneut starten.')), 5 * 60_000);
    let settle: ((value: string | Error) => void) | undefined, consumed = false;
    const callback = new Promise<string>((resolve, reject) => { settle = value => value instanceof Error ? reject(value) : resolve(value); });
    void callback.catch(() => {});
    const abort = () => settle?.(this.signal.reason instanceof Error ? this.signal.reason : new DOMException('Anmeldung abgebrochen.', 'AbortError'));
    this.signal.addEventListener('abort', abort, { once: true });
    try {
      this.listener = createServer((request, response) => {
        response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
        let url: URL; try { url = new URL(request.url ?? '', this.redirectUrl); } catch { response.writeHead(400); response.end(); return; }
        if (consumed || request.method !== 'GET' || request.headers.host !== new URL(this.redirectUrl).host || request.socket.remoteAddress !== '127.0.0.1' || url.pathname !== '/oauth/callback' || !this.authorizationUrl || (request.url?.length ?? 0) > 8192) { response.writeHead(404); response.end(); return; }
        const state = url.searchParams.getAll('state');
        if (state.length !== 1 || Buffer.byteLength(state[0]) !== Buffer.byteLength(this.stateValue!) || !timingSafeEqual(Buffer.from(state[0]), Buffer.from(this.stateValue!))) { response.writeHead(400); response.end('Ungültige Anmeldung.'); return; }
        const expectedIssuer = this.discovery!.authorizationServerMetadata!.issuer, issuer = url.searchParams.getAll('iss');
        if (issuer.length > 1 || issuer.length === 1 && issuer[0] !== expectedIssuer || this.responseIssuerRequired && issuer.length !== 1) {
          consumed = true; response.writeHead(400); response.end('Ungültiger Anmeldeanbieter. Bitte die Meldung in OpenVibeDesk beachten.');
          settle?.(new McpOAuthRequiredError(issuer.length === 0
            ? 'Der OAuth-Anbieter hat den erforderlichen Issuer im Rückruf nicht mitgeschickt. Bitte die Anbieter-Konfiguration prüfen.'
            : 'Der OAuth-Issuer im Rückruf stimmt nicht exakt mit dem erwarteten Issuer überein. Die Issuer-URL einschließlich abschließendem Schrägstrich prüfen oder die manuellen Endpunkte leeren und automatisch ermitteln lassen.'));
          return;
        }
        consumed = true;
        if (url.searchParams.has('error')) {
          response.writeHead(200); response.end('Die Anmeldung wurde nicht abgeschlossen. Zurück zu OpenVibeDesk.');
          const codes = url.searchParams.getAll('error');
          settle?.(new McpOAuthRequiredError(codes.length === 1 && Object.hasOwn(oauthErrorMessages, codes[0]) ? oauthErrorMessages[codes[0]] : 'Die MCP-Anmeldung wurde beim Anbieter abgebrochen oder abgelehnt.'));
          return;
        }
        const codes = url.searchParams.getAll('code'); if (codes.length !== 1 || !codes[0] || codes[0].length > 4096) { response.writeHead(400); response.end('Ungültige Anmeldung.'); settle?.(invalid()); return; }
        response.writeHead(200); response.end('Anmeldung empfangen. Du kannst zu OpenVibeDesk zurückkehren.'); settle?.(codes[0]);
      });
      this.listener.requestTimeout = 5000; this.listener.headersTimeout = 5000;
      await new Promise<void>((resolve, reject) => { this.listener!.once('error', () => reject(new McpOAuthRequiredError('Der lokale OAuth-Rückrufport ist belegt. Eine andere Anmeldung beenden oder den Rückrufport in den MCP-Einstellungen ändern.'))); this.listener!.listen(this.config.oauthRedirectPort ?? 43189, '127.0.0.1', resolve); });
      this.check(); const discovery = await this.discover(true);
      if (!this.config.oauthClientId && !this.credentials.client && !discovery.authorizationServerMetadata?.registration_endpoint) throw new McpOAuthRequiredError('Dieser OAuth-Anbieter registriert Apps nicht automatisch. In den erweiterten MCP-Einstellungen eine beim Anbieter registrierte Client-ID und den Issuer eintragen.');
      // A challenge is a required minimum, not a replacement for explicitly
      // configured scopes such as offline_access or this issuer's prior grants.
      const previousScope = this.credentials.tokens?.issuer && sameUrl(this.credentials.tokens.issuer, discovery.authorizationServerUrl) ? this.credentials.tokens.scope : undefined;
      const scopes = [...new Set([this.challengeScope, this.config.oauthScopes, previousScope].filter((value): value is string => !!value).flatMap(value => value.split(/\s+/).filter(Boolean)))];
      if (scopes.some(value => !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(value)) || scopes.join(' ').length > 2000) throw invalid();
      const scope = scopes.join(' ');
      await auth(this, { serverUrl: this.config.url!, ...(scope ? { scope } : {}), fetchFn: this.fetchOAuth });
      this.check(); if (!this.authorizationUrl) throw invalid(); await this.options.openExternal(this.authorizationUrl.href); this.check();
      const code = await callback; this.check();
      const clientInformation = await this.clientInformation(); if (!clientInformation) throw invalid();
      const selectedResource = await selectResourceURL(this.config.url!, this, discovery.resourceMetadata);
      const resource = selectedResource && discovery.resourceMetadata ? discovery.resourceMetadata.resource : selectedResource;
      const tokens = await exchangeAuthorization(discovery.authorizationServerUrl, { metadata: discovery.authorizationServerMetadata, clientInformation, authorizationCode: code, codeVerifier: await this.codeVerifier(), redirectUri: this.redirectUrl, resource, fetchFn: this.fetchOAuth });
      await this.saveTokens({ ...tokens, issuer: discovery.authorizationServerUrl });
    } catch (error) {
      if (error instanceof McpOAuthRequiredError || error instanceof DOMException && error.name === 'AbortError') throw error;
      this.check();
      // SDK OAuth errors can contain raw response bodies and provider-supplied
      // descriptions. Expose only a known code's fixed, credential-free message.
      if (error instanceof OAuthError && Object.hasOwn(oauthErrorMessages, error.errorCode)) throw new McpOAuthRequiredError(oauthErrorMessages[error.errorCode]);
      throw new McpOAuthRequiredError('Die MCP-Anmeldung ist fehlgeschlagen. OAuth-Client, Rückrufadresse und Freigabe beim Anbieter prüfen.');
    } finally {
      clearTimeout(timeout); this.signal.removeEventListener('abort', abort); this.interactive = false; this.verifier = undefined; this.stateValue = undefined; this.authorizationUrl = undefined; this.listener?.closeAllConnections(); this.listener?.close(); this.listener = undefined;
    }
  }
  async accessToken(): Promise<string> {
    await this.load(); this.check();
    if (this.refreshing) return this.refreshing;
    if (this.interactive || this.credentials.refreshPending || !this.credentials.tokens) throw new McpOAuthRequiredError();
    const issuer = this.credentials.tokens.issuer!;
    if (!this.credentials.client?.issuer || !sameUrl(this.credentials.client.issuer, issuer) || this.config.oauthIssuer && !sameUrl(this.config.oauthIssuer, issuer) || this.credentials.discovery && !sameUrl(this.credentials.discovery.authorizationServerUrl, issuer)) throw invalid();
    if (this.credentials.expiresAt === undefined || this.credentials.expiresAt > Date.now() + 30_000) return this.credentials.tokens.access_token;
    if (!this.credentials.tokens.refresh_token) throw new McpOAuthRequiredError('Die MCP-Anmeldung ist abgelaufen. Bitte erneut anmelden.');
    this.refreshing = (async () => {
      const previous = this.credentials.tokens!;
      const discovery = await this.discover(false), clientInformation = await this.clientInformation();
      if (!clientInformation || !sameUrl(previous.issuer!, discovery.authorizationServerUrl) || !sameUrl(clientInformation.issuer!, discovery.authorizationServerUrl)) throw invalid();
      const selectedResource = await selectResourceURL(this.config.url!, this, discovery.resourceMetadata);
      const resource = selectedResource && discovery.resourceMetadata ? discovery.resourceMetadata.resource : selectedResource;
      // Persist intent before exchanging a rotating token. An ambiguous response
      // requires a fresh sign-in rather than replaying a possibly consumed token.
      await this.persist({ ...this.credentials, refreshPending: true });
      try {
        const tokens = await refreshAuthorization(discovery.authorizationServerUrl, { metadata: discovery.authorizationServerMetadata, clientInformation, refreshToken: previous.refresh_token!, resource, fetchFn: this.fetchOAuth });
        await this.saveTokens({ ...tokens, issuer: discovery.authorizationServerUrl }); return this.credentials.tokens!.access_token;
      } catch { this.check(); throw new McpOAuthRequiredError('Die MCP-Anmeldung konnte nicht zuverlässig erneuert werden. Bitte erneut anmelden.'); }
    })();
    try { return await this.refreshing; } finally { this.refreshing = undefined; }
  }
  dispose(): void { this.lifetime.abort(); this.listener?.closeAllConnections(); this.listener?.close(); }
}

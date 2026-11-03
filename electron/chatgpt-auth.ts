import { AsyncEntry } from '@napi-rs/keyring';
import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ChatGptLoginOptions, ChatGptStatus } from '../shared/chatgpt';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const PLAN_SCOPE = 'chatgpt.tokens.use.direct';
const clientIdSchema = z.string().regex(/^oaiapp_[a-zA-Z0-9_-]{1,180}$/);
const label = z.string().min(1).max(300).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const profileSchema = z.object({
  id: z.string().uuid(), clientId: clientIdSchema, label,
  issuer: z.literal(ISSUER).optional(), subject: z.string().min(1).max(500).optional(),
  email: label.optional(), credentialKey: z.string().uuid().optional(), refreshPending: z.literal(true).optional()
}).strict();
const registrySchema = z.object({ version: z.literal(1), hostId: z.string().regex(/^urn:uuid:[a-f0-9-]{36}$/), activeProfileId: z.string().uuid().optional(), profiles: z.array(profileSchema).max(20) }).strict();
type Profile = z.infer<typeof profileSchema>;
type Registry = z.infer<typeof registrySchema>;
const credentialSchema = z.object({
  clientId: clientIdSchema, issuer: z.literal(ISSUER), subject: z.string().min(1).max(500),
  accessToken: z.string().min(1).max(32768), refreshToken: z.string().min(1).max(32768).optional(),
  idToken: z.string().min(1).max(32768), scopes: z.array(z.string().min(1).max(200)).max(50),
  expiresAt: z.number().finite().positive(), earliestRefreshAt: z.number().finite().nonnegative().optional()
}).strict();
type Credentials = z.infer<typeof credentialSchema>;
type Discovery = { jwksUri: string; revocationEndpoint: string };
type Identity = { subject: string; email?: string; name?: string };
type Pending = {
  state: string; nonce: string; verifier: string; redirectUri: string; server: Server;
  controller: AbortController; timer: ReturnType<typeof setTimeout>; profile?: Profile;
  consumed: boolean; generation: number;
};
type JsonRecord = Record<string, unknown>;
const object = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const randomValue = (size = 32) => randomBytes(size).toString('base64url');
const same = (left: string, right: string) => { const a = Buffer.from(left), b = Buffer.from(right); return a.byteLength === b.byteLength && timingSafeEqual(a, b); };
const text = (value: unknown, max = 300) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
const terminalRefreshCodes = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);
export class ChatGptAuthError extends Error { readonly name = 'ChatGptAuthError'; }
class AuthFailure extends ChatGptAuthError { constructor(message: string, readonly code?: string, readonly status?: number) { super(message); } }

export interface ChatGptSecrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface ChatGptAuthOptions {
  dataDirectory: string;
  openExternal(url: string): Promise<void>;
  changed?(status: ChatGptStatus): void;
  /** Dependency injection for isolated checks; production origins remain fixed. */
  fetch?: typeof fetch;
  secrets?: ChatGptSecrets;
  now?: () => number;
}

/** Direct public-client OAuth. No subprocess, runtime, or another app's credentials. */
export class ChatGptAuthService {
  private registry?: Registry;
  private initialization?: Promise<void>;
  private readonly fetcher: typeof fetch;
  private readonly secrets: ChatGptSecrets;
  private readonly lifetime = new AbortController();
  private readonly refreshes = new Map<string, Promise<Credentials>>();
  private readonly blocked = new Set<string>();
  private readonly disconnecting = new Set<string>();
  private writes: Promise<unknown> = Promise.resolve();
  private pending?: Pending;
  private starting = false;
  private loginEpoch = 0;
  private generation = 0;
  private error?: string;
  private discovery?: { value: Discovery; expiresAt: number };
  private keys?: { values: JsonRecord[]; expiresAt: number };

  constructor(private readonly options: ChatGptAuthOptions) {
    this.fetcher = options.fetch ?? fetch;
    const prefix = createHash('sha256').update(path.resolve(options.dataDirectory)).digest('hex');
    const entry = (key: string) => new AsyncEntry('OpenVibeDesk ChatGPT', `${prefix}:${key}`, { linux: { store: 'secret-service' } });
    this.secrets = options.secrets ?? {
      async get(key) { try { return await entry(key).getPassword(); } catch { throw new ChatGptAuthError('Der sichere ChatGPT-Zugangsdaten-Speicher ist nicht verfügbar.'); } },
      async set(key, value) { try { await entry(key).setPassword(value); } catch { throw new ChatGptAuthError('Die ChatGPT-Anmeldung konnte nicht sicher gespeichert werden.'); } },
      async delete(key) { try { await entry(key).deletePassword(); } catch { throw new ChatGptAuthError('Die gespeicherte ChatGPT-Anmeldung konnte nicht entfernt werden.'); } }
    };
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  private async initialize(): Promise<void> {
    if (this.registry) return;
    if (!this.initialization) this.initialization = (async () => {
      this.lifetime.signal.throwIfAborted();
      await fs.mkdir(this.options.dataDirectory, { recursive: true, mode: 0o700 });
      const file = path.join(this.options.dataDirectory, 'accounts.json');
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new ChatGptAuthError('invalid registry');
        const registry = registrySchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
        if (new Set(registry.profiles.map(profile => profile.id)).size !== registry.profiles.length || new Set(registry.profiles.map(profile => profile.clientId)).size !== registry.profiles.length || registry.activeProfileId && !registry.profiles.some(profile => profile.id === registry.activeProfileId)) throw new ChatGptAuthError('invalid registry');
        this.registry = registry;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ChatGptAuthError('Die gespeicherten ChatGPT-Konten sind nicht lesbar. Die vorhandene Datei wurde nicht überschrieben.');
        await this.persist({ version: 1, hostId: `urn:uuid:${randomUUID()}`, profiles: [] });
      }
    })();
    await this.initialization;
  }
  private async persist(registry: Registry): Promise<void> {
    const next = registrySchema.parse(registry), file = path.join(this.options.dataDirectory, 'accounts.json');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(next, null, 2)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, file);
      this.registry = next;
    } catch { throw new ChatGptAuthError('Die ChatGPT-Kontoeinstellungen konnten nicht gespeichert werden.'); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  private serialized<T>(run: () => Promise<T>): Promise<T> {
    const next = this.writes.then(run); this.writes = next.catch(() => {}); return next;
  }
  private async emit(): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    try { this.options.changed?.(await this.publicStatus()); } catch { /* A closed window never undoes completed storage. */ }
  }
  private async credential(profile: Profile, includeUnavailable = false): Promise<Credentials | undefined> {
    if (!profile.credentialKey || !includeUnavailable && (this.blocked.has(profile.id) || this.disconnecting.has(profile.id) || profile.refreshPending && !this.refreshes.has(profile.id))) return;
    const raw = await this.secrets.get(profile.credentialKey);
    if (!raw) return;
    let credential: Credentials;
    try { credential = credentialSchema.parse(JSON.parse(raw)); } catch { throw new ChatGptAuthError('Die gespeicherte ChatGPT-Anmeldung ist nicht lesbar. Bitte erneut anmelden.'); }
    if (credential.clientId !== profile.clientId || credential.subject !== profile.subject || credential.issuer !== profile.issuer) throw new ChatGptAuthError('Die gespeicherte ChatGPT-Anmeldung passt nicht zum ausgewählten Konto.');
    return credential;
  }
  private async publicStatus(): Promise<ChatGptStatus> {
    const profiles = await Promise.all((this.registry?.profiles ?? []).map(async profile => {
      const credentials = await this.credential(profile);
      const authenticated = !!credentials && (credentials.expiresAt > this.now() || !!credentials.refreshToken);
      return { id: profile.id, label: profile.label, authenticated, planAccess: authenticated && credentials!.scopes.includes(PLAN_SCOPE) };
    }));
    const active = profiles.find(profile => profile.id === this.registry?.activeProfileId);
    return { authenticated: active?.authenticated ?? false, loginPending: this.starting || !!this.pending, planAccess: active?.planAccess ?? false,
      profiles, ...(active ? { activeProfileId: active.id, accountLabel: active.label } : {}), ...(this.error ? { error: this.error } : {}) };
  }
  async status(): Promise<ChatGptStatus> {
    try { await this.initialize(); return await this.publicStatus(); }
    catch (error) { return { authenticated: false, loginPending: !!this.pending, planAccess: false, profiles: [], error: error instanceof Error ? error.message : 'Die ChatGPT-Anmeldung ist nicht verfügbar.' }; }
  }
  private async json(response: Response, limit = 1_000_000): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw new AuthFailure('OpenAI hat keine lesbare Anmeldeantwort geliefert.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) throw new AuthFailure('Die OpenAI-Anmeldeantwort ist zu groß.'); chunks.push(next.value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if (error instanceof AuthFailure) throw error; throw new AuthFailure('OpenAI hat keine gültige Anmeldeantwort geliefert.'); }
    finally { await reader.cancel().catch(() => {}); }
  }
  private async request(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const combined = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
    try { return await this.fetcher(url, { ...init, redirect: 'error', signal: combined }); }
    catch { signal?.throwIfAborted(); this.lifetime.signal.throwIfAborted(); throw new AuthFailure('Die Verbindung zur ChatGPT-Anmeldung ist fehlgeschlagen. Bitte später erneut versuchen.'); }
  }
  private trustedAuthUrl(raw: unknown): string {
    if (typeof raw !== 'string') throw new AuthFailure('Die OpenAI-Anmeldekonfiguration ist ungültig.');
    const url = new URL(raw);
    if (url.origin !== ISSUER || url.username || url.password || url.search || url.hash) throw new AuthFailure('Die OpenAI-Anmeldekonfiguration ist ungültig.');
    return url.toString();
  }
  private async discover(signal?: AbortSignal): Promise<Discovery> {
    if (this.discovery && this.discovery.expiresAt > this.now()) return this.discovery.value;
    const response = await this.request(`${ISSUER}/.well-known/openid-configuration`, {}, signal);
    if (!response.ok) throw new AuthFailure(`Die OpenAI-Anmeldekonfiguration konnte nicht geladen werden (HTTP ${response.status}).`);
    const body = object(await this.json(response));
    if (body.issuer !== ISSUER || body.authorization_endpoint !== AUTHORIZE || body.token_endpoint !== TOKEN_ENDPOINT || !Array.isArray(body.id_token_signing_alg_values_supported) || !body.id_token_signing_alg_values_supported.includes('RS256')) throw new AuthFailure('Die OpenAI-Anmeldekonfiguration wird nicht unterstützt.');
    const value = { jwksUri: this.trustedAuthUrl(body.jwks_uri), revocationEndpoint: this.trustedAuthUrl(body.revocation_endpoint) };
    this.discovery = { value, expiresAt: this.now() + 3600_000 }; return value;
  }
  private async signingKeys(signal?: AbortSignal, force = false): Promise<JsonRecord[]> {
    if (!force && this.keys && this.keys.expiresAt > this.now()) return this.keys.values;
    const discovery = await this.discover(signal), response = await this.request(discovery.jwksUri, {}, signal);
    if (!response.ok) throw new AuthFailure(`Der ChatGPT-Identitätsnachweis konnte nicht geprüft werden (HTTP ${response.status}).`);
    const raw = object(await this.json(response));
    if (!Array.isArray(raw.keys) || raw.keys.length > 100) throw new AuthFailure('Der ChatGPT-Identitätsnachweis konnte nicht geprüft werden.');
    const values = raw.keys.map(object); this.keys = { values, expiresAt: this.now() + 3600_000 }; return values;
  }
  private async identity(idToken: string, clientId: string, nonce: string | undefined, accessToken: string, signal?: AbortSignal): Promise<Identity> {
    const parts = idToken.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[a-zA-Z0-9_-]+$/.test(part))) throw new AuthFailure('Der ChatGPT-Identitätsnachweis ist ungültig.');
    let header: JsonRecord, claims: JsonRecord;
    try { header = object(JSON.parse(Buffer.from(parts[0], 'base64url').toString())); claims = object(JSON.parse(Buffer.from(parts[1], 'base64url').toString())); } catch { throw new AuthFailure('Der ChatGPT-Identitätsnachweis ist ungültig.'); }
    if (header.alg !== 'RS256' || !text(header.kid, 200) || header.crit !== undefined) throw new AuthFailure('Der ChatGPT-Identitätsnachweis wird nicht unterstützt.');
    let keys = await this.signingKeys(signal);
    const matching = (values: JsonRecord[]) => values.filter(key => key.kid === header.kid && key.kty === 'RSA' && (key.alg === undefined || key.alg === 'RS256') && (key.use === undefined || key.use === 'sig'));
    if (!matching(keys).length) keys = await this.signingKeys(signal, true);
    const matches = matching(keys);
    let valid = false;
    if (matches.length === 1) try { valid = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: matches[0] as JsonWebKey, format: 'jwk' }), Buffer.from(parts[2], 'base64url')); } catch { /* Unsupported or malformed key. */ }
    const now = this.now() / 1000, audience = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
    if (!valid || claims.iss !== ISSUER || !Array.isArray(audience) || !audience.every(item => typeof item === 'string') || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId) || (claims.azp !== undefined && claims.azp !== clientId) || !text(claims.sub, 500) || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= now - 5 || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now + 5 || claims.exp <= claims.iat || (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 5)) || (nonce !== undefined && claims.nonce !== nonce)) throw new AuthFailure('Der ChatGPT-Identitätsnachweis konnte nicht verifiziert werden. Bitte erneut anmelden.');
    if (claims.at_hash !== undefined && claims.at_hash !== createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url')) throw new AuthFailure('Die ChatGPT-Zugangsdaten passen nicht zum Identitätsnachweis.');
    return { subject: claims.sub as string, ...(text(claims.email) ? { email: claims.email as string } : {}), ...(text(claims.name) ? { name: claims.name as string } : {}) };
  }
  private async tokens(form: URLSearchParams, signal?: AbortSignal): Promise<JsonRecord> {
    const response = await this.request(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form }, signal);
    let body: JsonRecord;
    try { body = object(await this.json(response)); }
    catch (error) { if (!response.ok) throw new AuthFailure(`Die ChatGPT-Anmeldung wurde abgelehnt (HTTP ${response.status}).`, undefined, response.status); throw error; }
    if (!response.ok) {
      const code = typeof body.error === 'string' ? body.error : text(object(body.error).code, 80);
      throw new AuthFailure(response.status === 400 && code === 'invalid_grant' ? 'Die ChatGPT-Anmeldung ist abgelaufen. Bitte erneut anmelden.' : `Die ChatGPT-Anmeldung wurde abgelehnt (HTTP ${response.status}).`, code && (terminalRefreshCodes.has(code) || code === 'invalid_client') ? code : undefined, response.status);
    }
    return body;
  }
  private parsedTokens(body: JsonRecord, clientId: string, identity: Identity, previous?: Credentials): Credentials {
    const scopes = body.scope === undefined && previous ? previous.scopes : typeof body.scope === 'string' ? [...new Set(body.scope.split(/\s+/).filter(Boolean))] : [];
    if (body.token_type !== 'Bearer' && body.token_type !== 'bearer' || !text(body.access_token, 32768) || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 86400 || body.refresh_token !== undefined && !text(body.refresh_token, 32768)) throw new AuthFailure('OpenAI hat keine gültigen ChatGPT-Zugangsdaten geliefert.');
    const earliest = typeof body.earliest_refresh_at === 'number' && Number.isFinite(body.earliest_refresh_at) && body.earliest_refresh_at >= 0 ? body.earliest_refresh_at * (body.earliest_refresh_at < 1e12 ? 1000 : 1) : undefined;
    try { return credentialSchema.parse({ clientId, issuer: ISSUER, subject: identity.subject, accessToken: body.access_token, refreshToken: body.refresh_token ?? previous?.refreshToken, idToken: body.id_token ?? previous?.idToken, scopes, expiresAt: this.now() + body.expires_in * 1000, ...(earliest !== undefined ? { earliestRefreshAt: earliest } : {}) }); }
    catch { throw new AuthFailure('OpenAI hat keine gültigen ChatGPT-Zugangsdaten geliefert.'); }
  }
  private current(pending: Pending): void {
    pending.controller.signal.throwIfAborted();
    if (this.pending !== pending || pending.generation !== this.generation) throw new DOMException('Anmeldung abgebrochen.', 'AbortError');
  }
  private reply(response: ServerResponse, success: boolean): void {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(success ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Frame-Options': 'DENY' });
    response.end(`<!doctype html><html lang="de"><meta charset="utf-8"><title>OpenVibeDesk</title><body><h1>${success ? 'Anmeldung abgeschlossen' : 'Anmeldung nicht abgeschlossen'}</h1><p>${success ? 'Du kannst dieses Fenster schließen und zu OpenVibeDesk zurückkehren.' : 'Kehre zu OpenVibeDesk zurück und starte die Anmeldung bei Bedarf erneut.'}</p></body></html>`);
  }
  private closePending(pending: Pending): void { clearTimeout(pending.timer); pending.server.close(); if (this.pending === pending) this.pending = undefined; }
  private async callback(pending: Pending, requestUrl: string, response: ServerResponse): Promise<void> {
    try {
      this.current(pending);
      if (pending.consumed || requestUrl.length > 8192) throw new AuthFailure('Die ChatGPT-Anmeldeantwort wurde bereits verwendet oder ist ungültig.');
      const url = new URL(requestUrl, pending.redirectUri);
      for (const key of ['state', 'code', 'client_id', 'error']) if (url.searchParams.getAll(key).length > 1) throw new AuthFailure('Die ChatGPT-Anmeldeantwort ist nicht eindeutig.');
      const state = url.searchParams.get('state');
      if (!state || !same(state, pending.state)) throw new AuthFailure('Die ChatGPT-Anmeldeantwort konnte nicht zugeordnet werden. Bitte erneut anmelden.');
      pending.consumed = true;
      if (url.searchParams.has('error')) throw new AuthFailure(url.searchParams.get('error') === 'access_denied' ? 'Die ChatGPT-Anmeldung wurde im Browser abgebrochen oder nicht freigegeben.' : 'Die ChatGPT-Anmeldung wurde im Browser nicht abgeschlossen.');
      const code = text(url.searchParams.get('code'), 4096), issued = url.searchParams.get('client_id');
      if (!code) throw new AuthFailure('OpenAI hat keinen gültigen Anmeldecode geliefert.');
      const clientId = pending.profile?.clientId ?? clientIdSchema.safeParse(issued).data;
      if (!clientId || issued && issued !== clientId) throw new AuthFailure('Die ChatGPT-Clientregistrierung wurde nicht vollständig oder widersprüchlich geliefert.');
      let profile = pending.profile;
      // Registration survives a short-lived code failure, without activating an unverified identity.
      if (!profile) profile = await this.serialized(async () => {
        this.current(pending);
        if (this.registry!.profiles.some(item => item.clientId === clientId) || this.registry!.profiles.length >= 20) throw new AuthFailure('Diese ChatGPT-Registrierung ist bereits vorhanden oder die Kontoliste ist voll.');
        const candidate: Profile = { id: randomUUID(), clientId, label: `ChatGPT · ${this.registry!.profiles.length + 1}` };
        await this.persist({ ...this.registry!, profiles: [...this.registry!.profiles, candidate] });
        pending.profile = candidate; return candidate;
      });
      this.current(pending);
      const body = await this.tokens(new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE }), pending.controller.signal);
      if (!text(body.id_token, 32768) || !text(body.access_token, 32768)) throw new AuthFailure('OpenAI hat keinen verifizierbaren Identitätsnachweis geliefert.');
      const identity = await this.identity(body.id_token as string, clientId, pending.nonce, body.access_token as string, pending.controller.signal);
      if (profile.subject && (profile.subject !== identity.subject || profile.issuer !== ISSUER)) throw new AuthFailure('Die Anmeldung gehört nicht zum ausgewählten ChatGPT-Konto. Das bisherige Konto bleibt erhalten.');
      const credentials = this.parsedTokens(body, clientId, identity);
      await this.serialized(async () => {
        this.current(pending);
        const key = randomUUID(), oldKey = profile!.credentialKey;
        await this.secrets.set(key, JSON.stringify(credentials));
        try {
          this.current(pending);
          const { refreshPending: _pendingRefresh, ...prior } = profile!;
          const updated: Profile = { ...prior, issuer: ISSUER, subject: identity.subject, ...(identity.email ? { email: identity.email } : {}), label: `${identity.email || identity.name || 'ChatGPT'} · ${profile!.id.slice(0, 6)}`, credentialKey: key };
          await this.persist({ ...this.registry!, activeProfileId: updated.id, profiles: this.registry!.profiles.map(item => item.id === updated.id ? updated : item) });
        } catch (error) { await this.secrets.delete(key).catch(() => {}); throw error; }
        this.blocked.delete(profile!.id); this.generation++;
        this.error = credentials.scopes.includes(PLAN_SCOPE) ? undefined : 'Mit ChatGPT angemeldet; die Nutzung des ChatGPT-Kontingents wurde nicht freigegeben.';
        if (oldKey) await this.secrets.delete(oldKey).catch(() => { this.error = 'Die vorherigen ChatGPT-Zugangsdaten konnten nicht vollständig entfernt werden.'; });
      });
      this.reply(response, true);
    } catch (error) {
      if (this.pending === pending) this.error = error instanceof ChatGptAuthError ? error.message : 'Die ChatGPT-Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.';
      this.reply(response, false);
    } finally { this.closePending(pending); await this.emit(); }
  }
  async startLogin(options: ChatGptLoginOptions = {}): Promise<void> {
    this.lifetime.signal.throwIfAborted();
    if (this.starting) throw new ChatGptAuthError('Eine ChatGPT-Anmeldung wird bereits vorbereitet.');
    this.stopPending();
    const loginEpoch = ++this.loginEpoch;
    this.starting = true; this.error = undefined;
    const currentStart = () => { this.lifetime.signal.throwIfAborted(); if (loginEpoch !== this.loginEpoch) throw new DOMException('Anmeldung abgebrochen.', 'AbortError'); };
    let server: Server | undefined;
    try {
      await this.initialize(); currentStart(); await this.emit(); currentStart();
      const requested = options.newProfile ? undefined : options.profileId ?? this.registry!.activeProfileId ?? this.registry!.profiles.at(-1)?.id;
      const profile = requested ? this.registry!.profiles.find(item => item.id === requested) : undefined;
      if (requested && !profile) throw new ChatGptAuthError('Das ausgewählte ChatGPT-Konto ist nicht mehr vorhanden.');
      if (profile && this.disconnecting.has(profile.id)) throw new ChatGptAuthError('Dieses ChatGPT-Konto wird gerade abgemeldet. Bitte kurz warten.');
      if (!profile && this.registry!.profiles.length >= 20) throw new ChatGptAuthError('Es können höchstens 20 ChatGPT-Konten gespeichert werden.');
      const credentials = profile ? await this.credential(profile) : undefined;
      currentStart();
      const generation = this.generation, controller = new AbortController();
      let pending!: Pending;
      server = createServer((request, response) => {
        if (!pending || request.method !== 'GET' || request.headers.host !== new URL(pending.redirectUri).host || request.socket.remoteAddress !== '127.0.0.1' || !request.url?.startsWith('/auth/callback?')) { response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end(); return; }
        void this.callback(pending, request.url, response);
      });
      await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
      currentStart();
      const address = server.address(); if (!address || typeof address === 'string') { server.close(); throw new ChatGptAuthError('Der lokale ChatGPT-Anmeldeempfänger konnte nicht gestartet werden.'); }
      pending = { state: randomValue(), nonce: randomValue(), verifier: randomValue(64), redirectUri: `http://127.0.0.1:${address.port}/auth/callback`, server, controller, consumed: false, generation, ...(profile ? { profile } : {}), timer: setTimeout(() => { if (this.pending === pending) { this.error = 'Die ChatGPT-Anmeldung ist abgelaufen. Bitte erneut starten.'; void this.cancelLogin().then(() => this.emit()); } }, 10 * 60_000) };
      this.pending = pending;
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({ client_id: profile?.clientId ?? 'dynamic_agent_client', ext_agent_host_id: this.registry!.hostId, response_type: 'code', redirect_uri: pending.redirectUri, scope: SCOPE, resource: RESOURCE, state: pending.state, nonce: pending.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'), ...(!profile ? { agent_name_hint: 'OpenVibeDesk' } : {}), ...(credentials?.idToken ? { id_token_hint: credentials.idToken } : {}), ...(profile?.email ? { login_hint: profile.email } : {}), ...(options.consent ? { prompt: 'consent' } : {}) }).toString();
      currentStart(); await this.options.openExternal(url.toString()); currentStart();
    } catch (error) {
      if (loginEpoch === this.loginEpoch) { this.error = error instanceof ChatGptAuthError ? error.message : 'Die ChatGPT-Anmeldung konnte nicht gestartet werden. Prüfe Browser und lokalen Anmeldeempfänger.'; this.stopPending(); }
      server?.closeAllConnections(); server?.close();
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ChatGptAuthError(this.error || 'Die ChatGPT-Anmeldung konnte nicht gestartet werden.');
    } finally { if (loginEpoch === this.loginEpoch) this.starting = false; await this.emit(); }
  }
  private stopPending(): void {
    const pending = this.pending; this.pending = undefined;
    if (pending) { pending.controller.abort(); clearTimeout(pending.timer); pending.server.closeAllConnections(); pending.server.close(); }
  }
  async cancelLogin(): Promise<void> {
    this.loginEpoch++; this.starting = false; this.stopPending();
    await this.emit();
  }
  async selectProfile(id: string): Promise<void> {
    await this.initialize(); await this.cancelLogin();
    await this.serialized(async () => {
      if (!this.registry!.profiles.some(profile => profile.id === id)) throw new ChatGptAuthError('Das ausgewählte ChatGPT-Konto ist nicht mehr vorhanden.');
      if (this.disconnecting.has(id)) throw new ChatGptAuthError('Dieses ChatGPT-Konto wird gerade abgemeldet. Bitte kurz warten.');
      await this.persist({ ...this.registry!, activeProfileId: id }); this.generation++; this.error = undefined;
    });
    await this.emit();
  }
  private active(): Profile {
    const profile = this.registry?.profiles.find(item => item.id === this.registry!.activeProfileId);
    if (!profile) throw new ChatGptAuthError('Bitte zuerst mit ChatGPT anmelden.'); return profile;
  }
  private async clearCredential(profile: Profile): Promise<boolean> {
    return this.serialized(async () => {
      const current = this.registry!.profiles.find(item => item.id === profile.id);
      if (!current || current.credentialKey !== profile.credentialKey) return false;
      this.blocked.add(profile.id);
      let failure: unknown;
      if (profile.credentialKey) try { await this.secrets.delete(profile.credentialKey); } catch (error) { failure = error; }
      const { credentialKey: _key, refreshPending: _refresh, ...retained } = current;
      await this.persist({ ...this.registry!, profiles: this.registry!.profiles.map(item => item.id === profile.id ? retained : item) });
      if (failure) throw failure;
      return true;
    });
  }
  private refresh(profile: Profile, previous: Credentials): Promise<Credentials> {
    const existing = this.refreshes.get(profile.id); if (existing) return existing;
    const task = (async () => {
      if (!previous.refreshToken) throw new ChatGptAuthError('Die ChatGPT-Anmeldung ist abgelaufen. Bitte erneut anmelden.');
      // A persisted intent prevents an interrupted rotating-token exchange from
      // replaying an obsolete refresh token after restart.
      await this.serialized(async () => {
        const current = this.registry!.profiles.find(item => item.id === profile.id);
        if (!current || current.credentialKey !== profile.credentialKey || this.blocked.has(profile.id)) throw new DOMException('ChatGPT-Anmeldung wurde ersetzt.', 'AbortError');
        await this.persist({ ...this.registry!, profiles: this.registry!.profiles.map(item => item.id === profile.id ? { ...item, refreshPending: true } : item) });
      });
      try {
        const body = await this.tokens(new URLSearchParams({ grant_type: 'refresh_token', client_id: profile.clientId, refresh_token: previous.refreshToken, resource: RESOURCE }));
        let identity: Identity = { subject: previous.subject };
        if (body.id_token !== undefined) {
          if (!text(body.id_token, 32768) || !text(body.access_token, 32768)) throw new AuthFailure('OpenAI hat keinen gültigen erneuerten Identitätsnachweis geliefert.');
          identity = await this.identity(body.id_token as string, profile.clientId, undefined, body.access_token as string);
          if (identity.subject !== previous.subject) throw new AuthFailure('Die erneuerte ChatGPT-Anmeldung gehört zu einem anderen Konto.');
        }
        if (!text(body.refresh_token, 32768)) throw new AuthFailure('OpenAI hat keine erneuerbare ChatGPT-Anmeldung geliefert. Bitte erneut anmelden.');
        const credentials = this.parsedTokens(body, profile.clientId, identity, previous);
        await this.serialized(async () => {
          const current = this.registry!.profiles.find(item => item.id === profile.id);
          if (!current || current.credentialKey !== profile.credentialKey || this.blocked.has(profile.id)) throw new DOMException('ChatGPT-Anmeldung wurde ersetzt.', 'AbortError');
          try { await this.secrets.set(profile.credentialKey!, JSON.stringify(credentials)); }
          catch { throw new ChatGptAuthError('Die erneuerte ChatGPT-Anmeldung konnte nicht sicher gespeichert werden. Bitte erneut anmelden.'); }
          const { refreshPending: _intent, ...complete } = current;
          await this.persist({ ...this.registry!, profiles: this.registry!.profiles.map(item => item.id === profile.id ? complete : item) });
        });
        await this.emit(); return credentials;
      } catch (error) {
        if (error instanceof AuthFailure && error.code && terminalRefreshCodes.has(error.code)) {
          const cleared = await this.clearCredential(profile);
          const message = 'Die ChatGPT-Anmeldung ist nicht mehr gültig. Bitte erneut anmelden.';
          if (cleared && this.registry!.activeProfileId === profile.id) this.error = message;
          await this.emit(); throw new ChatGptAuthError(message);
        }
        const current = this.registry!.profiles.find(item => item.id === profile.id);
        if (current?.credentialKey === profile.credentialKey) {
          if (error instanceof AuthFailure && error.status) {
            // An explicit unsuccessful token response did not issue a replacement.
            await this.serialized(async () => {
              const latest = this.registry!.profiles.find(item => item.id === profile.id);
              if (!latest || latest.credentialKey !== profile.credentialKey) return;
              const { refreshPending: _intent, ...retained } = latest;
              await this.persist({ ...this.registry!, profiles: this.registry!.profiles.map(item => item.id === profile.id ? retained : item) });
            });
          } else {
            this.blocked.add(profile.id);
            if (this.registry!.activeProfileId === profile.id) this.error = 'Die ChatGPT-Anmeldung konnte nicht zuverlässig erneuert werden. Bitte erneut anmelden.';
          }
          await this.emit();
        }
        throw error;
      }
    })();
    this.refreshes.set(profile.id, task);
    void task.finally(() => this.refreshes.delete(profile.id)).catch(() => {});
    return task;
  }
  async accessToken(signal?: AbortSignal): Promise<string> {
    await this.initialize(); this.lifetime.signal.throwIfAborted(); signal?.throwIfAborted();
    const generation = this.generation, profile = this.active(); let credentials = await this.credential(profile);
    if (!credentials) throw new ChatGptAuthError('Bitte zuerst mit ChatGPT anmelden.');
    if (!credentials.scopes.includes(PLAN_SCOPE)) throw new ChatGptAuthError('Die Nutzung des ChatGPT-Kontingents wurde nicht freigegeben. Öffne die KI-Einstellungen und erteile die Freigabe.');
    if (credentials.refreshToken && credentials.expiresAt - this.now() < 60_000 && (!credentials.earliestRefreshAt || this.now() >= credentials.earliestRefreshAt)) credentials = await this.refresh(profile, credentials);
    signal?.throwIfAborted();
    if (generation !== this.generation || this.active().id !== profile.id || this.blocked.has(profile.id)) throw new DOMException('ChatGPT-Konto wurde gewechselt.', 'AbortError');
    if (credentials.expiresAt <= this.now()) throw new ChatGptAuthError('Die ChatGPT-Anmeldung muss erneuert werden. Bitte später erneut versuchen oder neu anmelden.');
    if (!credentials.scopes.includes(PLAN_SCOPE)) throw new ChatGptAuthError('Die Nutzung des ChatGPT-Kontingents ist nicht mehr freigegeben. Bitte die KI-Einstellungen öffnen.');
    return credentials.accessToken;
  }
  async listModels(): Promise<string[]> {
    const token = await this.accessToken(), response = await this.request(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!response.ok) throw new ChatGptAuthError(`Die ChatGPT-Modellliste konnte nicht geladen werden (HTTP ${response.status}). Prüfe Konto und Freigabe.`);
    const body = object(await this.json(response, 2_000_000));
    if (!Array.isArray(body.models) || body.models.length > 10000) throw new ChatGptAuthError('OpenAI hat keine gültige ChatGPT-Modellliste geliefert.');
    return [...new Set(body.models.flatMap(raw => { const model = object(raw); return model.visibility === 'list' && text(model.slug, 200) ? [model.slug as string] : []; }))];
  }
  async logout(): Promise<void> {
    await this.initialize(); await this.cancelLogin(); this.generation++;
    const selected = this.active(); this.disconnecting.add(selected.id); await this.emit();
    try {
      // An already-started rotation must commit before its replacement is revoked.
      await this.refreshes.get(selected.id)?.catch(() => {});
      const profile = this.registry!.profiles.find(item => item.id === selected.id)!;
      this.blocked.add(profile.id);
      const credentials = await this.credential(profile, true);
      let revoked = !credentials?.refreshToken;
      if (credentials?.refreshToken) {
        for (let attempt = 0; attempt < 2 && !revoked; attempt++) try {
          const discovery = await this.discover();
          const response = await this.request(discovery.revocationEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: credentials.refreshToken, token_type_hint: 'refresh_token', client_id: profile.clientId }) });
          revoked = response.status === 200; await response.body?.cancel().catch(() => {});
          if (response.status < 500) break;
          if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250));
        } catch { if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      await this.clearCredential(profile);
      this.error = revoked ? undefined : 'Lokal abgemeldet. Die Abmeldung bei OpenAI konnte nicht bestätigt werden; du kannst die Verbindung in den ChatGPT-Nutzungseinstellungen trennen.';
    } catch (error) {
      this.error = error instanceof ChatGptAuthError ? error.message : 'Die ChatGPT-Zugangsdaten konnten nicht vollständig entfernt werden.';
      throw new ChatGptAuthError(this.error);
    } finally { this.disconnecting.delete(selected.id); await this.emit(); }
  }
  dispose(): void {
    this.generation++; this.loginEpoch++; this.starting = false; this.lifetime.abort(); this.stopPending();
  }
}

let service: ChatGptAuthService | undefined;
export function initializeChatGptAuth(options: ChatGptAuthOptions): ChatGptAuthService { service?.dispose(); service = new ChatGptAuthService(options); return service; }
export function chatGptAuth(): ChatGptAuthService { if (!service) throw new ChatGptAuthError('Die ChatGPT-Anmeldung ist noch nicht bereit.'); return service; }

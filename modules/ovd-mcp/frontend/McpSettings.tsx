import { connectFailureText } from '../connection-feedback';
import { useUiLocale } from '../../../src/locale';
import { mcpText } from './mcp-locale';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, Cable, ExternalLink, LoaderCircle, LogOut, Plus, RefreshCw, Server, Trash2, Unplug, X } from 'lucide-react';
import { mcpServerInputSchema, type McpAuditEntry, type McpPrepareRequest, type McpServerInput, type McpServerSummary, type McpToolInfo, type McpToolPage } from '../../../shared/mcp';
import './mcp-settings.css';

type FormValues = { name: string; description: string; transport: 'stdio' | 'http'; command: string; args: string; cwd: string; url: string; autoConnect: boolean; token: string; clearToken: boolean; env: string; removeEnvKeys: string[]; authMode: 'none' | 'bearer' | 'oauth'; oauthClientId: string; oauthClientAuthMethod: 'auto' | 'client_secret_basic' | 'client_secret_post'; oauthIssuer: string; oauthAuthorizationUrl: string; oauthTokenUrl: string; oauthScopes: string; oauthRedirectPort: string; oauthClientSecret: string; clearOAuthClientSecret: boolean };
type FormStatus = 'clean' | 'dirty' | 'busy';
type ServerNotice = 'review' | 'serverSaved' | 'permissionsSaved' | 'discarded' | 'signInCancelled' | 'didDisconnect' | 'didConnect' | 'signedInConnected' | 'didSignIn' | 'didSignOut' | 'didReset';
type Prepared = { token: number; values: McpPrepareRequest['values'] };
const newKey = 'new-server';
const openStorageKey = 'openvibedesk.settings.mcpGroups';
const genericSearch = 'mcp server verbindung verbindungen stdio http werkzeuge tools integration token bearer oauth anmeldung anmelden abmelden browser pkce client id clientanmeldung basic post client_secret_basic client_secret_post issuer autorisierung autorisierungs authorization authentifizierung token endpoint endpunkt url scopes callback umgebung env argumente programm executable prozess verzeichnis cwd freigabe berechtigung zugriff protokoll audit starten verbinden trennen autostart connection credentials authentication approval permissions integration commands directory environment activity log';
const message = (reason: unknown) => {
  const text = reason instanceof Error ? reason.message : String(reason);
  return text.replace(/^Error invoking remote method (['"])mcp:[^'"]+\1:\s*(?:Error:\s*)?/, '');
};
const sameNames = (a: readonly string[], b: readonly string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const toForm = (server?: McpServerSummary): FormValues => ({ name: server?.name ?? '', description: server?.description ?? '', transport: server?.transport ?? 'stdio', command: server?.command ?? '', args: server?.args.join('\n') ?? '', cwd: server?.cwd ?? '', url: server?.url ?? '', autoConnect: server?.autoConnect ?? false, token: '', clearToken: false, env: '', removeEnvKeys: [], authMode: server?.authMode ?? (server?.hasToken ? 'bearer' : 'none'), oauthClientId: server?.oauthClientId ?? '', oauthClientAuthMethod: server?.oauthClientAuthMethod ?? 'auto', oauthIssuer: server?.oauthIssuer ?? '', oauthAuthorizationUrl: server?.oauthAuthorizationUrl ?? '', oauthTokenUrl: server?.oauthTokenUrl ?? '', oauthScopes: server?.oauthScopes ?? '', oauthRedirectPort: String(server?.oauthRedirectPort ?? 43189), oauthClientSecret: '', clearOAuthClientSecret: false });
function loadOpen(): Record<string, boolean> {
  try { const stored: unknown = JSON.parse(localStorage.getItem(openStorageKey) ?? '{}'); if (stored && typeof stored === 'object' && !Array.isArray(stored)) return Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'boolean')); } catch { /* Keep current groups in memory. */ }
  return {};
}
function matches(server: McpServerSummary | undefined, query: string): boolean {
  const text = `${genericSearch} ${server?.name ?? ''} ${server?.description ?? ''} ${server?.command ?? ''} ${server?.url ?? ''}`.toLocaleLowerCase('de-DE');
  return query.trim().toLocaleLowerCase('de-DE').split(/\s+/).filter(Boolean).every(term => text.includes(term));
}

export function McpSettings({ searchQuery = '' }: { searchQuery?: string }) {
  const copy = mcpText[useUiLocale()];
  const [servers, setServers] = useState<McpServerSummary[]>([]), [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false), [open, setOpen] = useState(loadOpen);
  const [statuses, setStatuses] = useState<Record<string, FormStatus>>({});
  const [pending, setPending] = useState<McpPrepareRequest>();
  const [prepared, setPrepared] = useState<{ target: string; request: Prepared }>();
  const prepareToken = useRef(0), refreshVersion = useRef(0);
  const serversRef = useRef(servers), statusesRef = useRef(statuses), readyRef = useRef(ready);
  serversRef.current = servers; statusesRef.current = statuses; readyRef.current = ready;
  const busy = Object.values(statuses).includes('busy'), dirty = Object.values(statuses).includes('dirty');
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try { const result = await window.workspace.mcpListServers(); if (version === refreshVersion.current) { setServers(result); setReady(true); setError(''); } }
    catch (reason) { if (version === refreshVersion.current) setError(message(reason)); }
  }, []);
  const statusChanged = useCallback((key: string, value?: FormStatus) => { setStatuses(previous => { if (previous[key] === value) return previous; const next = { ...previous }; if (value) next[key] = value; else delete next[key]; return next; }); }, []);
  const targetFor = (request: McpPrepareRequest) => serversRef.current.some(server => server.id === request.values.id) ? request.values.id! : newKey;
  const canPrepare = (request: McpPrepareRequest) => readyRef.current && (!statusesRef.current[targetFor(request)] || statusesRef.current[targetFor(request)] === 'clean');
  function applyPreparation(request: McpPrepareRequest) {
    const target = targetFor(request);
    if (target === newKey) setShowNew(true);
    setOpen(previous => ({ ...previous, [target]: true }));
    setPrepared({ target, request: { token: ++prepareToken.current, values: request.values } }); setPending(undefined);
  }
  useEffect(() => {
    void refresh();
    const unsubscribe = window.workspace.onMcpChanged(() => { void refresh(); });
    const unsubscribePrepare = window.workspace.onPrepareMcpServer(request => { if (!request?.values || typeof request.values !== 'object') return; if (canPrepare(request)) applyPreparation(request); else setPending(request); });
    return () => { refreshVersion.current++; unsubscribe(); unsubscribePrepare(); };
  }, [refresh]);
  useEffect(() => { if (ready && pending && canPrepare(pending)) applyPreparation(pending); }, [ready]);
  useEffect(() => { try { localStorage.setItem(openStorageKey, JSON.stringify(open)); } catch { /* Expanded groups remain usable in memory. */ } }, [open]);
  useLayoutEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.workspace.setMcpSettingsStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean');
    if (dirty || busy) window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [busy, dirty]);
  useEffect(() => () => { window.workspace.setMcpSettingsStatus('clean'); }, []);
  function saved(server: McpServerSummary, wasNew: boolean) {
    setServers(previous => previous.some(item => item.id === server.id) ? previous.map(item => item.id === server.id ? server : item) : [...previous, server]);
    if (wasNew) { setShowNew(false); setOpen(previous => ({ ...previous, [server.id]: true })); }
    void refresh();
  }
  return <div className="mcp-settings">
    <div className="mcp-intro"><button type="button" className="mcp-primary" disabled={showNew || busy} onClick={() => { setShowNew(true); setOpen(previous => ({ ...previous, [newKey]: true })); }}><Plus size={14}/>{copy.addServer}</button></div>
    {error && <p className="mcp-feedback error" role="alert">{error}<button type="button" onClick={() => void refresh()}>{copy.reload}</button></p>}
    {!ready && !error && <p className="mcp-note" role="status">{copy.loading}</p>}
    {pending && <div className="mcp-preparation" role="status"><strong>{copy.pendingSuggestion}</strong><p>{copy.keepEdits}</p><div><button type="button" disabled={!canPrepare(pending)} onClick={() => applyPreparation(pending)}>{copy.applySuggestion}</button><button type="button" onClick={() => setPending(undefined)}>{copy.close}</button></div></div>}
    {showNew && <ServerEditor editorKey={newKey} open={open[newKey] !== false} onToggle={value => setOpen(previous => ({ ...previous, [newKey]: value }))} onStatusChange={statusChanged} onSaved={value => saved(value, true)} onRefresh={refresh} onCancel={() => setShowNew(false)} prepared={prepared?.target === newKey ? prepared.request : undefined}/>}
    {servers.map(server => <ServerEditor key={server.id} server={server} editorKey={server.id} hidden={!!searchQuery.trim() && !matches(server, searchQuery)} open={!!searchQuery.trim() || !!open[server.id]} onToggle={value => { if (!searchQuery.trim()) setOpen(previous => ({ ...previous, [server.id]: value })); }} onStatusChange={statusChanged} onSaved={value => saved(value, false)} onRefresh={refresh} prepared={prepared?.target === server.id ? prepared.request : undefined}/>) }
    {ready && !servers.length && !showNew && <div className="mcp-empty"><Cable size={22} aria-hidden="true"/><strong>{copy.noServers}</strong><span>{copy.emptyHint}</span></div>}
    {ready && <AuditPanel/>}
  </div>;
}

function ServerEditor({ server, editorKey, open, hidden, onToggle, onStatusChange, onSaved, onRefresh, onCancel, prepared }: { server?: McpServerSummary; editorKey: string; open: boolean; hidden?: boolean; onToggle(value: boolean): void; onStatusChange(key: string, status?: FormStatus): void; onSaved(server: McpServerSummary): void; onRefresh(): Promise<void>; onCancel?(): void; prepared?: Prepared }) {
  const locale = useUiLocale();
  const copy = mcpText[locale];
  const [values, setValues] = useState(() => toForm(server)), [baseline, setBaseline] = useState(() => toForm(server));
  const [allowed, setAllowed] = useState<string[]>(server?.allowedTools ?? []), [allowedBaseline, setAllowedBaseline] = useState<string[]>(server?.allowedTools ?? []);
  const [toolsPage, setToolsPage] = useState<McpToolPage>(), [toolsLoading, setToolsLoading] = useState(false), [toolsError, setToolsError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState<ServerNotice | ''>('');
  const [cancellingSignIn, setCancellingSignIn] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsVersion = useRef(0), preparationToken = useRef<number | undefined>(undefined);
  const configDirty = JSON.stringify(values) !== JSON.stringify(baseline), permissionsDirty = !sameNames(allowed, allowedBaseline), dirty = configDirty || permissionsDirty;
  const serverKey = JSON.stringify(toForm(server)), allowedKey = JSON.stringify(server?.allowedTools ?? []);
  const connected = server?.status === 'connected', connecting = server?.status === 'connecting';
  const signingIn = server?.oauthStatus === 'signing_in';
  const status = busy || signingIn ? 'busy' : dirty ? 'dirty' : 'clean';
  useLayoutEffect(() => { onStatusChange(editorKey, status); }, [editorKey, status, onStatusChange]);
  useEffect(() => () => { onStatusChange(editorKey, undefined); toolsVersion.current++; }, [editorKey, onStatusChange]);
  useEffect(() => { if (!configDirty && !busy) { const next = toForm(server); setValues(next); setBaseline(next); } }, [serverKey]);
  useEffect(() => { if (!permissionsDirty && !busy) { setAllowed(server?.allowedTools ?? []); setAllowedBaseline(server?.allowedTools ?? []); } }, [allowedKey]);
  useEffect(() => {
    if (!prepared || prepared.token === preparationToken.current) return;
    preparationToken.current = prepared.token;
    if (dirty || busy || signingIn) return;
    const incoming = prepared.values;
    setValues(previous => ({ ...previous, ...(typeof incoming.name === 'string' ? { name: incoming.name.slice(0, 100) } : {}), ...(typeof incoming.description === 'string' ? { description: incoming.description.slice(0, 500) } : {}), ...(incoming.transport === 'stdio' || incoming.transport === 'http' ? { transport: incoming.transport } : {}), ...(typeof incoming.command === 'string' ? { command: incoming.command.slice(0, 4096) } : {}), ...(Array.isArray(incoming.args) && incoming.args.every(value => typeof value === 'string') ? { args: incoming.args.slice(0, 100).map(value => value.slice(0, 4096)).join('\n') } : {}), ...(typeof incoming.cwd === 'string' ? { cwd: incoming.cwd.slice(0, 4096) } : {}), ...(typeof incoming.url === 'string' ? { url: incoming.url.slice(0, 2048) } : {}), ...(['none', 'bearer', 'oauth'].includes(incoming.authMode ?? '') ? { authMode: incoming.authMode! } : {}), ...(typeof incoming.oauthClientId === 'string' ? { oauthClientId: incoming.oauthClientId.slice(0, 2048) } : {}), ...(['auto', 'client_secret_basic', 'client_secret_post'].includes(incoming.oauthClientAuthMethod ?? '') ? { oauthClientAuthMethod: incoming.oauthClientAuthMethod! } : {}), ...(typeof incoming.oauthIssuer === 'string' ? { oauthIssuer: incoming.oauthIssuer.slice(0, 2048) } : {}), ...(typeof incoming.oauthAuthorizationUrl === 'string' ? { oauthAuthorizationUrl: incoming.oauthAuthorizationUrl.slice(0, 2048) } : {}), ...(typeof incoming.oauthTokenUrl === 'string' ? { oauthTokenUrl: incoming.oauthTokenUrl.slice(0, 2048) } : {}), ...(typeof incoming.oauthScopes === 'string' ? { oauthScopes: incoming.oauthScopes.slice(0, 2000) } : {}), ...(typeof incoming.oauthRedirectPort === 'number' ? { oauthRedirectPort: String(incoming.oauthRedirectPort) } : {}) }));
    if (server && Array.isArray(incoming.allowedTools) && incoming.allowedTools.every(value => typeof value === 'string')) { setAllowed([...new Set(incoming.allowedTools.filter(value => value.length > 0 && value.length <= 200))].slice(0, 500)); setToolsOpen(true); }
    setError(''); setNotice('review');
  }, [prepared]);
  async function loadTools(more = false, refresh = false) {
    if (!server || !connected || toolsLoading) return;
    const version = ++toolsVersion.current;
    setToolsLoading(true); setToolsError('');
    try {
      const page = await window.workspace.mcpListTools({ serverId: server.id, limit: 50, ...(refresh ? { refresh: true } : {}), ...(more && toolsPage?.nextOffset !== undefined ? { offset: toolsPage.nextOffset } : {}) });
      if (version === toolsVersion.current) setToolsPage(previous => more && previous ? { ...page, tools: [...new Map([...previous.tools, ...page.tools].map(tool => [tool.name, tool])).values()] } : page);
    } catch (reason) { if (version === toolsVersion.current) setToolsError(message(reason)); }
    finally { if (version === toolsVersion.current) setToolsLoading(false); }
  }
  useEffect(() => { if (connected) { setToolsOpen(true); void loadTools(); } else { toolsVersion.current++; setToolsLoading(false); } }, [server?.status, server?.connectedAt]);
  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) { setValues(previous => ({ ...previous, [key]: value })); setError(''); setNotice(''); }
  async function action(work: () => Promise<void>, success?: ServerNotice) {
    if (busy || signingIn) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); if (success) setNotice(success); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }
  function input(): McpServerInput {
    if (!values.name.trim()) throw new Error(copy.missingName);
    if (values.transport === 'stdio' && !values.command.trim()) throw new Error(copy.missingCommand);
    if (values.transport === 'http' && !values.url.trim()) throw new Error(copy.missingUrl);
    let env: Record<string, string> | undefined;
    if (values.env.trim()) {
      let parsed: unknown;
      try { parsed = JSON.parse(values.env); } catch { throw new Error(copy.envJson); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== 'string')) throw new Error(copy.envStrings);
      env = parsed as Record<string, string>;
    }
    const args = values.args.split(/\r?\n/); while (args.at(-1) === '') args.pop();
    const value = { ...(server ? { id: server.id } : {}), name: values.name, description: values.description, transport: values.transport, autoConnect: values.autoConnect, allowedTools: server?.allowedTools ?? [], ...(values.transport === 'stdio' ? { command: values.command, args, ...(values.cwd.trim() ? { cwd: values.cwd.trim() } : {}), ...(env ? { env } : {}), ...(values.removeEnvKeys.length ? { removeEnvKeys: values.removeEnvKeys } : {}) } : { url: values.url, authMode: values.authMode, ...(values.authMode === 'bearer' ? { ...(values.token ? { token: values.token } : {}), ...(values.clearToken ? { clearToken: true } : {}) } : {}), ...(values.authMode === 'oauth' ? { oauthRedirectPort: Number(values.oauthRedirectPort), oauthClientId: values.oauthClientId.trim(), oauthClientAuthMethod: values.oauthClientAuthMethod, oauthIssuer: values.oauthIssuer.trim(), oauthAuthorizationUrl: values.oauthAuthorizationUrl.trim(), oauthTokenUrl: values.oauthTokenUrl.trim(), oauthScopes: values.oauthScopes.trim(), ...(values.oauthClientSecret ? { oauthClientSecret: values.oauthClientSecret } : {}), ...(values.clearOAuthClientSecret ? { clearOAuthClientSecret: true } : {}) } : {}) }) };
    const parsed = mcpServerInputSchema.safeParse(value);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || copy.invalidSettings);
    return parsed.data;
  }
  async function save() {
    let request: McpServerInput;
    try { request = input(); } catch (reason) { setError(message(reason)); return; }
    await action(async () => { const saved = await window.workspace.mcpSaveServer(request); const next = toForm(saved); setValues(next); setBaseline(next); if (!permissionsDirty) setAllowed(saved.allowedTools); setAllowedBaseline(saved.allowedTools); onSaved(saved); }, 'serverSaved');
  }
  async function savePermissions() {
    if (!server) return;
    await action(async () => { const saved = await window.workspace.mcpSetToolPermissions({ serverId: server.id, allowedTools: allowed }); setAllowed(saved.allowedTools); setAllowedBaseline(saved.allowedTools); onSaved(saved); }, 'permissionsSaved');
  }
  function discard() { setValues({ ...baseline, token: '', env: '', clearToken: false, removeEnvKeys: [], oauthClientSecret: '', clearOAuthClientSecret: false }); setAllowed(allowedBaseline); setError(''); setNotice('discarded'); }
  async function cancelSignIn() {
    if (!server || cancellingSignIn) return;
    setCancellingSignIn(true);
    try { await window.workspace.mcpCancelSignIn(server.id); await onRefresh(); setNotice('signInCancelled'); }
    catch (reason) { setError(message(reason)); }
    finally { setCancellingSignIn(false); }
  }
  function changeAllowed(update: (previous: string[]) => string[]) { setAllowed(update); setError(''); setNotice(''); }
  const failure = server?.connectFailure;
  const serverError = failure ? connectFailureText[locale][failure] : server?.error;
  // A failed Connect is retained on the server card, including across language changes.
  const repeatedError = error === server?.error || !!failure && (error === connectFailureText.en[failure] || error === connectFailureText.de[failure]);
  const statusLabels = { disconnected: copy.disconnected, connecting: copy.connecting, connected: copy.connected, error: copy.connectionError };
  const oauthLabels = { signed_out: copy.signedOut, signing_in: copy.signingIn, signed_in: copy.signedIn, required: copy.signInRequired, error: copy.authError };
  const name = values.name || server?.name || copy.newServer;
  const statusCount = permissionsDirty ? copy.pendingCount(allowed.length) : copy.toolCount(server?.allowedToolCount ?? 0, server?.toolCount ?? 0);
  return <details className="mcp-server" hidden={hidden} open={open} onToggle={event => onToggle(event.currentTarget.open)}>
    <summary><Server size={17} aria-hidden="true"/><span><strong>{name}</strong><small>{server ? statusLabels[server.status] : copy.unsaved} · {values.transport === 'stdio' ? copy.localProcess : 'HTTP'}{dirty ? copy.dirty : server ? ` · ${statusCount}` : ''}</small></span><ChevronDown size={16} aria-hidden="true"/></summary>
    <div className="mcp-server-content">
      {server && <div className="mcp-connection-row"><span className={`mcp-status ${server.status}`}>{connected ? <CircleCheck size={13} aria-hidden="true"/> : server.status === 'error' ? <CircleAlert size={13} aria-hidden="true"/> : connecting ? <LoaderCircle size={13} aria-hidden="true"/> : <Unplug size={13} aria-hidden="true"/>}{statusLabels[server.status]}{server.protocolVersion && ` · MCP ${server.protocolVersion}`}</span><div>{connected || connecting ? <button type="button" disabled={busy || signingIn} onClick={() => void action(async () => { const result = await window.workspace.mcpDisconnectServer(server.id); await onRefresh(); if (result.status === 'connected' || result.status === 'connecting') throw new Error(result.error || copy.disconnectFailed); }, 'didDisconnect')}><Unplug size={13}/>{copy.disconnect}</button> : <button type="button" className="mcp-primary" disabled={busy || signingIn || configDirty} title={configDirty ? copy.saveFirst : undefined} onClick={() => void action(async () => { const result = await window.workspace.mcpConnectServer(server.id); await onRefresh(); if (result.status !== 'connected') throw new Error(result.error || copy.connectFailed); }, 'didConnect')}><Cable size={13}/>{copy.connect}</button>}</div></div>}
      {serverError && <p className="mcp-feedback error" role="alert">{serverError}</p>}
      <form noValidate onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || signingIn}>
        <label className="mcp-field"><span>{copy.name}</span><input aria-label={`${name}: ${copy.name}`} maxLength={100} value={values.name} placeholder={copy.namePlaceholder} onChange={event => update('name', event.target.value)}/></label>
        <label className="mcp-field"><span>{copy.description}</span><input aria-label={`${name}: ${copy.description}`} maxLength={500} value={values.description} placeholder={copy.descriptionPlaceholder} onChange={event => update('description', event.target.value)}/><small>{copy.descriptionHint}</small></label>
        <label className="mcp-field"><span>{copy.connection}</span><select aria-label={`${name}: ${copy.connectionType}`} value={values.transport} onChange={event => update('transport', event.target.value as 'stdio' | 'http')}><option value="stdio">{copy.stdio}</option><option value="http">{copy.http}</option></select></label>
        {values.transport === 'stdio' ? <>
          <label className="mcp-field"><span>{copy.program}</span><input aria-label={`${name}: ${copy.program}`} maxLength={4096} value={values.command} placeholder={copy.programPlaceholder} spellCheck={false} onChange={event => update('command', event.target.value)}/><small>{copy.programHint}</small></label>
          <label className="mcp-field"><span>{copy.arguments}</span><textarea aria-label={`${name}: ${copy.arguments}`} rows={3} maxLength={16000} value={values.args} placeholder={'-y\n@studio/mcp-server'} spellCheck={false} onChange={event => update('args', event.target.value)}/><small>{copy.argsHint}</small></label>
          <label className="mcp-field"><span>{copy.directory}</span><input aria-label={`${name}: ${copy.directory}`} maxLength={4096} value={values.cwd} placeholder={copy.directoryPlaceholder} spellCheck={false} onChange={event => update('cwd', event.target.value)}/></label>
          <details className="mcp-advanced"><summary>{copy.environment}{server?.envKeys.length ? ` · ${copy.envSavedCount(server.envKeys.length)}` : ''}<ChevronDown size={14} aria-hidden="true"/></summary><div>
            <label className="mcp-field"><span>{copy.addEnv}</span><textarea aria-label={`${name}: ${copy.envField}`} rows={3} maxLength={64000} autoComplete="off" value={values.env} placeholder={'{"API_KEY":"…"}'} spellCheck={false} onChange={event => update('env', event.target.value)}/><small>{copy.envHint}</small></label>
            {!!server?.envKeys.length && <div className="mcp-env-keys"><strong>{copy.removeEnv}</strong>{server.envKeys.map(key => <label key={key}><input type="checkbox" checked={values.removeEnvKeys.includes(key)} onChange={event => update('removeEnvKeys', event.target.checked ? [...values.removeEnvKeys, key] : values.removeEnvKeys.filter(value => value !== key))}/><code>{key}</code></label>)}</div>}
          </div></details>
        </> : <>
          <label className="mcp-field"><span>{copy.url}</span><input type="url" aria-label={`${name}: ${copy.url}`} maxLength={2048} value={values.url} placeholder="https://server.example/mcp" spellCheck={false} onChange={event => update('url', event.target.value)}/></label>
          <label className="mcp-field"><span>{copy.auth}</span><select aria-label={`${name}: ${copy.auth}`} value={values.authMode} onChange={event => update('authMode', event.target.value as FormValues['authMode'])}><option value="none">{copy.none}</option><option value="bearer">{copy.bearer}</option><option value="oauth">{copy.browserAuth}</option></select></label>
          {values.authMode === 'bearer' && <>
            <label className="mcp-field"><span>{copy.bearer} <small>{server?.hasToken ? copy.saved : copy.unsaved}</small></span><input type="password" aria-label={`${name}: ${copy.bearer}`} maxLength={8192} autoComplete="new-password" value={values.token} placeholder={server?.hasToken ? copy.keepToken : copy.enterToken} onChange={event => { update('token', event.target.value); if (event.target.value) update('clearToken', false); }}/></label>
            {server?.hasToken && <label className="mcp-checkbox"><input type="checkbox" checked={values.clearToken} disabled={!!values.token} onChange={event => update('clearToken', event.target.checked)}/><span>{copy.removeToken}</span></label>}
          </>}
          {values.authMode === 'oauth' && <details className="mcp-advanced"><summary>{copy.oauthSettings}<ChevronDown size={14} aria-hidden="true"/></summary><div>
            <p className="mcp-note">{copy.discovery}</p>
            <label className="mcp-field"><span>{copy.clientId}</span><input aria-label={`${name}: ${copy.oauthId}`} maxLength={2048} value={values.oauthClientId} placeholder={copy.registration} spellCheck={false} onChange={event => update('oauthClientId', event.target.value)}/></label>
            <label className="mcp-field"><span>{copy.issuer}</span><input type="url" aria-label={`${name}: ${copy.oauthIssuer}`} maxLength={2048} value={values.oauthIssuer} placeholder="https://login.example.com" spellCheck={false} onChange={event => update('oauthIssuer', event.target.value)}/><small>{copy.issuerHint}</small></label>
            <label className="mcp-field"><span>{copy.authorizationUrl} <small>Optional</small></span><input type="url" aria-label={`${name}: ${copy.oauthAuthorize}`} maxLength={2048} value={values.oauthAuthorizationUrl} placeholder={copy.discover} spellCheck={false} onChange={event => update('oauthAuthorizationUrl', event.target.value)}/><small>{copy.authorizationHint}</small></label>
            <label className="mcp-field"><span>{copy.tokenUrl} <small>Optional</small></span><input type="url" aria-label={`${name}: ${copy.oauthToken}`} maxLength={2048} value={values.oauthTokenUrl} placeholder={copy.discover} spellCheck={false} onChange={event => update('oauthTokenUrl', event.target.value)}/><small>{copy.tokenUrlHint}</small></label>
            <label className="mcp-field"><span>{copy.clientAuth}</span><select aria-label={`${name}: ${copy.oauthClientAuth}`} value={values.oauthClientAuthMethod} onChange={event => update('oauthClientAuthMethod', event.target.value as FormValues['oauthClientAuthMethod'])}><option value="auto">{copy.automatic}</option><option value="client_secret_post">{copy.post}</option><option value="client_secret_basic">{copy.basic}</option></select><small>{copy.clientAuthHint}</small></label>
            <label className="mcp-field"><span>{copy.secret} <small>{server?.hasOAuthClientSecret ? copy.saved : copy.optionalSecret}</small></span><input type="password" aria-label={`${name}: ${copy.oauthSecret}`} maxLength={8192} autoComplete="new-password" value={values.oauthClientSecret} placeholder={server?.hasOAuthClientSecret ? copy.keepSecret : copy.enterSecret} onChange={event => { update('oauthClientSecret', event.target.value); if (event.target.value) update('clearOAuthClientSecret', false); }}/></label>
            {server?.hasOAuthClientSecret && <label className="mcp-checkbox"><input type="checkbox" checked={values.clearOAuthClientSecret} disabled={!!values.oauthClientSecret} onChange={event => update('clearOAuthClientSecret', event.target.checked)}/><span>{copy.removeSecret}</span></label>}
            <label className="mcp-field"><span>Scopes</span><input aria-label={`${name}: ${copy.oauthScopes}`} maxLength={2000} value={values.oauthScopes} placeholder={copy.scopePlaceholder} spellCheck={false} onChange={event => update('oauthScopes', event.target.value)}/><small>{copy.scopesHint}</small></label>
            <label className="mcp-field"><span>{copy.port}</span><input type="number" aria-label={`${name}: ${copy.oauthPort}`} min={1024} max={65535} value={values.oauthRedirectPort} onChange={event => update('oauthRedirectPort', event.target.value)}/><small>{copy.redirect} <code className="mcp-callback">http://127.0.0.1:{values.oauthRedirectPort || '43189'}/oauth/callback</code></small></label>
          </div></details>}
        </>}
        <label className="mcp-checkbox"><input type="checkbox" checked={values.autoConnect} onChange={event => update('autoConnect', event.target.checked)}/><span>{copy.autoConnect}<small>{values.transport === 'stdio' ? copy.autoProcessHint : copy.autoHttpHint}</small></span></label>
        <div className="mcp-save-row"><small>{configDirty || !server ? copy.unsavedConnection : copy.savedConnection}</small><button type="submit" className="mcp-primary" disabled={!configDirty || busy}>{busy ? copy.wait : copy.save}</button></div>
      </fieldset></form>
      {values.transport === 'http' && values.authMode === 'oauth' && <div className="mcp-oauth" aria-label={`${name}: ${copy.oauthSignIn}`}>
        <div className="mcp-oauth-heading"><strong>{copy.oauthSignIn}</strong><span role="status" className={`mcp-status ${signingIn ? 'connecting' : server?.oauthStatus === 'signed_in' ? 'connected' : ''}`}>{signingIn && <LoaderCircle size={13} aria-hidden="true"/>}{oauthLabels[server?.oauthStatus ?? 'signed_out']}</span></div>
        {configDirty || !server ? <p className="mcp-note">{copy.saveBeforeSignIn}</p> : signingIn ? <p className="mcp-note">{copy.finishBrowser}</p> : server.oauthStatus === 'signed_in' ? null : <p className="mcp-note">{copy.signInHint}</p>}
        {server?.oauthError && server.oauthError !== server.error && <p className="mcp-feedback error" role="alert">{server.oauthError}</p>}
        <div className="mcp-oauth-actions">{signingIn ? <button type="button" disabled={cancellingSignIn} onClick={() => void cancelSignIn()}><X size={13}/>{cancellingSignIn ? copy.cancelling : copy.cancelSignIn}</button> : <>
          <button type="button" className="mcp-primary" disabled={!server || busy || signingIn || configDirty} onClick={() => server && void action(async () => { const result = await window.workspace.mcpSignIn(server.id); await onRefresh(); if (result.oauthStatus === 'signed_in') setNotice(result.status === 'connected' ? 'signedInConnected' : 'didSignIn'); else if (result.oauthStatus !== 'signed_out') throw new Error(result.oauthError || result.error || copy.failedSignIn); })}><ExternalLink size={13}/>{server?.oauthStatus === 'signed_in' ? copy.again : copy.signInBrowser}</button>
          {server && (server.hasOAuthTokens || server.oauthStatus === 'required' || server.oauthStatus === 'error') && <button type="button" disabled={busy || signingIn || configDirty} onClick={() => void action(async () => { await window.workspace.mcpSignOut(server.id); await onRefresh(); }, server.hasOAuthTokens ? 'didSignOut' : 'didReset')}><LogOut size={13}/>{server.hasOAuthTokens ? copy.signOut : copy.resetAuth}</button>}
        </>}</div>
      </div>}
      {server && <details className="mcp-tools" open={toolsOpen} onToggle={event => setToolsOpen(event.currentTarget.open)}><summary><span><strong>{copy.permissions}</strong><small>{statusCount}</small></span><ChevronDown size={15} aria-hidden="true"/></summary><div className="mcp-tools-content">
        {!connected && <p className="mcp-note">{copy.connectToInspect}</p>}
        {connected && <><div className="mcp-tool-actions"><button type="button" disabled={busy || signingIn || toolsLoading || configDirty} onClick={() => changeAllowed(previous => [...new Set([...previous, ...(toolsPage?.tools.filter(tool => tool.supported).map(tool => tool.name) ?? [])])])}>{toolsPage?.hasMore ? copy.allowLoaded : copy.allowAll}</button><button type="button" disabled={busy || signingIn || !allowed.length || configDirty} onClick={() => changeAllowed(() => [])}>{copy.blockAll}</button><button type="button" className="mcp-icon" aria-label={`${name}: ${copy.refreshTools}`} title={copy.refreshTools} disabled={busy || signingIn || toolsLoading} onClick={() => void loadTools(false, true)}><RefreshCw size={13}/></button></div>
          {toolsError && <p className="mcp-feedback error" role="alert">{toolsError}</p>}
          <div className="mcp-tool-list" aria-label={`${name}: ${copy.tools}`} aria-busy={toolsLoading}>{toolsPage?.tools.map(tool => <ToolRow key={tool.name} tool={tool} checked={allowed.includes(tool.name)} disabled={busy || signingIn || configDirty || !tool.supported} onChange={checked => changeAllowed(previous => checked ? [...new Set([...previous, tool.name])] : previous.filter(value => value !== tool.name))}/>)}</div>
          {toolsLoading && <p className="mcp-note" role="status">{copy.loadingTools}</p>}{toolsPage && !toolsPage.tools.length && !toolsLoading && <p className="mcp-note">{copy.noTools}</p>}
          {toolsPage?.hasMore && <button type="button" disabled={toolsLoading || busy} onClick={() => void loadTools(true)}>{copy.moreTools}{toolsPage.tools.length}/{toolsPage.total})</button>}
          <div className="mcp-save-row"><small>{copy.permissionHint}</small><button type="button" className="mcp-primary" disabled={busy || signingIn || !permissionsDirty || configDirty} onClick={() => void savePermissions()}>{copy.savePermissions}</button></div>
        </>}
      </div></details>}
      <div className="mcp-editor-footer">{dirty && <button type="button" disabled={busy || signingIn} onClick={discard}>{copy.discard}</button>}{!server && onCancel && <button type="button" disabled={busy || signingIn} onClick={onCancel}>{copy.cancelAdd}</button>}{server && <button type="button" className="mcp-danger" disabled={busy || signingIn || dirty} title={dirty ? copy.saveOrDiscard : undefined} onClick={() => void action(async () => { const removed = await window.workspace.mcpRemoveServer(server.id); if (removed) await onRefresh(); })}><Trash2 size={12}/>{copy.remove}</button>}</div>
      {error && !repeatedError && <p className="mcp-feedback error" role="alert">{error}</p>}{notice && <p className="mcp-feedback success" role="status">{copy[notice]}</p>}
    </div>
  </details>;
}

function ToolRow({ tool, checked, disabled, onChange }: { tool: McpToolInfo; checked: boolean; disabled: boolean; onChange(value: boolean): void }) {
  const copy = mcpText[useUiLocale()];
  return <label className={`mcp-tool${!tool.supported ? ' is-unsupported' : ''}`}><input type="checkbox" aria-label={copy.allowTool(tool.name)} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/><span><strong>{tool.title || tool.name}{tool.readOnly && <small>{copy.readOnly}</small>}</strong>{tool.title && <code>{tool.name}</code>}<p>{tool.description || copy.noDescription}</p>{!tool.supported && <small className="mcp-tool-reason">{tool.reason || copy.unsupported}</small>}</span></label>;
}

function AuditPanel() {
  const locale = useUiLocale();
  const copy = mcpText[locale];
  const [open, setOpen] = useState(false), [entries, setEntries] = useState<McpAuditEntry[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const version = useRef(0);
  async function refresh() {
    const request = ++version.current;
    setLoading(true); setError('');
    try { const result = await window.workspace.mcpAudit({ limit: 100 }); if (request === version.current) setEntries(result.entries); }
    catch (reason) { if (request === version.current) setError(message(reason)); }
    finally { if (request === version.current) setLoading(false); }
  }
  useEffect(() => { if (!open) return; void refresh(); const unsubscribe = window.workspace.onMcpChanged(() => { void refresh(); }); return () => { version.current++; unsubscribe(); }; }, [open]);
  const outcomes = { completed: copy.completed, failed: copy.failed, cancelled: copy.cancelled, uncertain: copy.uncertain };
  return <details className="mcp-audit" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary><span><strong>{copy.audit}</strong><small>{copy.auditHint}</small></span><ChevronDown size={15} aria-hidden="true"/></summary><div><button type="button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={13}/>{copy.refresh}</button>{error && <p className="mcp-feedback error" role="alert">{error}</p>}{loading && <p className="mcp-note" role="status">{copy.loadingLog}</p>}<ol>{entries.map(entry => <li key={entry.id}><div><strong>{entry.serverName}</strong><span>{entry.action === 'call' ? entry.tool : ({ connect: copy.connect, disconnect: copy.disconnect, sign_in: copy.signIn, sign_out: copy.signOut }[entry.action])}</span><small><time dateTime={entry.timestamp}>{new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(entry.timestamp))}</time> · {entry.durationMs} ms</small></div><span className={`mcp-audit-outcome ${entry.outcome}`}>{outcomes[entry.outcome]}</span></li>)}</ol>{!loading && !entries.length && <p className="mcp-note">{copy.emptyLog}</p>}</div></details>;
}

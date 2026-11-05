import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { matchesSettingsEntry, settingsEntries } from './settings-registry';
import { preparationValues, SettingsPreparationNotice, useSettingsPreparation, type SettingsSuggestion } from './settings-preparation';
import type { AiSettings as SavedAiSettings } from '../shared/model';
import type { AiProvider as Provider, AiProtocol as Protocol, AiAuthMode as AuthMode } from '../shared/ai-providers';
import type { ChatGptStatus } from '../shared/chatgpt';
import './ai-settings.css';

type Thinking = 'off' | 'low' | 'medium' | 'high';
type AiConfiguration = SavedAiSettings & { provider: Provider; protocol: Protocol; authMode: AuthMode; apiVersion: string };
const providerLabels: Record<Provider, string> = { 'openai-compatible': 'OpenAI-kompatibel', openai: 'OpenAI', azure: 'Azure AI Foundry', chatgpt: 'ChatGPT' };
const planWelcomeKey = 'openvibedesk.settings.chatgptPlanWelcome';
function normalizedConfiguration(value: SavedAiSettings): AiConfiguration {
  return { ...value, provider: value.provider ?? 'openai-compatible', protocol: value.protocol ?? 'chat-completions', authMode: value.authMode ?? 'bearer', apiVersion: value.apiVersion ?? '', confirmationMode: value.confirmationMode === 'never' ? 'never' : 'ask' };
}
type AiGroups = { connection: boolean; models: boolean; workspace: boolean };
const groupStorageKey = 'openvibedesk.settings.aiGroups';
function loadGroups(): AiGroups {
  const defaults = { connection: false, models: false, workspace: false };
  try {
    const value = JSON.parse(localStorage.getItem(groupStorageKey) ?? '{}');
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback])) as AiGroups;
  } catch { return defaults; }
}

function ModelField({ id, label, value, onChange, models, deployment = false }: { id: string; label: string; value: string; onChange(value: string): void; models: string[]; deployment?: boolean }) {
  const [manual, setManual] = useState(false);
  const custom = value && !models.includes(value);
  return <div className="ai-field"><label htmlFor={id}>{label}</label>
    {models.length > 0 && !manual ? <select id={id} value={value} onChange={event => {
      if (event.target.value === '__manual_model__') { setManual(true); onChange(''); }
      else onChange(event.target.value);
    }}><option value="">{deployment ? 'Deployment auswählen' : 'Modell auswählen'}</option>{custom && <option value={value}>{value} (manuell)</option>}{models.map(item => <option key={item} value={item}>{item}</option>)}<option value="__manual_model__">{deployment ? 'Deployment-Namen eingeben …' : 'Andere Modell-ID eingeben …'}</option></select>
      : <input id={id} value={value} onChange={event => onChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder={deployment ? 'Deployment-Namen aus Azure eingeben' : 'Modell-ID eingeben'} />}
    {manual && models.length > 0 && <button className="ai-inline-button" type="button" onClick={() => setManual(false)}>Aus Modellliste auswählen</button>}
  </div>;
}

function ThinkingField({ id, label, value, onChange }: { id: string; label: string; value: Thinking; onChange(value: Thinking): void }) {
  return <div className="ai-field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={event => onChange(event.target.value as Thinking)}><option value="off">Aus</option><option value="low">Niedrig</option><option value="medium">Mittel</option><option value="high">Hoch</option></select><p>Diese Stufe wird bei Auswahl dieses Modells verwendet. Die Unterstützung hängt vom Anbieter und Modell ab.</p></div>;
}

export function AiSettings({ searchQuery = '', onClearSearch, preparation }: { searchQuery?: string; onClearSearch?(): void; preparation?: SettingsSuggestion }) {
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [provider, setProvider] = useState<Provider>('openai-compatible');
  const [protocol, setProtocol] = useState<Protocol>('chat-completions');
  const [authMode, setAuthMode] = useState<AuthMode>('bearer');
  const [apiVersion, setApiVersion] = useState('');
  const [chatGptStatus, setChatGptStatus] = useState<ChatGptStatus | null>(null);
  const [chatGptBusy, setChatGptBusy] = useState(false);
  const [chatGptError, setChatGptError] = useState('');
  const chatGptStatusRef = useRef<ChatGptStatus | null>(null);
  const planWelcomeSeen = useRef(false);
  const [planWelcomeOpen, setPlanWelcomeOpen] = useState(false);
  const planWelcome = useRef<HTMLDialogElement>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [smartModel, setSmartModel] = useState('');
  const [simpleModel, setSimpleModel] = useState('');
  const [smartThinking, setSmartThinking] = useState<Thinking>('off');
  const [simpleThinking, setSimpleThinking] = useState<Thinking>('off');
  const [workspaceTools, setWorkspaceTools] = useState(true);
  const [confirmationMode, setConfirmationMode] = useState<'ask' | 'never'>('ask');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openGroups, setOpenGroups] = useState<AiGroups>(loadGroups);
  const urlInput = useRef<HTMLInputElement>(null);
  const discoveryId = useRef(0);
  const urlChanged = !!configuration && baseUrl.trim().replace(/\/+$/, '') !== configuration.baseUrl.replace(/\/+$/, '');
  const credentialChanged = urlChanged || !!configuration && authMode !== configuration.authMode;
  const connectionChanged = provider === 'chatgpt'
    ? !!configuration && provider !== configuration.provider
    : credentialChanged || apiKey.length > 0 || !!configuration && (provider !== configuration.provider || protocol !== configuration.protocol || apiVersion.trim() !== configuration.apiVersion);
  const legacyAzure = provider === 'azure' && /\/openai\/deployments\//i.test(baseUrl);
  const dirty = !!configuration && (connectionChanged || smartModel !== configuration.smartModel || simpleModel !== configuration.simpleModel || smartThinking !== configuration.smartThinking || simpleThinking !== configuration.simpleThinking || workspaceTools !== configuration.workspaceTools || confirmationMode !== configuration.confirmationMode);
  const prepared = useSettingsPreparation(preparation, !!configuration, !dirty && !busy && !chatGptBusy, applyPreparation);
  useEffect(() => { if (preparation) setOpenGroups({ connection: true, models: true, workspace: true }); }, [preparation]);
  function applyPreparation(suggestion: SettingsSuggestion) {
    const values = preparationValues(suggestion);
    if (['provider', 'protocol', 'authMode', 'apiVersion', 'baseUrl'].some(key => key in values)) invalidateDiscovery();
    if (values.provider === 'openai-compatible' || values.provider === 'openai' || values.provider === 'azure' || values.provider === 'chatgpt') setProvider(values.provider);
    if (values.protocol === 'chat-completions' || values.protocol === 'responses') setProtocol(values.protocol);
    if (values.authMode === 'bearer' || values.authMode === 'api-key' || values.authMode === 'none') setAuthMode(values.authMode);
    if (typeof values.apiVersion === 'string') setApiVersion(values.apiVersion);
    if (typeof values.baseUrl === 'string') setBaseUrl(values.baseUrl);
    if (typeof values.smartModel === 'string') setSmartModel(values.smartModel);
    if (typeof values.simpleModel === 'string') setSimpleModel(values.simpleModel);
    if (typeof values.smartThinking === 'string') setSmartThinking(values.smartThinking as Thinking);
    if (typeof values.simpleThinking === 'string') setSimpleThinking(values.simpleThinking as Thinking);
    if (values.confirmationMode === 'ask' || values.confirmationMode === 'never') setConfirmationMode(values.confirmationMode);
    if (typeof values.workspaceTools === 'boolean') setWorkspaceTools(values.workspaceTools);
    setOpenGroups({ connection: true, models: true, workspace: true });
    setError(''); setNotice('KI-Vorschlag vorbereitet. Bitte prüfen und selbst speichern. Schlüssel wurden nicht übernommen.');
  }
  function resetCurrentChanges() {
    if (!configuration || busy || chatGptBusy) return;
    applyConfiguration(configuration); setApiKey('');
    setError(''); setNotice('Eigene Änderungen verworfen. Der Vorschlag wartet auf deine Übernahme.');
    void discover();
  }
  function applyConfiguration(value: SavedAiSettings) {
    const next = normalizedConfiguration(value);
    setConfiguration(next); setProvider(next.provider); setProtocol(next.protocol); setAuthMode(next.authMode); setApiVersion(next.apiVersion);
    setBaseUrl(next.baseUrl); setSmartModel(next.smartModel); setSimpleModel(next.simpleModel);
    setSmartThinking(next.smartThinking); setSimpleThinking(next.simpleThinking);
    setWorkspaceTools(next.workspaceTools); setConfirmationMode(next.confirmationMode);
  }
  function invalidateDiscovery() { discoveryId.current++; setModels([]); setDiscovering(false); setDiscoveryError(''); }
  function changeProvider(next: Provider) {
    invalidateDiscovery(); setProvider(next);
    if (next !== 'chatgpt') setAuthMode(next === 'azure' ? 'api-key' : 'bearer');
    // Apply endpoint defaults only to an empty field; custom endpoints and other edits stay intact.
    if (!baseUrl.trim() && next === 'openai') setBaseUrl('https://api.openai.com/v1');
  }
  function acceptChatGptStatus(status: ChatGptStatus) {
    const current = chatGptStatusRef.current;
    if (current && (current.activeProfileId !== status.activeProfileId || current.authenticated !== status.authenticated || current.planAccess !== status.planAccess)) invalidateDiscovery();
    chatGptStatusRef.current = status; setChatGptStatus(status);
    if (status.authenticated && status.planAccess && !planWelcomeSeen.current) {
      try { if (localStorage.getItem(planWelcomeKey) === 'seen') planWelcomeSeen.current = true; else setPlanWelcomeOpen(true); }
      catch { setPlanWelcomeOpen(true); }
    }
  }
  async function refreshChatGptStatus() {
    setChatGptBusy(true); setChatGptError('');
    try { acceptChatGptStatus(await window.workspace.getChatGptStatus()); }
    catch (reason) { setChatGptError(`ChatGPT-Status konnte nicht gelesen werden: ${String(reason)}`); }
    finally { setChatGptBusy(false); }
  }
  async function loginChatGpt(newProfile = false) {
    setChatGptBusy(true); setChatGptError('');
    try {
      await window.workspace.startChatGptLogin(newProfile ? { newProfile: true } : chatGptStatus?.authenticated && !chatGptStatus.planAccess ? { consent: true } : undefined);
      acceptChatGptStatus(await window.workspace.getChatGptStatus());
    } catch (reason) { setChatGptError(`ChatGPT-Anmeldung konnte nicht gestartet werden: ${String(reason)}`); }
    finally { setChatGptBusy(false); }
  }
  async function endChatGptLogin(logout: boolean) {
    setChatGptBusy(true); setChatGptError('');
    try {
      if (logout) await window.workspace.logoutChatGpt(); else await window.workspace.cancelChatGptLogin();
      acceptChatGptStatus(await window.workspace.getChatGptStatus());
      if (logout) invalidateDiscovery();
    } catch (reason) { setChatGptError(`ChatGPT-Anmeldung konnte nicht geändert werden: ${String(reason)}`); }
    finally { setChatGptBusy(false); }
  }
  async function selectChatGptProfile(profileId: string) {
    setChatGptBusy(true); setChatGptError(''); invalidateDiscovery();
    try { await window.workspace.selectChatGptProfile(profileId); acceptChatGptStatus(await window.workspace.getChatGptStatus()); }
    catch (reason) { setChatGptError(`ChatGPT-Konto konnte nicht ausgewählt werden: ${String(reason)}`); }
    finally { setChatGptBusy(false); }
  }
  async function manageChatGptUsage() {
    try { await window.workspace.openChatGptUsage(); }
    catch (reason) { setChatGptError(`Nutzung konnte nicht geöffnet werden: ${String(reason)}`); }
  }
  function dismissPlanWelcome() {
    planWelcomeSeen.current = true;
    try { localStorage.setItem(planWelcomeKey, 'seen'); } catch { /* The in-memory choice remains effective. */ }
    setPlanWelcomeOpen(false);
  }
  useEffect(() => {
    if (provider !== 'chatgpt') return;
    void refreshChatGptStatus();
    return window.workspace.onChatGptStatus(acceptChatGptStatus);
  }, [provider]);
  useEffect(() => {
    const dialog = planWelcome.current;
    if (planWelcomeOpen && dialog && !dialog.open && !dialog.closest('[hidden]')) dialog.showModal();
    else if (!planWelcomeOpen && dialog?.open) dialog.close();
  });
  const searching = searchQuery.trim().length > 0;
  const matches = (name: keyof AiGroups) => matchesSettingsEntry(settingsEntries.find(entry => entry.id === `ai.${name}`)!, searchQuery);
  const groupOpen = (name: keyof AiGroups) => searching ? matches(name) : openGroups[name];
  const onGroupToggle = (name: keyof AiGroups, open: boolean) => {
    if (!searching) setOpenGroups(current => current[name] === open ? current : { ...current, [name]: open });
  };

  useEffect(() => {
    try { localStorage.setItem(groupStorageKey, JSON.stringify(openGroups)); } catch { /* Keep the in-memory selection. */ }
  }, [openGroups]);

  useLayoutEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.workspace.setAiSettingsStatus(busy || chatGptBusy ? 'busy' : dirty ? 'dirty' : 'clean');
    if (dirty || busy || chatGptBusy) window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, busy, chatGptBusy]);

  async function discover() {
    const id = ++discoveryId.current;
    setDiscovering(true); setDiscoveryError('');
    try { const found = await window.workspace.listAiModels(); if (id === discoveryId.current) setModels(found); }
    catch (reason) { if (id === discoveryId.current) { setModels([]); setDiscoveryError(`Modellliste nicht verfügbar: ${String(reason)}. Modell- oder Deployment-Namen können manuell eingegeben werden. Die Liste prüft keine Chat-Anfrage.`); } }
    finally { if (id === discoveryId.current) setDiscovering(false); }
  }

  useEffect(() => {
    if (provider === 'chatgpt' && configuration?.provider === 'chatgpt' && chatGptStatus?.authenticated && chatGptStatus.planAccess) void discover();
  }, [provider, configuration?.provider, chatGptStatus?.activeProfileId, chatGptStatus?.authenticated, chatGptStatus?.planAccess]);

  useEffect(() => {
    let active = true;
    window.workspace.getAiSettings().then(value => {
      if (!active) return;
      applyConfiguration(value);
      if (value.configured && value.provider !== 'chatgpt') void discover();
    }).catch(reason => { if (active) setError(`Einstellungen konnten nicht geladen werden: ${String(reason)}`); });
    return () => { active = false; discoveryId.current++; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (provider !== 'chatgpt' && !urlInput.current?.checkValidity()) {
      onClearSearch?.();
      setOpenGroups(current => ({ ...current, connection: true }));
      setError('Bitte eine gültige Endpunkt-URL eingeben.');
      requestAnimationFrame(() => urlInput.current?.focus());
      return;
    }
    setBusy(true);
    try {
      invalidateDiscovery();
      await window.workspace.saveAiSettings({ provider, protocol, authMode, apiVersion: apiVersion.trim(), baseUrl: baseUrl.trim(), smartModel: smartModel.trim(), simpleModel: simpleModel.trim(), smartThinking, simpleThinking, workspaceTools, confirmationMode, ...(apiKey && authMode !== 'none' && provider !== 'chatgpt' ? { apiKey } : {}) });
      const updated = await window.workspace.getAiSettings();
      applyConfiguration(updated); if (provider !== 'chatgpt') setApiKey('');
      setNotice('KI-Einstellungen gespeichert.');
      void discover();
    } catch (reason) { setError(`Speichern fehlgeschlagen: ${String(reason)}`); }
    finally { setBusy(false); }
  }

  async function removeKey() {
    setBusy(true); setError(''); setNotice('');
    try { await window.workspace.clearAiKey(); setConfiguration(current => current && ({ ...current, hasApiKey: false })); setNotice('API-Schlüssel entfernt.'); void discover(); }
    catch (reason) { setError(`Schlüssel konnte nicht entfernt werden: ${String(reason)}`); }
    finally { setBusy(false); }
  }

  return <section className="ai-settings" aria-label="KI-Einstellungen">
    {!configuration && !error && <p className="ai-loading">Einstellungen werden geladen …</p>}
    <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || busy || chatGptBusy} onApply={prepared.accept} onDismiss={prepared.dismiss} />
    {prepared.pending && dirty && <button className="ai-inline-button" type="button" disabled={busy || chatGptBusy} onClick={resetCurrentChanges}>Eigene Änderungen verwerfen</button>}
    {configuration && <form className="ai-form" noValidate onSubmit={event => void save(event)}><fieldset className="ai-fields" disabled={busy || chatGptBusy}>
      <details className="ai-section" hidden={searching && !matches('connection')} open={groupOpen('connection')} onToggle={event => onGroupToggle('connection', event.currentTarget.open)}>
      <summary><span><strong>Verbindung</strong><small>{providerLabels[configuration.provider]} · {configuration.provider === 'chatgpt' ? chatGptStatus?.authenticated ? chatGptStatus.planAccess ? 'ChatGPT-Plan aktiv' : 'Angemeldet · Plan nicht freigegeben' : 'Anmeldung erforderlich' : <>{configuration.configured ? (() => { try { const url = new URL(configuration.baseUrl); return url.host || 'Endpunkt gespeichert'; } catch { return 'Endpunkt gespeichert'; } })() : 'Nicht eingerichtet'} · {configuration.hasApiKey ? 'Schlüssel hinterlegt' : 'Kein Schlüssel'}</>}{connectionChanged ? ' · Änderung offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content">
      <div className="ai-field"><label htmlFor="ai-provider">Anbieter</label><select id="ai-provider" value={provider} onChange={event => changeProvider(event.target.value as Provider)}><option value="openai-compatible">OpenAI-kompatibel / lokaler Anbieter</option><option value="openai">OpenAI</option><option value="azure">Azure AI Foundry / Azure OpenAI</option><option value="chatgpt">ChatGPT</option></select><p>{provider === 'azure' ? 'Die Modellfelder verwenden deine Azure-Deployment-Namen.' : provider === 'chatgpt' ? 'Nutze deinen ChatGPT-Plan für berechtigte KI-Anfragen in OVD. Du meldest dich dafür im Browser an.' : provider === 'openai' ? 'OpenAI mit einem API-Schlüssel und frei wählbarem Modell.' : 'Für Gateways und lokale Dienste mit OpenAI-kompatibler Schnittstelle.'}</p></div>
      {provider === 'chatgpt' ? <>
      {(chatGptStatus?.profiles.length ?? 0) > 1 && <div className="ai-field"><label htmlFor="ai-chatgpt-account">ChatGPT-Konto</label><select id="ai-chatgpt-account" value={chatGptStatus?.activeProfileId ?? ''} disabled={chatGptStatus?.loginPending} onChange={event => void selectChatGptProfile(event.target.value)}>{!chatGptStatus?.activeProfileId && <option value="" disabled>Konto auswählen</option>}{chatGptStatus?.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}{profile.authenticated ? '' : ' · erneut anmelden'}</option>)}</select></div>}
      <div className="ai-chatgpt-status" role="status"><strong>{chatGptBusy ? 'ChatGPT wird geprüft …' : chatGptStatus?.loginPending ? 'Anmeldung im Browser abschließen' : chatGptStatus?.authenticated ? 'Mit ChatGPT angemeldet' : 'Noch nicht mit ChatGPT verbunden'}</strong>{chatGptStatus?.accountLabel && <span>{chatGptStatus.accountLabel}</span>}{chatGptStatus?.authenticated && <span>{chatGptStatus.planAccess ? 'Dein ChatGPT-Plan wird für berechtigte Anfragen verwendet.' : 'Dein ChatGPT-Plan ist für OVD noch nicht freigegeben. Melde dich erneut an und prüfe die Berechtigungen.'}</span>}{chatGptStatus?.error && <p>{chatGptStatus.error}</p>}</div>
      <div className="ai-chatgpt-actions">{chatGptStatus?.loginPending ? <button id="ai-chatgpt-cancel" className="ai-refresh" type="button" onClick={() => void endChatGptLogin(false)}>Anmeldung abbrechen</button> : <><button id="ai-chatgpt-login" className="ai-chatgpt-signin" type="button" data-oai-siwc-button="" onClick={() => void loginChatGpt()}>Continue with ChatGPT</button>{(chatGptStatus?.profiles.length ?? 0) > 0 && <button id="ai-chatgpt-add-account" className="ai-refresh" type="button" onClick={() => void loginChatGpt(true)}>Konto hinzufügen</button>}</>}<button id="ai-chatgpt-refresh" className="ai-refresh" type="button" onClick={() => void refreshChatGptStatus()}><RefreshCw size={14} /> Status prüfen</button>{chatGptStatus?.authenticated && <button id="ai-chatgpt-logout" className="ai-remove" type="button" onClick={() => void endChatGptLogin(true)}>Abmelden</button>}</div>
      {chatGptStatus?.authenticated && <button id="ai-chatgpt-usage" className="ai-inline-button" type="button" onClick={() => void manageChatGptUsage()}>Nutzung in ChatGPT verwalten</button>}
      {chatGptError && <p className="ai-feedback ai-error" role="alert">{chatGptError}</p>}
      </> : <>
      <div className="ai-field"><label htmlFor="ai-base-url">Endpunkt-URL</label><input ref={urlInput} id="ai-base-url" type="url" required autoComplete="off" spellCheck={false} value={baseUrl} onChange={event => { invalidateDiscovery(); setBaseUrl(event.target.value); }} placeholder={provider === 'azure' ? 'https://deine-ressource.openai.azure.com/openai/v1' : 'https://api.openai.com/v1'} /><p>{provider === 'azure' ? <>Ressourcen-URL mit <code>/openai/v1</code> oder die vollständige URL aus dem Azure-Deployment.</> : <>Basis-URL des Anbieters, üblicherweise mit <code>/v1</code>.</>}</p></div>
      <div className="ai-connection-options">
      <div className="ai-field"><label htmlFor="ai-protocol">Schnittstelle</label><select id="ai-protocol" value={protocol} onChange={event => { invalidateDiscovery(); setProtocol(event.target.value as Protocol); }}><option value="chat-completions">Chat Completions</option><option value="responses">Responses API</option></select><p>{protocol === 'responses' ? 'Für Modelle mit Responses-Unterstützung.' : 'Für Anbieter und Modelle mit Chat-Completions-Unterstützung.'}</p></div>
      <div className="ai-field"><label htmlFor="ai-auth-mode">Anmeldung</label><select id="ai-auth-mode" value={authMode} onChange={event => { invalidateDiscovery(); setAuthMode(event.target.value as AuthMode); }}><option value="bearer">Bearer-Token</option><option value="api-key">API-Schlüssel (api-key)</option><option value="none">Ohne Anmeldung</option></select><p>{authMode === 'api-key' ? 'Sendet den Schlüssel im api-key-Header, z. B. für Azure.' : authMode === 'none' ? 'Für lokale Dienste, die keinen Schlüssel verlangen.' : 'Sendet den Schlüssel als Authorization: Bearer.'}</p></div>
      </div>
      {provider === 'azure' && (legacyAzure || apiVersion) && <div className="ai-field"><label htmlFor="ai-api-version">Azure API-Version</label><input id="ai-api-version" value={apiVersion} onChange={event => { invalidateDiscovery(); setApiVersion(event.target.value); }} spellCheck={false} autoComplete="off" placeholder="Zum Beispiel 2024-10-21" /><p>Für klassische Deployment-URLs erforderlich. Bei <code>/openai/v1</code> normalerweise leer lassen.</p></div>}
      {authMode !== 'none' && <div className="ai-field"><div className="ai-label-line"><label htmlFor="ai-api-key">API-Schlüssel / Zugriffstoken</label><span className={`ai-key-status ${configuration.hasApiKey && !credentialChanged ? 'is-saved' : ''}`}><KeyRound size={12} />{credentialChanged ? 'Je Verbindung gespeichert' : configuration.hasApiKey ? 'Gespeichert' : 'Nicht hinterlegt'}</span></div><input id="ai-api-key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={event => { invalidateDiscovery(); setApiKey(event.target.value); }} placeholder={configuration.hasApiKey && !credentialChanged ? 'Leer lassen, um den Schlüssel zu behalten' : 'Schlüssel für die gewählte Anmeldung'} /><p>{credentialChanged ? 'Gespeicherte Schlüssel sind nach Endpunkt und Anmeldeart getrennt.' : configuration.hasApiKey ? 'Ein neuer Wert ersetzt den gespeicherten Schlüssel dieser Verbindung.' : 'Der Schlüssel wird beim Speichern im System hinterlegt.'}</p></div>}
      {configuration.hasApiKey && !credentialChanged && <button className="ai-remove" type="button" disabled={busy} onClick={() => void removeKey()}><Trash2 size={14} /> Gespeicherten Schlüssel entfernen</button>}
      </>}
      </div></details>
      <details className="ai-section" hidden={searching && !matches('models')} open={groupOpen('models')} onToggle={event => onGroupToggle('models', event.currentTarget.open)}>
      <summary><span><strong>Modelle</strong><small>Intelligent: {configuration.smartModel || 'nicht festgelegt'} · Einfach: {configuration.simpleModel || 'nicht festgelegt'}{smartModel !== configuration.smartModel || simpleModel !== configuration.simpleModel || smartThinking !== configuration.smartThinking || simpleThinking !== configuration.simpleThinking ? ' · Änderung offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content">
      <div className="ai-models-heading"><div><strong>Modelle</strong><p>{discovering ? 'Modelle werden geladen …' : models.length ? `${models.length} Modelle gefunden` : 'Keine Modelle geladen'}</p></div><button className="ai-refresh" type="button" disabled={busy || discovering || connectionChanged} onClick={() => void discover()}><RefreshCw size={14} /> Aktualisieren</button></div>
      {connectionChanged && <p className="ai-model-hint">Speichere zuerst die geänderte Verbindung, um deren Modellliste zu laden.</p>}
      {discoveryError && !connectionChanged && <p className="ai-model-hint" role="status">{discoveryError}</p>}
      {!discoveryError && !discovering && models.length === 0 && <p className="ai-model-hint">Speichere die Verbindung oder gib die Modell-IDs manuell ein.</p>}
      {provider === 'azure' && <p className="ai-model-hint">Trage den Namen deines Deployments ein. Ein Eintrag im Modellkatalog ist nicht automatisch ein nutzbares Deployment; eine fehlende Liste verhindert die manuelle Eingabe nicht.</p>}
      <ModelField id="ai-smart-model" label={provider === 'azure' ? 'Intelligentes Deployment' : 'Intelligentes Modell'} value={smartModel} onChange={setSmartModel} models={connectionChanged ? [] : models} deployment={provider === 'azure'} />
      <ThinkingField id="ai-smart-thinking" label="Thinking für intelligentes Modell" value={smartThinking} onChange={setSmartThinking} />
      <ModelField id="ai-simple-model" label={provider === 'azure' ? 'Einfaches Deployment' : 'Einfaches Modell'} value={simpleModel} onChange={setSimpleModel} models={connectionChanged ? [] : models} deployment={provider === 'azure'} />
      <ThinkingField id="ai-simple-thinking" label="Thinking für einfaches Modell" value={simpleThinking} onChange={setSimpleThinking} />
      <p className="ai-model-hint">Bei „Aus“ wird kein Thinking-Parameter gesendet. Das Modell kann dennoch intern nachdenken.</p>
      </div></details>
      <details className="ai-section" hidden={searching && !matches('workspace')} open={groupOpen('workspace')} onToggle={event => onGroupToggle('workspace', event.currentTarget.open)}>
      <summary><span><strong>Workspace-Zugriff</strong><small>Werkzeuge {configuration.workspaceTools ? 'aktiviert' : 'deaktiviert'} · {configuration.confirmationMode === 'never' ? 'Ohne Abfragen' : 'Mit Bestätigungen'}{workspaceTools !== configuration.workspaceTools || confirmationMode !== configuration.confirmationMode ? ' · Änderung offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content"><div className="setting-row ai-tool-row"><div><label htmlFor="workspace-tools">Workspace-Werkzeuge</label><p>Der Assistent kann für deine Aufträge selbstständig in verfügbaren Modulen suchen, Inhalte lesen und Ansichten öffnen. Dafür muss das Modell Werkzeugaufrufe unterstützen.</p></div><input id="workspace-tools" className="setting-toggle" type="checkbox" checked={workspaceTools} onChange={event => setWorkspaceTools(event.target.checked)} /></div>
      <div className="setting-row ai-confirmation-mode"><div><label htmlFor="ai-confirmation-mode">Ohne Abfragen</label><p id="ai-confirmation-description">Suchen und Lesen laufen bereits selbstständig. Dieser Schalter überspringt auch Bestätigungen für angeforderte Aktionen wie Senden und Löschen. Neue oder geänderte Fremdmodule benötigen weiterhin deine Freigabe.</p><p className="ai-setting-default">Standard: Aus. Wirkt nach dem Speichern.</p></div><input id="ai-confirmation-mode" className="setting-toggle" type="checkbox" aria-describedby="ai-confirmation-description" checked={confirmationMode === 'never'} onChange={event => setConfirmationMode(event.target.checked ? 'never' : 'ask')} /></div></div>
      </details>
      <div className="ai-actions"><span className="ai-save-hint">{dirty ? 'Änderungen noch nicht gespeichert' : 'Änderungen werden mit Speichern übernommen.'}</span><button className="ai-save" type="submit" disabled={busy || chatGptBusy}>{busy ? 'Bitte warten …' : 'KI-Einstellungen speichern'}</button></div>
    </fieldset></form>}
    {error && <p className="ai-feedback ai-error" role="alert">{error}</p>}
    {notice && <p className="ai-feedback ai-success" role="status">{notice}</p>}
    <dialog ref={planWelcome} className="ai-chatgpt-welcome" aria-labelledby="ai-chatgpt-welcome-title" onCancel={event => { event.preventDefault(); dismissPlanWelcome(); }}>
      <h2 id="ai-chatgpt-welcome-title">Du verwendest deinen ChatGPT-Plan</h2><p>Berechtigte KI-Anfragen in OVD nutzen deinen ChatGPT-Plan. Du kannst die Nutzung und Limits in deinen ChatGPT-Einstellungen verwalten.</p>{chatGptError && <p className="ai-error" role="alert">{chatGptError}</p>}<div><button className="ai-refresh" type="button" onClick={() => void manageChatGptUsage()}>Nutzung verwalten</button><button id="ai-chatgpt-welcome-close" className="ai-save" type="button" autoFocus onClick={dismissPlanWelcome}>Verstanden</button></div>
    </dialog>
  </section>;
}

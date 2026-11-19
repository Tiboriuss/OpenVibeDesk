import { useFormFeedback, formError, formDetail } from './form-feedback';
import { aiSettingsText } from './ai-settings-copy';
import { useUiLocale } from './locale';
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
const planWelcomeKey = 'openvibedesk.settings.chatgptPlanWelcome';
function normalizedConfiguration(value: SavedAiSettings): AiConfiguration {
  return { ...value, provider: value.provider ?? 'openai-compatible', protocol: value.protocol ?? 'chat-completions', authMode: value.authMode ?? 'bearer', apiVersion: value.apiVersion ?? '', confirmationMode: value.confirmationMode === 'never' ? 'never' : 'ask' };
}
type AiGroups = { connection: boolean; models: boolean; workspace: boolean };
const groupStorageKey = 'openvibedesk.settings.aiGroups';
const chatGroupStorageKey = 'openvibedesk.settings.chatOpen';
function loadChatGroup(): boolean {
  try { return localStorage.getItem(chatGroupStorageKey) === 'true'; } catch { return false; }
}
function loadGroups(): AiGroups {
  const defaults = { connection: false, models: false, workspace: false };
  try {
    const value = JSON.parse(localStorage.getItem(groupStorageKey) ?? '{}');
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback])) as AiGroups;
  } catch { return defaults; }
}

function ModelField({ id, label, value, onChange, models, deployment = false }: { id: string; label: string; value: string; onChange(value: string): void; models: string[]; deployment?: boolean }) {
  const copy = aiSettingsText[useUiLocale()];
  const [manual, setManual] = useState(false);
  const custom = value && !models.includes(value);
  return <div className="ai-field"><label htmlFor={id}>{label}</label>
    {models.length > 0 && !manual ? <select id={id} value={value} onChange={event => {
      if (event.target.value === '__manual_model__') setManual(true);
      else onChange(event.target.value);
    }}><option value="">{deployment ? copy.chooseDeployment : copy.chooseModel}</option>{custom && <option value={value}>{value} {copy.manual}</option>}{models.map(item => <option key={item} value={item}>{item}</option>)}<option value="__manual_model__">{deployment ? copy.otherDeployment : copy.otherModel}</option></select>
      : <input id={id} value={value} onChange={event => onChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder={deployment ? copy.enterDeployment : copy.enterModel} />}
    {manual && models.length > 0 && <button className="ai-inline-button" type="button" onClick={() => setManual(false)}>{copy.showList}</button>}
  </div>;
}

function ThinkingField({ id, label, value, onChange }: { id: string; label: string; value: Thinking; onChange(value: Thinking): void }) {
  const copy = aiSettingsText[useUiLocale()];
  return <div className="ai-field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={event => onChange(event.target.value as Thinking)}><option value="off">{copy.off}</option><option value="low">{copy.low}</option><option value="medium">{copy.medium}</option><option value="high">{copy.high}</option></select></div>;
}

export function AiSettings({ searchQuery = '', onClearSearch, preparation }: { searchQuery?: string; onClearSearch?(): void; preparation?: SettingsSuggestion }) {
  const locale = useUiLocale();
  const copy = aiSettingsText[locale];
  const providerLabels: Record<Provider, string> = { 'openai-compatible': copy.compatible, openai: 'OpenAI', azure: 'Azure AI Foundry', chatgpt: 'ChatGPT' };
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [provider, setProvider] = useState<Provider>('openai-compatible');
  const [protocol, setProtocol] = useState<Protocol>('chat-completions');
  const [authMode, setAuthMode] = useState<AuthMode>('bearer');
  const [apiVersion, setApiVersion] = useState('');
  const [chatGptStatus, setChatGptStatus] = useState<ChatGptStatus | null>(null);
  const [chatGptBusy, setChatGptBusy] = useState(false);
  const [chatGptError, setChatGptError] = useFormFeedback(copy, locale);
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
  const [discoveryError, setDiscoveryError] = useFormFeedback(copy, locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFormFeedback(copy, locale);
  const [notice, setNotice] = useFormFeedback(copy, locale);
  const [chatOpen, setChatOpen] = useState(loadChatGroup);
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
  useEffect(() => { if (preparation) { setChatOpen(true); setOpenGroups({ connection: true, models: true, workspace: true }); } }, [preparation]);
  useEffect(() => { if (error) setChatOpen(true); }, [error]);
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
    setError(''); setNotice(copy => copy.prepared);
  }
  function resetCurrentChanges() {
    if (!configuration || busy || chatGptBusy) return;
    applyConfiguration(configuration); setApiKey('');
    setError(''); setNotice(copy => copy.discarded);
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
    catch (reason) { setChatGptError((copy, locale) => formError(reason, copy.statusError, locale)); }
    finally { setChatGptBusy(false); }
  }
  async function loginChatGpt(newProfile = false) {
    setChatGptBusy(true); setChatGptError('');
    try {
      await window.workspace.startChatGptLogin(newProfile ? { newProfile: true } : chatGptStatus?.authenticated && !chatGptStatus.planAccess ? { consent: true } : undefined);
      acceptChatGptStatus(await window.workspace.getChatGptStatus());
    } catch (reason) { setChatGptError((copy, locale) => formError(reason, copy.loginError, locale)); }
    finally { setChatGptBusy(false); }
  }
  async function endChatGptLogin(logout: boolean) {
    setChatGptBusy(true); setChatGptError('');
    try {
      if (logout) await window.workspace.logoutChatGpt(); else await window.workspace.cancelChatGptLogin();
      acceptChatGptStatus(await window.workspace.getChatGptStatus());
      if (logout) invalidateDiscovery();
    } catch (reason) { setChatGptError((copy, locale) => formError(reason, copy.authError, locale)); }
    finally { setChatGptBusy(false); }
  }
  async function selectChatGptProfile(profileId: string) {
    setChatGptBusy(true); setChatGptError(''); invalidateDiscovery();
    try { await window.workspace.selectChatGptProfile(profileId); acceptChatGptStatus(await window.workspace.getChatGptStatus()); }
    catch (reason) { setChatGptError((copy, locale) => formError(reason, copy.accountError, locale)); }
    finally { setChatGptBusy(false); }
  }
  async function manageChatGptUsage() {
    try { await window.workspace.openChatGptUsage(); }
    catch (reason) { setChatGptError((copy, locale) => formError(reason, copy.usageError, locale)); }
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

  useEffect(() => {
    try { localStorage.setItem(chatGroupStorageKey, String(chatOpen)); } catch { /* Keep the current window usable. */ }
  }, [chatOpen]);

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
    catch (reason) { if (id === discoveryId.current) { setModels([]); setDiscoveryError((copy, locale) => formError(reason, copy.listError, locale)); } }
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
      if (!value.configured) setChatOpen(true);
      if (value.configured && value.provider !== 'chatgpt') void discover();
    }).catch(reason => { if (active) setError((copy, locale) => formError(reason, copy.loadError, locale)); });
    return () => { active = false; discoveryId.current++; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (provider !== 'chatgpt' && !urlInput.current?.checkValidity()) {
      onClearSearch?.();
      setOpenGroups(current => ({ ...current, connection: true }));
      setError(copy => copy.invalidUrl);
      requestAnimationFrame(() => urlInput.current?.focus());
      return;
    }
    setBusy(true);
    try {
      invalidateDiscovery();
      await window.workspace.saveAiSettings({ provider, protocol, authMode, apiVersion: apiVersion.trim(), baseUrl: baseUrl.trim(), smartModel: smartModel.trim(), simpleModel: simpleModel.trim(), smartThinking, simpleThinking, workspaceTools, confirmationMode, ...(apiKey && authMode !== 'none' && provider !== 'chatgpt' ? { apiKey } : {}) });
      const updated = await window.workspace.getAiSettings();
      applyConfiguration(updated); if (provider !== 'chatgpt') setApiKey('');
      setNotice(copy => copy.saved);
      void discover();
    } catch (reason) { setError((copy, locale) => formError(reason, copy.saveError, locale)); }
    finally { setBusy(false); }
  }

  async function removeKey() {
    setBusy(true); setError(''); setNotice('');
    try { await window.workspace.clearAiKey(); setConfiguration(current => current && ({ ...current, hasApiKey: false })); setNotice(copy => copy.keyRemoved); void discover(); }
    catch (reason) { setError((copy, locale) => formError(reason, copy.removeError, locale)); }
    finally { setBusy(false); }
  }

  const chatSummary = configuration ? `${providerLabels[provider]}${!configuration.configured ? ' · ' + copy.notConfigured : ''}${dirty ? ' · ' + copy.changes : ''}${error ? ' · ' + copy.error : ''}` : error ? copy.unavailable : copy.loading;
  return <section className="ai-settings" aria-label={copy.settings}>
    <details className="workspace-settings-group ai-chat-group" open={searching || chatOpen}>
      <summary onClick={event => { event.preventDefault(); setChatOpen(current => !current); }}><span><strong>Chat</strong><small>{chatSummary}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="workspace-settings-content">
    {!configuration && !error && <p className="ai-loading">{copy.loadingSettings}</p>}
    <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || busy || chatGptBusy} onApply={prepared.accept} onDismiss={prepared.dismiss} />
    {prepared.pending && dirty && <button className="ai-inline-button" type="button" disabled={busy || chatGptBusy} onClick={resetCurrentChanges}>{copy.discardMine}</button>}
    {configuration && <form className="ai-form" noValidate onSubmit={event => void save(event)}><fieldset className="ai-fields" disabled={busy || chatGptBusy}>
      <details className="ai-section" hidden={searching && !matches('connection')} open={groupOpen('connection')} onToggle={event => onGroupToggle('connection', event.currentTarget.open)}>
      <summary><span><strong>{copy.connection}</strong><small>{providerLabels[configuration.provider]} · {configuration.provider === 'chatgpt' ? chatGptStatus?.authenticated ? chatGptStatus.planAccess ? copy.activePlan : copy.noPlan : copy.signInRequired : <>{configuration.configured ? (() => { try { const url = new URL(configuration.baseUrl); return url.host || copy.savedEndpoint; } catch { return copy.savedEndpoint; } })() : copy.notConfigured} · {configuration.hasApiKey ? copy.keyStored : copy.noKey}</>}{connectionChanged ? ' · ' + copy.changes : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content">
      <div className="ai-field"><label htmlFor="ai-provider">{copy.provider}</label><select id="ai-provider" value={provider} onChange={event => changeProvider(event.target.value as Provider)}><option value="openai-compatible">{copy.compatibleLocal}</option><option value="openai">OpenAI</option><option value="azure">Azure AI Foundry / Azure OpenAI</option><option value="chatgpt">ChatGPT</option></select><p>{provider === 'azure' ? copy.azureHint : provider === 'chatgpt' ? copy.chatGptHint : provider === 'openai' ? copy.openAiHint : copy.compatibleHint}</p></div>
      {provider === 'chatgpt' ? <>
      {(chatGptStatus?.profiles.length ?? 0) > 1 && <div className="ai-field"><label htmlFor="ai-chatgpt-account">{copy.account}</label><select id="ai-chatgpt-account" value={chatGptStatus?.activeProfileId ?? ''} disabled={chatGptStatus?.loginPending} onChange={event => void selectChatGptProfile(event.target.value)}>{!chatGptStatus?.activeProfileId && <option value="" disabled>{copy.chooseAccount}</option>}{chatGptStatus?.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}{profile.authenticated ? '' : ' · ' + copy.signInAgain}</option>)}</select></div>}
      <div className="ai-chatgpt-status" role="status"><strong>{chatGptBusy ? copy.checkingAccount : chatGptStatus?.loginPending ? copy.finishLogin : chatGptStatus?.authenticated ? copy.signedIn : copy.disconnected}</strong>{chatGptStatus?.accountLabel && <span>{chatGptStatus.accountLabel}</span>}{chatGptStatus?.authenticated && <span>{chatGptStatus.planAccess ? copy.planActive : copy.planUnavailable}</span>}{chatGptStatus?.error && <p>{formDetail(chatGptStatus.error, locale)}</p>}</div>
      <div className="ai-chatgpt-actions">{chatGptStatus?.loginPending ? <button id="ai-chatgpt-cancel" className="ai-refresh" type="button" onClick={() => void endChatGptLogin(false)}>{copy.cancelLogin}</button> : <><button id="ai-chatgpt-login" className="ai-chatgpt-signin" type="button" data-oai-siwc-button="" onClick={() => void loginChatGpt()}>Continue with ChatGPT</button>{(chatGptStatus?.profiles.length ?? 0) > 0 && <button id="ai-chatgpt-add-account" className="ai-refresh" type="button" onClick={() => void loginChatGpt(true)}>{copy.addAccount}</button>}</>}<button id="ai-chatgpt-refresh" className="ai-refresh" type="button" onClick={() => void refreshChatGptStatus()}><RefreshCw size={14} /> {copy.checkStatus}</button>{chatGptStatus?.authenticated && <button id="ai-chatgpt-logout" className="ai-remove" type="button" onClick={() => void endChatGptLogin(true)}>{copy.logout}</button>}</div>
      {chatGptStatus?.authenticated && <button id="ai-chatgpt-usage" className="ai-inline-button" type="button" onClick={() => void manageChatGptUsage()}>{copy.manageUsage}</button>}
      {chatGptError && <p className="ai-feedback ai-error" role="alert">{chatGptError}</p>}
      </> : <>
      <div className="ai-field"><label htmlFor="ai-base-url">{copy.endpoint}</label><input ref={urlInput} id="ai-base-url" type="url" required autoComplete="off" spellCheck={false} value={baseUrl} onChange={event => { invalidateDiscovery(); setBaseUrl(event.target.value); }} placeholder={provider === 'azure' ? 'https://example.openai.azure.com/openai/v1' : 'https://api.openai.com/v1'} /><p>{provider === 'azure' ? copy.azureUrlHelp : copy.urlHelp}</p></div>
      <div className="ai-connection-options">
      <div className="ai-field"><label htmlFor="ai-protocol">{copy.protocol}</label><select id="ai-protocol" value={protocol} onChange={event => { invalidateDiscovery(); setProtocol(event.target.value as Protocol); }}><option value="chat-completions">Chat Completions</option><option value="responses">Responses API</option></select><p>{protocol === 'responses' ? copy.responsesHint : copy.completionsHint}</p></div>
      <div className="ai-field"><label htmlFor="ai-auth-mode">{copy.auth}</label><select id="ai-auth-mode" value={authMode} onChange={event => { invalidateDiscovery(); setAuthMode(event.target.value as AuthMode); }}><option value="bearer">{copy.bearer}</option><option value="api-key">{copy.keyHeader}</option><option value="none">{copy.noAuth}</option></select><p>{authMode === 'api-key' ? copy.keyHelp : authMode === 'none' ? copy.noAuthHelp : copy.bearerHelp}</p></div>
      </div>
      {provider === 'azure' && (legacyAzure || apiVersion) && <div className="ai-field"><label htmlFor="ai-api-version">{copy.apiVersion}</label><input id="ai-api-version" value={apiVersion} onChange={event => { invalidateDiscovery(); setApiVersion(event.target.value); }} spellCheck={false} autoComplete="off" placeholder={copy.versionExample} /><p>{copy.versionHelp}</p></div>}
      {authMode !== 'none' && <div className="ai-field"><div className="ai-label-line"><label htmlFor="ai-api-key">{copy.apiKey}</label><span className={`ai-key-status ${configuration.hasApiKey && !credentialChanged ? 'is-saved' : ''}`}><KeyRound size={12} />{credentialChanged ? copy.connectionKey : configuration.hasApiKey ? copy.stored : copy.noStoredKey}</span></div><input id="ai-api-key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={event => { invalidateDiscovery(); setApiKey(event.target.value); }} placeholder={configuration.hasApiKey && !credentialChanged ? copy.keepKey : copy.enterKey} /><p>{credentialChanged ? copy.keyByEndpoint : configuration.hasApiKey ? copy.replaceKey : copy.storeKey}</p></div>}
      {configuration.hasApiKey && !credentialChanged && <button className="ai-remove" type="button" disabled={busy} onClick={() => void removeKey()}><Trash2 size={14} /> {copy.removeKey}</button>}
      </>}
      </div></details>
      <details className="ai-section" hidden={searching && !matches('models')} open={groupOpen('models')} onToggle={event => onGroupToggle('models', event.currentTarget.open)}>
      <summary><span><strong>{copy.models}</strong><small>{copy.smart} {configuration.smartModel || copy.unset} {copy.simple} {configuration.simpleModel || copy.unset}{smartModel !== configuration.smartModel || simpleModel !== configuration.simpleModel || smartThinking !== configuration.smartThinking || simpleThinking !== configuration.simpleThinking ? ' · ' + copy.changes : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content">
      <div className="ai-models-heading"><p role="status">{discovering ? copy.loadingModels : models.length ? (locale === 'de' ? `${models.length.toLocaleString(locale)} ${models.length === 1 ? 'Modell' : 'Modelle'} gefunden` : `${models.length.toLocaleString(locale)} ${models.length === 1 ? 'model' : 'models'} found`) : copy.noModels}</p><button className="ai-refresh" type="button" disabled={busy || discovering || connectionChanged} onClick={() => void discover()}><RefreshCw size={14} /> {copy.refresh}</button></div>
      {connectionChanged && <p className="ai-model-hint">{copy.saveBeforeLoading}</p>}
      {discoveryError && !connectionChanged && <p className="ai-model-hint" role="status">{discoveryError}</p>}
      {!discoveryError && !discovering && models.length === 0 && <p className="ai-model-hint">{copy.manualHint}</p>}
      {provider === 'azure' && <p className="ai-model-hint">{copy.deploymentHint}</p>}
      <ModelField id="ai-smart-model" label={provider === 'azure' ? copy.smartDeployment : copy.smartModel} value={smartModel} onChange={setSmartModel} models={connectionChanged ? [] : models} deployment={provider === 'azure'} />
      <ThinkingField id="ai-smart-thinking" label={copy.smartThinking} value={smartThinking} onChange={setSmartThinking} />
      <ModelField id="ai-simple-model" label={provider === 'azure' ? copy.simpleDeployment : copy.simpleModel} value={simpleModel} onChange={setSimpleModel} models={connectionChanged ? [] : models} deployment={provider === 'azure'} />
      <ThinkingField id="ai-simple-thinking" label={copy.simpleThinking} value={simpleThinking} onChange={setSimpleThinking} />
      <p className="ai-model-hint">{copy.reasoningHint}</p>
      </div></details>
      <details className="ai-section" hidden={searching && !matches('workspace')} open={groupOpen('workspace')} onToggle={event => onGroupToggle('workspace', event.currentTarget.open)}>
      <summary><span><strong>{copy.access}</strong><small>{copy.tools} {configuration.workspaceTools ? copy.enabled : copy.disabled} · {configuration.confirmationMode === 'never' ? copy.without : copy.with}{workspaceTools !== configuration.workspaceTools || confirmationMode !== configuration.confirmationMode ? ' · ' + copy.changes : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content"><div className="setting-row ai-tool-row"><div><label htmlFor="workspace-tools">{copy.workspaceTools}</label><p>{copy.toolsHelp}</p></div><input id="workspace-tools" className="setting-toggle" type="checkbox" checked={workspaceTools} onChange={event => setWorkspaceTools(event.target.checked)} /></div>
      <div className="setting-row ai-confirmation-mode"><div><label htmlFor="ai-confirmation-mode">{copy.without}</label><p id="ai-confirmation-description">{copy.confirmationHelp}</p><p className="ai-setting-default">{copy.confirmationDefault}</p></div><input id="ai-confirmation-mode" className="setting-toggle" type="checkbox" aria-describedby="ai-confirmation-description" checked={confirmationMode === 'never'} onChange={event => setConfirmationMode(event.target.checked ? 'never' : 'ask')} /></div></div>
      </details>
      <div className="ai-actions"><span className="ai-save-hint">{dirty ? copy.unsaved : ''}</span><button className="ai-save" type="submit" disabled={busy || chatGptBusy || !dirty && configuration.configured}>{busy ? copy.saving : copy.save}</button></div>
    </fieldset></form>}
    {error && <p className="ai-feedback ai-error" role="alert">{error}</p>}
    {notice && <p className="ai-feedback ai-success" role="status">{notice}</p>}
      </div>
    </details>
    <dialog ref={planWelcome} className="ai-chatgpt-welcome" aria-labelledby="ai-chatgpt-welcome-title" onCancel={event => { event.preventDefault(); dismissPlanWelcome(); }}>
      <h2 id="ai-chatgpt-welcome-title">{copy.welcome}</h2><p>{copy.welcomeHelp}</p>{chatGptError && <p className="ai-error" role="alert">{chatGptError}</p>}<div><button className="ai-refresh" type="button" onClick={() => void manageChatGptUsage()}>{copy.usage}</button><button id="ai-chatgpt-welcome-close" className="ai-save" type="button" autoFocus onClick={dismissPlanWelcome}>{copy.done}</button></div>
    </dialog>
  </section>;
}

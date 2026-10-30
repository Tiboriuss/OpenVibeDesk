import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { matchesSettingsEntry, settingsEntries } from './settings-registry';
import { preparationValues, SettingsPreparationNotice, useSettingsPreparation, type SettingsSuggestion } from './settings-preparation';
import './ai-settings.css';

type Thinking = 'off' | 'low' | 'medium' | 'high';
type AiConfiguration = { baseUrl: string; smartModel: string; simpleModel: string; smartThinking: Thinking; simpleThinking: Thinking; workspaceTools: boolean; confirmationMode: 'ask' | 'never'; hasApiKey: boolean; configured: boolean };
type AiGroups = { connection: boolean; models: boolean; workspace: boolean };
const groupStorageKey = 'openvibedesk.settings.aiGroups';
function loadGroups(): AiGroups {
  const defaults = { connection: false, models: false, workspace: false };
  try {
    const value = JSON.parse(localStorage.getItem(groupStorageKey) ?? '{}');
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof value?.[key] === 'boolean' ? value[key] : fallback])) as AiGroups;
  } catch { return defaults; }
}

function ModelField({ id, label, value, onChange, models }: { id: string; label: string; value: string; onChange(value: string): void; models: string[] }) {
  const [manual, setManual] = useState(false);
  const custom = value && !models.includes(value);
  return <div className="ai-field"><label htmlFor={id}>{label}</label>
    {models.length > 0 && !manual ? <select id={id} value={value} onChange={event => {
      if (event.target.value === '__manual_model__') { setManual(true); onChange(''); }
      else onChange(event.target.value);
    }}><option value="">Modell auswählen</option>{custom && <option value={value}>{value} (manuell)</option>}{models.map(item => <option key={item} value={item}>{item}</option>)}<option value="__manual_model__">Andere Modell-ID eingeben …</option></select>
      : <input id={id} value={value} onChange={event => onChange(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Modell-ID eingeben" />}
    {manual && models.length > 0 && <button className="ai-inline-button" type="button" onClick={() => setManual(false)}>Aus Modellliste auswählen</button>}
  </div>;
}

function ThinkingField({ id, label, value, onChange }: { id: string; label: string; value: Thinking; onChange(value: Thinking): void }) {
  return <div className="ai-field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={event => onChange(event.target.value as Thinking)}><option value="off">Aus</option><option value="low">Niedrig</option><option value="medium">Mittel</option><option value="high">Hoch</option></select><p>Diese Stufe wird bei Auswahl dieses Modells verwendet. Die Unterstützung hängt vom Anbieter und Modell ab.</p></div>;
}

export function AiSettings({ searchQuery = '', onClearSearch, preparation }: { searchQuery?: string; onClearSearch?(): void; preparation?: SettingsSuggestion }) {
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
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
  const connectionChanged = urlChanged || apiKey.length > 0;
  const dirty = !!configuration && (connectionChanged || smartModel !== configuration.smartModel || simpleModel !== configuration.simpleModel || smartThinking !== configuration.smartThinking || simpleThinking !== configuration.simpleThinking || workspaceTools !== configuration.workspaceTools || confirmationMode !== configuration.confirmationMode);
  const prepared = useSettingsPreparation(preparation, !!configuration, !dirty && !busy, applyPreparation);
  useEffect(() => { if (preparation) setOpenGroups({ connection: true, models: true, workspace: true }); }, [preparation]);
  function applyPreparation(suggestion: SettingsSuggestion) {
    const values = preparationValues(suggestion);
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
    if (!configuration || busy) return;
    setBaseUrl(configuration.baseUrl); setSmartModel(configuration.smartModel); setSimpleModel(configuration.simpleModel);
    setSmartThinking(configuration.smartThinking); setSimpleThinking(configuration.simpleThinking);
    setWorkspaceTools(configuration.workspaceTools); setConfirmationMode(configuration.confirmationMode); setApiKey('');
    setError(''); setNotice('Eigene Änderungen verworfen. Der Vorschlag wartet auf deine Übernahme.');
  }
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
    window.workspace.setAiSettingsStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean');
    if (dirty || busy) window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, busy]);

  async function discover() {
    const id = ++discoveryId.current;
    setDiscovering(true); setDiscoveryError('');
    try { const found = await window.workspace.listAiModels(); if (id === discoveryId.current) setModels(found); }
    catch (reason) { if (id === discoveryId.current) { setModels([]); setDiscoveryError(`Modelle konnten nicht geladen werden: ${String(reason)}. Du kannst Modell-IDs manuell eingeben.`); } }
    finally { if (id === discoveryId.current) setDiscovering(false); }
  }

  useEffect(() => {
    let active = true;
    window.workspace.getAiSettings().then(value => {
      if (!active) return;
      setConfiguration({ ...value, confirmationMode: value.confirmationMode === 'never' ? 'never' : 'ask' }); setBaseUrl(value.baseUrl); setSmartModel(value.smartModel); setSimpleModel(value.simpleModel); setSmartThinking(value.smartThinking); setSimpleThinking(value.simpleThinking); setWorkspaceTools(value.workspaceTools); setConfirmationMode(value.confirmationMode === 'never' ? 'never' : 'ask');
      if (value.configured) void discover();
    }).catch(reason => { if (active) setError(`Einstellungen konnten nicht geladen werden: ${String(reason)}`); });
    return () => { active = false; discoveryId.current++; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (!urlInput.current?.checkValidity()) {
      onClearSearch?.();
      setOpenGroups(current => ({ ...current, connection: true }));
      setError('Bitte eine gültige Endpunkt-URL eingeben.');
      requestAnimationFrame(() => urlInput.current?.focus());
      return;
    }
    setBusy(true);
    try {
      await window.workspace.saveAiSettings({ baseUrl: baseUrl.trim(), smartModel: smartModel.trim(), simpleModel: simpleModel.trim(), smartThinking, simpleThinking, workspaceTools, confirmationMode, ...(apiKey ? { apiKey } : {}) });
      const updated = await window.workspace.getAiSettings();
      setConfiguration({ ...updated, confirmationMode: updated.confirmationMode === 'never' ? 'never' : 'ask' }); setBaseUrl(updated.baseUrl); setSmartModel(updated.smartModel); setSimpleModel(updated.simpleModel); setSmartThinking(updated.smartThinking); setSimpleThinking(updated.simpleThinking); setWorkspaceTools(updated.workspaceTools); setConfirmationMode(updated.confirmationMode === 'never' ? 'never' : 'ask'); setApiKey('');
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
    <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || busy} onApply={prepared.accept} onDismiss={prepared.dismiss} />
    {prepared.pending && dirty && <button className="ai-inline-button" type="button" disabled={busy} onClick={resetCurrentChanges}>Eigene Änderungen verwerfen</button>}
    {configuration && <form className="ai-form" noValidate onSubmit={event => void save(event)}><fieldset className="ai-fields" disabled={busy}>
      <details className="ai-section" hidden={searching && !matches('connection')} open={groupOpen('connection')} onToggle={event => onGroupToggle('connection', event.currentTarget.open)}>
      <summary><span><strong>Verbindung</strong><small>{configuration.configured ? (() => { try { const url = new URL(configuration.baseUrl); return url.host || 'Endpunkt gespeichert'; } catch { return 'Endpunkt gespeichert'; } })() : 'Nicht eingerichtet'} · {configuration.hasApiKey ? 'Schlüssel hinterlegt' : 'Kein Schlüssel'}{connectionChanged ? ' · Änderung offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content">
      <div className="ai-field"><label htmlFor="ai-base-url">Endpunkt-URL</label><input ref={urlInput} id="ai-base-url" type="url" required autoComplete="off" spellCheck={false} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /><p>Basis-URL des Anbieters, üblicherweise mit <code>/v1</code>.</p></div>
      <div className="ai-field"><div className="ai-label-line"><label htmlFor="ai-api-key">API-Schlüssel</label><span className={`ai-key-status ${configuration.hasApiKey && !urlChanged ? 'is-saved' : ''}`}><KeyRound size={12} />{urlChanged ? 'Je Endpunkt gespeichert' : configuration.hasApiKey ? 'Gespeichert' : 'Nicht hinterlegt'}</span></div><input id="ai-api-key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={configuration.hasApiKey && !urlChanged ? 'Leer lassen, um den Schlüssel zu behalten' : 'Optional, falls dein Anbieter einen Schlüssel verlangt'} /><p>{urlChanged ? 'Schlüssel sind je Endpunkt getrennt gespeichert.' : configuration.hasApiKey ? 'Ein neuer Wert ersetzt den gespeicherten Schlüssel des gewählten Endpunkts.' : 'Für lokale Endpunkte ohne Authentifizierung kann das Feld leer bleiben.'}</p></div>
      {configuration.hasApiKey && !urlChanged && <button className="ai-remove" type="button" disabled={busy} onClick={() => void removeKey()}><Trash2 size={14} /> Gespeicherten Schlüssel entfernen</button>}
      </div></details>
      <details className="ai-section" hidden={searching && !matches('models')} open={groupOpen('models')} onToggle={event => onGroupToggle('models', event.currentTarget.open)}>
      <summary><span><strong>Modelle</strong><small>Intelligent: {configuration.smartModel || 'nicht festgelegt'} · Einfach: {configuration.simpleModel || 'nicht festgelegt'}{smartModel !== configuration.smartModel || simpleModel !== configuration.simpleModel || smartThinking !== configuration.smartThinking || simpleThinking !== configuration.simpleThinking ? ' · Änderung offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content">
      <div className="ai-models-heading"><div><strong>Modelle</strong><p>{discovering ? 'Modelle werden geladen …' : models.length ? `${models.length} Modelle gefunden` : 'Keine Modelle geladen'}</p></div><button className="ai-refresh" type="button" disabled={busy || discovering || connectionChanged} onClick={() => void discover()}><RefreshCw size={14} /> Aktualisieren</button></div>
      {connectionChanged && <p className="ai-model-hint">Speichere zuerst die geänderte URL und den Schlüssel, um deren Modelle zu laden.</p>}
      {discoveryError && !connectionChanged && <p className="ai-model-hint" role="status">{discoveryError}</p>}
      {!discoveryError && !discovering && models.length === 0 && <p className="ai-model-hint">Speichere die Verbindung oder gib die Modell-IDs manuell ein.</p>}
      <ModelField id="ai-smart-model" label="Intelligentes Modell" value={smartModel} onChange={setSmartModel} models={connectionChanged ? [] : models} />
      <ThinkingField id="ai-smart-thinking" label="Thinking für intelligentes Modell" value={smartThinking} onChange={setSmartThinking} />
      <ModelField id="ai-simple-model" label="Einfaches Modell" value={simpleModel} onChange={setSimpleModel} models={connectionChanged ? [] : models} />
      <ThinkingField id="ai-simple-thinking" label="Thinking für einfaches Modell" value={simpleThinking} onChange={setSimpleThinking} />
      <p className="ai-model-hint">Bei „Aus“ wird kein Thinking-Parameter gesendet. Das Modell kann dennoch intern nachdenken.</p>
      </div></details>
      <details className="ai-section" hidden={searching && !matches('workspace')} open={groupOpen('workspace')} onToggle={event => onGroupToggle('workspace', event.currentTarget.open)}>
      <summary><span><strong>Workspace-Zugriff</strong><small>Werkzeuge {configuration.workspaceTools ? 'aktiviert' : 'deaktiviert'} · {configuration.confirmationMode === 'never' ? 'Ohne Abfragen' : 'Mit Bestätigungen'}{workspaceTools !== configuration.workspaceTools || confirmationMode !== configuration.confirmationMode ? ' · Änderung offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="ai-section-content"><div className="setting-row ai-tool-row"><div><label htmlFor="workspace-tools">Workspace-Werkzeuge</label><p>Der Assistent kann für deine Aufträge selbstständig in verfügbaren Modulen suchen, Inhalte lesen und Ansichten öffnen. Dafür muss das Modell Werkzeugaufrufe unterstützen.</p></div><input id="workspace-tools" className="setting-toggle" type="checkbox" checked={workspaceTools} onChange={event => setWorkspaceTools(event.target.checked)} /></div>
      <div className="setting-row ai-confirmation-mode"><div><label htmlFor="ai-confirmation-mode">Ohne Abfragen</label><p id="ai-confirmation-description">Suchen und Lesen laufen bereits selbstständig. Dieser Schalter überspringt auch Bestätigungen für angeforderte Aktionen wie Senden und Löschen. Neue oder geänderte Fremdmodule benötigen weiterhin deine Freigabe.</p><p className="ai-setting-default">Standard: Aus. Wirkt nach dem Speichern.</p></div><input id="ai-confirmation-mode" className="setting-toggle" type="checkbox" aria-describedby="ai-confirmation-description" checked={confirmationMode === 'never'} onChange={event => setConfirmationMode(event.target.checked ? 'never' : 'ask')} /></div></div>
      </details>
      <div className="ai-privacy"><ShieldCheck size={15} /><span>Der Schlüssel liegt im Zugangsdaten-Speicher des Systems.</span></div>
      <div className="ai-actions"><span className="ai-save-hint">{dirty ? 'Änderungen noch nicht gespeichert' : 'Änderungen werden mit Speichern übernommen.'}</span><button className="ai-save" type="submit" disabled={busy}>{busy ? 'Bitte warten …' : 'KI-Einstellungen speichern'}</button></div>
    </fieldset></form>}
    {error && <p className="ai-feedback ai-error" role="alert">{error}</p>}
    {notice && <p className="ai-feedback ai-success" role="status">{notice}</p>}
  </section>;
}

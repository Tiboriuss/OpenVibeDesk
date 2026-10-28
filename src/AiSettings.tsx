import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import './ai-settings.css';

type Thinking = 'off' | 'low' | 'medium' | 'high';
type AiConfiguration = { baseUrl: string; smartModel: string; simpleModel: string; smartThinking: Thinking; simpleThinking: Thinking; hasApiKey: boolean; configured: boolean };

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

export function AiSettings() {
  const [configuration, setConfiguration] = useState<AiConfiguration | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [smartModel, setSmartModel] = useState('');
  const [simpleModel, setSimpleModel] = useState('');
  const [smartThinking, setSmartThinking] = useState<Thinking>('off');
  const [simpleThinking, setSimpleThinking] = useState<Thinking>('off');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const discoveryId = useRef(0);
  const urlChanged = !!configuration && baseUrl.trim().replace(/\/+$/, '') !== configuration.baseUrl.replace(/\/+$/, '');
  const connectionChanged = urlChanged || apiKey.length > 0;

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
      setConfiguration(value); setBaseUrl(value.baseUrl); setSmartModel(value.smartModel); setSimpleModel(value.simpleModel); setSmartThinking(value.smartThinking); setSimpleThinking(value.simpleThinking);
      if (value.configured) void discover();
    }).catch(reason => { if (active) setError(`Einstellungen konnten nicht geladen werden: ${String(reason)}`); });
    return () => { active = false; discoveryId.current++; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await window.workspace.saveAiSettings({ baseUrl: baseUrl.trim(), smartModel: smartModel.trim(), simpleModel: simpleModel.trim(), smartThinking, simpleThinking, ...(apiKey ? { apiKey } : {}) });
      const updated = await window.workspace.getAiSettings();
      setConfiguration(updated); setBaseUrl(updated.baseUrl); setSmartModel(updated.smartModel); setSimpleModel(updated.simpleModel); setSmartThinking(updated.smartThinking); setSimpleThinking(updated.simpleThinking); setApiKey('');
      setNotice('KI-Einstellungen gespeichert.');
      void discover();
    } catch (reason) { setError(`Speichern fehlgeschlagen: ${String(reason)}`); }
    finally { setBusy(false); }
  }

  async function removeKey() {
    setBusy(true); setError(''); setNotice('');
    try { await window.workspace.clearAiKey(); setConfiguration(current => current && ({ ...current, hasApiKey: false })); setApiKey(''); setNotice('API-Schlüssel entfernt.'); void discover(); }
    catch (reason) { setError(`Schlüssel konnte nicht entfernt werden: ${String(reason)}`); }
    finally { setBusy(false); }
  }

  return <section className="settings-card ai-settings" aria-labelledby="ai-settings-heading">
    <div className="settings-card-heading"><Bot size={19} /><div><h2 id="ai-settings-heading">KI-Verbindung</h2><p>OpenAI-kompatibler Endpunkt für deinen Chat</p></div></div>
    {!configuration && !error && <p className="ai-loading">Einstellungen werden geladen …</p>}
    {configuration && <form className="ai-form" onSubmit={event => void save(event)}>
      <div className="ai-field"><label htmlFor="ai-base-url">Endpunkt-URL</label><input id="ai-base-url" type="url" required autoComplete="off" spellCheck={false} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /><p>Basis-URL des Anbieters, üblicherweise mit <code>/v1</code>.</p></div>
      <div className="ai-field"><div className="ai-label-line"><label htmlFor="ai-api-key">API-Schlüssel</label><span className={`ai-key-status ${configuration.hasApiKey && !urlChanged ? 'is-saved' : ''}`}><KeyRound size={12} />{urlChanged ? 'Je Endpunkt gespeichert' : configuration.hasApiKey ? 'Gespeichert' : 'Nicht hinterlegt'}</span></div><input id="ai-api-key" type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={configuration.hasApiKey && !urlChanged ? 'Leer lassen, um den Schlüssel zu behalten' : 'Optional, falls dein Anbieter einen Schlüssel verlangt'} /><p>{urlChanged ? 'Schlüssel sind je Endpunkt getrennt gespeichert.' : configuration.hasApiKey ? 'Ein neuer Wert ersetzt den gespeicherten Schlüssel des gewählten Endpunkts.' : 'Für lokale Endpunkte ohne Authentifizierung kann das Feld leer bleiben.'}</p></div>
      <div className="ai-models-heading"><div><strong>Modelle</strong><p>{discovering ? 'Modelle werden geladen …' : models.length ? `${models.length} Modelle gefunden` : 'Keine Modelle geladen'}</p></div><button className="ai-refresh" type="button" disabled={busy || discovering || connectionChanged} onClick={() => void discover()}><RefreshCw size={14} /> Aktualisieren</button></div>
      {connectionChanged && <p className="ai-model-hint">Speichere zuerst die geänderte URL und den Schlüssel, um deren Modelle zu laden.</p>}
      {discoveryError && !connectionChanged && <p className="ai-model-hint" role="status">{discoveryError}</p>}
      {!discoveryError && !discovering && models.length === 0 && <p className="ai-model-hint">Speichere die Verbindung oder gib die Modell-IDs manuell ein.</p>}
      <ModelField id="ai-smart-model" label="Intelligentes Modell" value={smartModel} onChange={setSmartModel} models={connectionChanged ? [] : models} />
      <ThinkingField id="ai-smart-thinking" label="Thinking für intelligentes Modell" value={smartThinking} onChange={setSmartThinking} />
      <ModelField id="ai-simple-model" label="Einfaches Modell" value={simpleModel} onChange={setSimpleModel} models={connectionChanged ? [] : models} />
      <ThinkingField id="ai-simple-thinking" label="Thinking für einfaches Modell" value={simpleThinking} onChange={setSimpleThinking} />
      <p className="ai-model-hint">Bei „Aus“ wird kein Thinking-Parameter gesendet. Das Modell kann dennoch intern nachdenken.</p>
      <div className="ai-actions"><button className="ai-save" type="submit" disabled={busy}>{busy ? 'Bitte warten …' : 'KI-Einstellungen speichern'}</button>{configuration.hasApiKey && !urlChanged && <button className="ai-remove" type="button" disabled={busy} onClick={() => void removeKey()}><Trash2 size={14} /> Schlüssel entfernen</button>}</div>
      <div className="ai-privacy"><ShieldCheck size={15} /><span>Der Schlüssel liegt im Zugangsdaten-Speicher des Systems. Der Chatverlauf und ausdrücklich referenzierte Chats oder E-Mails werden an den eingestellten Endpunkt gesendet.</span></div>
    </form>}
    {error && <p className="ai-feedback ai-error" role="alert">{error}</p>}
    {notice && <p className="ai-feedback ai-success" role="status">{notice}</p>}
  </section>;
}

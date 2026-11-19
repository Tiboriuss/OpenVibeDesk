import { speechProblemText } from './voice-copy';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { defaultSpeechSettings, speechProviders, speechSettingsInputSchema, type SpeechSettings as Preferences, type SpeechPublicSettings, type SpeechMode, type SpeechProvider } from '../shared/speech';
import { matchesSettingsEntry, speechSettingsEntry } from './settings-registry';
import { preparationValues, SettingsPreparationNotice, useSettingsPreparation, type SettingsSuggestion } from './settings-preparation';
import { uiText, useUiLocale } from './locale';
import { speechText } from './speech-copy';
import { settingsText } from './settings-copy';
import './speech-settings.css';

const fields = Object.keys(defaultSpeechSettings) as (keyof Preferences)[];
const preferences = (value: Preferences): Preferences => Object.fromEntries(fields.map(key => [key, value[key]])) as unknown as Preferences;
const groupKey = 'openvibedesk.settings.speechOpen';
function initialOpen() { try { return localStorage.getItem(groupKey) === 'true'; } catch { return false; } }

export function SpeechSettings({ preparation, searchQuery = '', navigationRequest = 0 }: { preparation?: SettingsSuggestion; searchQuery?: string; navigationRequest?: number }) {
  const locale = useUiLocale();
  const copy = speechText[locale];
  const summaryControl = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!navigationRequest) return;
    setOpen(true);
    const frame = requestAnimationFrame(() => {
      summaryControl.current?.focus();
      summaryControl.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigationRequest]);
  const [saved, setSaved] = useState<SpeechPublicSettings>();
  const [values, setValues] = useState<Preferences>(defaultSpeechSettings);
  const [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [open, setOpen] = useState(initialOpen), [reload, setReload] = useState(0);
  const [microphones, setMicrophones] = useState<{ id: string; label: string }[]>([]);
  const dirty = !!saved && (fields.some(field => values[field] !== saved[field]) || !!key || clearKey);
  const searching = !!searchQuery.trim();
  const visible = !searching || matchesSettingsEntry(speechSettingsEntry, searchQuery);
  const prepared = useSettingsPreparation(preparation, !!saved, !dirty && !busy, suggestion => {
    setValues(current => ({ ...current, ...preparationValues(suggestion) }));
    setOpen(true); setNotice(copy.prepared); setError('');
  });
  useEffect(() => {
    let active = true;
    void window.workspace.getSpeechSettings().then(value => { if (active) { setSaved(value); setValues(preferences(value)); setError(value.error ?? ''); } }).catch(() => { if (active) setError(copy.loadFailed); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    let active = true, changed = false;
    const unsubscribe = window.workspace.onSpeechMicrophones(devices => { changed = true; if (active) setMicrophones(devices); });
    void window.workspace.getSpeechMicrophones().then(devices => { if (active && !changed) setMicrophones(devices); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  useLayoutEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => event.preventDefault();
    window.workspace.setSpeechSettingsStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean');
    if (dirty || busy) window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [busy, dirty]);
  function update<K extends keyof Preferences>(field: K, value: Preferences[K]) { setValues(current => ({ ...current, [field]: value })); setError(''); setNotice(''); }
  function connection(provider: SpeechProvider, mode: SpeechMode) {
    const catalog = speechProviders[provider];
    const selected = catalog.modes.includes(mode) ? mode : catalog.modes[0];
    setValues(current => ({ ...current, provider, mode: selected, ...catalog.defaults[selected] }));
    setKey(''); setClearKey(false); setError(''); setNotice('');
  }
  function discard() { if (!saved) return; setValues(preferences(saved)); setKey(''); setClearKey(false); setError(saved.error ?? ''); setNotice(''); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!saved || busy) return;
    const parsed = speechSettingsInputSchema.safeParse({ ...values, ...(key ? { apiKey: key } : {}), ...(clearKey ? { clearApiKey: true } : {}) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? copy.check); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await window.workspace.saveSpeechSettings(parsed.data);
      setSaved(updated); setValues(preferences(updated)); setKey(''); setClearKey(false); setNotice(copy.saved); setError(updated.error ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : copy.saveFailed); }
    finally { setBusy(false); }
  }
  const provider = speechProviders[values.provider];
  const keyMatches = !!saved?.hasApiKey && saved.provider === values.provider && saved.authMode === values.authMode && (() => { try { return new URL(saved.endpoint).host === new URL(values.endpoint).host; } catch { return false; } })();
  const stateSummary = values.enabled
    ? [provider.label, values.mode === 'live' ? 'Live' : copy.after, !dirty && !saved?.configured && copy.notConfigured].filter(Boolean).join(' · ')
    : copy.off;
  const summary = error ? copy.check : saved ? [stateSummary, dirty && copy.edited].filter(Boolean).join(' · ') : settingsText[locale].loading;
  return <section className="speech-settings" hidden={!visible} aria-label={copy.settings}>
    <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || busy} onApply={prepared.accept} onDismiss={prepared.dismiss} />
    <details className="workspace-settings-group" open={searching || open}>
      <summary ref={summaryControl} onClick={event => { event.preventDefault(); const next = !open; setOpen(next); try { localStorage.setItem(groupKey, String(next)); } catch { /* Current window remains usable. */ } }}><span><strong>{copy.input}</strong><small>{summary}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="workspace-settings-content">
        {!saved && error && <button type="button" onClick={() => { setError(''); setReload(value => value + 1); }}>{copy.reload}</button>}
        {saved && <form onSubmit={event => void save(event)} noValidate><fieldset disabled={busy}>
          <label className="speech-toggle"><input id="speech-enabled" type="checkbox" checked={values.enabled} onChange={event => update('enabled', event.target.checked)} />{copy.enabled}</label>
          <div className="speech-settings-grid">
            <label>{copy.provider}<select id="speech-provider" value={values.provider} onChange={event => connection(event.target.value as SpeechProvider, values.mode)}>{Object.entries(speechProviders).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
            <label>{copy.transcription}<select id="speech-mode" value={values.mode} onChange={event => connection(values.provider, event.target.value as SpeechMode)}>{provider.modes.map(mode => <option key={mode} value={mode}>{mode === 'live' ? 'Live' : copy.after}</option>)}</select></label>
            <label className="speech-wide">{copy.endpoint}<input id="speech-endpoint" type="url" value={values.endpoint} spellCheck={false} placeholder={values.mode === 'live' ? 'wss://…' : 'https://…/audio/transcriptions'} onChange={event => update('endpoint', event.target.value)} /></label>
            {values.provider !== 'deepseek' && <label className="speech-wide">{copy.model}<input id="speech-model" value={values.model} spellCheck={false} onChange={event => update('model', event.target.value)} /></label>}
            <label>{copy.authentication}<select id="speech-auth" value={values.authMode} onChange={event => update('authMode', event.target.value as Preferences['authMode'])}><option value="bearer">{copy.bearer}</option><option value="api-key">{copy.keyHeader}</option><option value="none">{copy.noKey}</option></select></label>
            {values.authMode !== 'none' && <label>{copy.key}<input id="speech-key" type="password" autoComplete="new-password" value={key} placeholder={clearKey ? copy.removed : keyMatches ? copy.storedKey : copy.enterKey} onChange={event => { setKey(event.target.value); setClearKey(false); setNotice(''); setError(''); }} /></label>}
            <label>{copy.mic}<select id="speech-microphone" value={values.microphoneId} onChange={event => update('microphoneId', event.target.value)}><option value="">{copy.systemDefault}</option>{values.microphoneId && !microphones.some(item => item.id === values.microphoneId) && <option value={values.microphoneId}>{copy.savedMic}</option>}{microphones.map((item, index) => <option key={item.id} value={item.id}>{item.label || `${copy.mic} ${(index + 1).toLocaleString(locale)}`}</option>)}</select></label>
            {values.provider !== 'deepseek' && <label>{copy.language}<input id="speech-language" list="speech-languages" value={values.language} placeholder={copy.automatic} onChange={event => update('language', event.target.value)} /><datalist id="speech-languages"><option value="de">Deutsch</option><option value="en">English</option><option value="fr">Français</option><option value="es">Español</option><option value="it">Italiano</option></datalist></label>}
            {values.mode === 'live' && <label>{copy.protocol}<select id="speech-protocol" value={values.realtimeProtocol} onChange={event => update('realtimeProtocol', event.target.value as Preferences['realtimeProtocol'])}><option value="ga">Standard</option><option value="beta">Legacy / Beta</option></select></label>}
          </div>
          {saved.hasApiKey && <button type="button" className="speech-key-remove" onClick={() => { setClearKey(value => !value); setKey(''); setNotice(''); }}>{clearKey ? copy.keepKey : copy.removeKey}</button>}
          <div className="speech-settings-actions"><span role="status">{busy ? uiText[locale].saving : notice || (dirty ? copy.edited : '')}</span><button type="button" disabled={!dirty || busy} onClick={discard}><RefreshCw size={13} aria-hidden="true" /> {copy.discard}</button><button type="submit" className="speech-save" disabled={!dirty || busy}>{copy.save}</button></div>
        </fieldset></form>}
        {error && <p className="speech-settings-error" role="alert">{speechProblemText(error, locale)}</p>}
      </div>
    </details>
  </section>;
}

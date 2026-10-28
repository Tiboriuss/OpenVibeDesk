import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { agentSettingsBounds, agentSettingsSchema, defaultAgentSettings, normalizeAgentSettings, type AgentSettings as AgentPreferences } from '../shared/agent-settings';
import { matchesSettingsEntry, settingsEntries } from './settings-registry';
import { preparationValues, SettingsPreparationNotice, useSettingsPreparation, type SettingsSuggestion } from './settings-preparation';
import './agent-settings.css';

type Field = keyof AgentPreferences;
type Group = 'execution' | 'context' | 'transport';
type FormValues = Record<Field, string>;
type FieldDefinition = { key: Field; label: string; description: string; unit?: string };
const groupStorageKey = 'openvibedesk.settings.agentGroups';
const fields: Record<Group, FieldDefinition[]> = {
  execution: [
    { key: 'maxToolRounds', label: 'Werkzeugrunden', description: 'Maximale Runden pro Auftrag. Eine Runde kann mehrere Werkzeugaufrufe enthalten.' },
    { key: 'maxToolCalls', label: 'Werkzeugaufrufe', description: 'Gesamtzahl pro Auftrag, einschließlich Modulsuche und Fachaktionen.' },
    { key: 'timeoutSeconds', label: 'Maximale Laufzeit', description: 'Zeitlimit für den gesamten Auftrag einschließlich Werkzeugaufrufen.', unit: 'Sekunden' }
  ],
  context: [
    { key: 'maxActiveTools', label: 'Gleichzeitig geladene Werkzeuge', description: 'Wie viele gezielt geladene Modulwerkzeuge gleichzeitig für das Modell bereitstehen.' },
    { key: 'toolSchemaBudget', label: 'Budget für Werkzeugbeschreibungen', description: 'Obergrenze für das gesamte Werkzeugangebot inklusive Basiswerkzeugen, Beschreibungen und Eingabeschemas.', unit: 'Zeichen' },
    { key: 'historyMessageLimit', label: 'Ältere Nachrichten', description: 'Maximale Anzahl früherer Chatnachrichten im Kontext eines neuen Auftrags. 0 lässt den älteren Verlauf aus.' },
    { key: 'historyCharBudget', label: 'Textbudget für den Verlauf', description: 'Zeichenbudget für ältere Nachrichten. 0 lässt den älteren Verlauf aus; die aktuelle Nachricht und dafür gewählte Referenzen bleiben erhalten.', unit: 'Zeichen' }
  ],
  transport: [
    { key: 'requestTimeoutSeconds', label: 'Wartezeit pro Anbieteranfrage', description: 'Maximale Wartezeit ohne Streaming-Fortschritt oder auf eine Antwort ohne Streaming. Das Gesamtzeitlimit gilt zusätzlich.', unit: 'Sekunden' },
    { key: 'transportRetries', label: 'Wiederholungen bei Übertragungsfehlern', description: 'Wiederholt nur die Übertragung einer unvollständigen Werkzeugantwort. Fachaktionen werden nicht automatisch wiederholt.' }
  ]
};
const groupTitles: Record<Group, string> = { execution: 'Ausführung', context: 'Kontext', transport: 'Verbindung & Fehlerbehandlung' };
const groups: Group[] = ['execution', 'context', 'transport'];
const fieldKeys = Object.keys(defaultAgentSettings) as Field[];
const asForm = (values: AgentPreferences): FormValues => Object.fromEntries(fieldKeys.map(key => [key, String(values[key])])) as FormValues;
const formatted = (value: number): string => value.toLocaleString('de-DE');
function loadGroups(): Record<Group, boolean> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(groupStorageKey) ?? '{}');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) return Object.fromEntries(groups.map(group => [group, (stored as Record<string, unknown>)[group] === true])) as Record<Group, boolean>;
  } catch { /* Use compact groups if saved preferences are unavailable. */ }
  return { execution: false, context: false, transport: false };
}

export function AgentSettings({ preparation, searchQuery = '', onClearSearch }: { preparation?: SettingsSuggestion; searchQuery?: string; onClearSearch?(): void }) {
  const [saved, setSaved] = useState<AgentPreferences>();
  const [values, setValues] = useState<FormValues>(() => asForm(defaultAgentSettings));
  const [openGroups, setOpenGroups] = useState(loadGroups);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const dirty = !!saved && fieldKeys.some(key => values[key] !== String(saved[key]));
  const changedDefaults = fieldKeys.some(key => values[key] !== String(defaultAgentSettings[key]));
  const searching = !!searchQuery.trim();
  const matches = (group: Group) => matchesSettingsEntry(settingsEntries.find(entry => entry.id === `agent.${group}`)!, searchQuery);
  const prepared = useSettingsPreparation(preparation, !!saved, !dirty && !busy, applyPreparation);
  useEffect(() => {
    let active = true;
    void window.workspace.getAgentSettings().then(value => { if (active) { const normalized = normalizeAgentSettings(value); setSaved(normalized); setValues(asForm(normalized)); setError(''); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Agent-Einstellungen konnten nicht geladen werden.'); });
    return () => { active = false; };
  }, [reload]);
  useEffect(() => {
    try { localStorage.setItem(groupStorageKey, JSON.stringify(openGroups)); } catch { /* Current groups remain available in memory. */ }
  }, [openGroups]);
  useEffect(() => {
    if (preparation) setOpenGroups(current => Object.fromEntries(groups.map(group => [group, current[group] || fields[group].some(field => field.key in preparation.values)])) as Record<Group, boolean>);
  }, [preparation]);
  useLayoutEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.workspace.setAgentSettingsStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean');
    if (dirty || busy) window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [busy, dirty]);

  function applyPreparation(suggestion: SettingsSuggestion) {
    const incoming = preparationValues(suggestion);
    setValues(current => ({ ...current, ...Object.fromEntries(fieldKeys.flatMap(key => typeof incoming[key] === 'number' ? [[key, String(incoming[key])]] : [])) }));
    setError(''); setNotice('Vorschlag vorbereitet. Prüfe die Werte und speichere sie selbst. Der laufende Auftrag wurde nicht verändert.');
  }
  function update(key: Field, value: string) { setValues(current => ({ ...current, [key]: value })); setError(''); setNotice(''); }
  function discard() { if (!saved || busy) return; setValues(asForm(saved)); setError(''); setNotice('Änderungen verworfen.'); }
  function defaults() { setValues(asForm(defaultAgentSettings)); setError(''); setNotice('Standardwerte vorbereitet. Sie werden erst mit Speichern übernommen.'); }
  function summary(group: Group): string {
    const value = (key: Field) => values[key] ? Number(values[key]).toLocaleString('de-DE') : '–';
    if (group === 'execution') return `${value('maxToolRounds')} Runden · ${value('maxToolCalls')} Aufrufe · ${value('timeoutSeconds')} s`;
    if (group === 'context') return `${value('maxActiveTools')} Werkzeuge · ${value('historyMessageLimit')} ältere Nachrichten · ${value('historyCharBudget')} Zeichen`;
    return `${value('requestTimeoutSeconds')} s Anbieterwartezeit · ${value('transportRetries')} ${Number(values.transportRetries) === 1 ? 'Wiederholung' : 'Wiederholungen'}`;
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !saved) return;
    setError(''); setNotice('');
    if (!form.current?.checkValidity()) {
      const invalid = form.current?.querySelector<HTMLInputElement>('input:invalid');
      const group = invalid?.closest<HTMLDetailsElement>('[data-agent-group]')?.dataset.agentGroup as Group | undefined;
      onClearSearch?.();
      if (group) setOpenGroups(current => ({ ...current, [group]: true }));
      setError('Bitte ganze Zahlen innerhalb der angegebenen Grenzen eingeben.');
      requestAnimationFrame(() => { invalid?.focus(); invalid?.reportValidity(); });
      return;
    }
    const parsed = agentSettingsSchema.safeParse(Object.fromEntries(fieldKeys.map(key => [key, Number(values[key])])));
    if (!parsed.success) { setError('Bitte gültige Agent-Einstellungen innerhalb der angegebenen Grenzen eingeben.'); return; }
    setBusy(true);
    try {
      await window.workspace.saveAgentSettings(parsed.data);
      const updated = normalizeAgentSettings(await window.workspace.getAgentSettings());
      setSaved(updated); setValues(asForm(updated)); setNotice('Agent-Einstellungen gespeichert. Sie gelten für neue Aufträge.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent-Einstellungen konnten nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  return <section className="agent-settings" aria-label="Agent-Einstellungen">
    <p className="agent-settings-intro">Diese Grenzen gelten für neue Aufträge. Eine Änderung setzt einen gestoppten Auftrag nicht automatisch fort.</p>
    {!saved && !error && <p className="agent-settings-note" role="status">Agent-Einstellungen werden geladen …</p>}
    {!saved && error && <button type="button" className="agent-secondary" onClick={() => { setError(''); setReload(value => value + 1); }}>Erneut laden</button>}
    <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || busy} onApply={prepared.accept} onDismiss={prepared.dismiss} />
    {saved && <form className="agent-form" ref={form} noValidate onSubmit={event => void save(event)}><fieldset disabled={busy}>
      {groups.map(group => <details className="agent-section" data-agent-group={group} key={group} hidden={searching && !matches(group)} open={searching ? matches(group) : openGroups[group]} onToggle={event => { const open = event.currentTarget.open; if (!searching) setOpenGroups(current => current[group] === open ? current : { ...current, [group]: open }); }}>
        <summary><span><strong>{groupTitles[group]}</strong><small title={summary(group)}>{summary(group)}{fields[group].some(field => values[field.key] !== String(saved[field.key])) ? ' · Änderungen offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="agent-section-content">{fields[group].map(field => {
          const bounds = agentSettingsBounds[field.key], defaultValue = defaultAgentSettings[field.key];
          return <div className="agent-field" key={field.key}><div className="agent-field-description"><label htmlFor={`agent-${field.key}`}>{field.label}</label><p id={`agent-${field.key}-description`}>{field.description}</p><small>Standard: {formatted(defaultValue)}{field.unit ? ` ${field.unit}` : ''} · {formatted(bounds.min)}–{formatted(bounds.max)}</small></div><div className="agent-field-control"><input id={`agent-${field.key}`} name={field.key} type="number" required step={1} min={bounds.min} max={bounds.max} aria-describedby={`agent-${field.key}-description`} value={values[field.key]} onChange={event => update(field.key, event.target.value)} />{values[field.key] !== String(defaultValue) && <button type="button" className="agent-field-reset" title="Auf Standard zurücksetzen" aria-label={`${field.label} auf Standard zurücksetzen`} onClick={() => update(field.key, String(defaultValue))}><RotateCcw size={13} aria-hidden="true" /></button>}</div></div>;
        })}</div>
      </details>)}
      <div className="agent-default-actions"><button type="button" className="agent-reset" disabled={!changedDefaults} onClick={defaults}><RotateCcw size={13} aria-hidden="true" />Auf Standard zurücksetzen</button>{dirty && <button type="button" className="agent-discard" onClick={discard}>Änderungen verwerfen</button>}</div>
      <div className="agent-actions"><span className="agent-save-hint">{dirty ? 'Änderungen noch nicht gespeichert' : 'Änderungen werden mit Speichern übernommen.'}</span><button type="submit" className="agent-save" disabled={!dirty}>{busy ? 'Wird gespeichert …' : 'Agent-Einstellungen speichern'}</button></div>
    </fieldset></form>}
    {error && <p className="agent-feedback error" role="alert">{error}</p>}{notice && <p className="agent-feedback success" role="status">{notice}</p>}
  </section>;
}

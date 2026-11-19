import { useFormFeedback, formError } from './form-feedback';
import { agentFormText } from './agent-form-copy';
import { useUiLocale } from './locale';
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
function fieldLabels(copy: typeof agentFormText.en) {
  const fields: Record<Group, FieldDefinition[]> = {
    execution: [
      { key: 'maxToolRounds', label: copy.toolRounds, description: copy.roundsHelp },
      { key: 'maxToolCalls', label: copy.toolCalls, description: copy.callsHelp },
      { key: 'timeoutSeconds', label: copy.runtime, description: copy.runtimeHelp, unit: copy.seconds }
    ],
    context: [
      { key: 'contextTokenBudget', label: copy.context, description: copy.contextHelp, unit: copy.estimated },
      { key: 'outputTokenReserve', label: copy.reserve, description: copy.reserveHelp, unit: copy.tokens },
      { key: 'maxActiveTools', label: copy.activeTools, description: copy.activeToolsHelp },
      { key: 'toolSchemaBudget', label: copy.toolBudget, description: copy.toolBudgetHelp, unit: copy.characters },
      { key: 'historyMessageLimit', label: copy.history, description: copy.historyHelp },
      { key: 'historyCharBudget', label: copy.historyBudget, description: copy.historyBudgetHelp, unit: copy.characters }
    ],
    transport: [
      { key: 'requestTimeoutSeconds', label: copy.requestWait, description: copy.requestHelp, unit: copy.seconds },
      { key: 'transportRetries', label: copy.retries, description: copy.retriesHelp }
    ]
  };
  const groupTitles: Record<Group, string> = { execution: copy.execution, context: copy.contextGroup, transport: copy.transport };
  return { fields, groupTitles };
}
const groups: Group[] = ['execution', 'context', 'transport'];
const fieldKeys = Object.keys(defaultAgentSettings) as Field[];
const asForm = (values: AgentPreferences): FormValues => Object.fromEntries(fieldKeys.map(key => [key, String(values[key])])) as FormValues;
function loadGroups(): Record<Group, boolean> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(groupStorageKey) ?? '{}');
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) return Object.fromEntries(groups.map(group => [group, (stored as Record<string, unknown>)[group] === true])) as Record<Group, boolean>;
  } catch { /* Use compact groups if saved preferences are unavailable. */ }
  return { execution: false, context: false, transport: false };
}

export function AgentSettings({ preparation, searchQuery = '', onClearSearch }: { preparation?: SettingsSuggestion; searchQuery?: string; onClearSearch?(): void }) {
  const locale = useUiLocale();
  const copy = agentFormText[locale];
  const formatted = (value: number) => value.toLocaleString(locale);
  const { fields, groupTitles } = fieldLabels(copy);
  const [saved, setSaved] = useState<AgentPreferences>();
  const [values, setValues] = useState<FormValues>(() => asForm(defaultAgentSettings));
  const [openGroups, setOpenGroups] = useState(loadGroups);
  const [busy, setBusy] = useState(false), [error, setError] = useFormFeedback(copy, locale), [notice, setNotice] = useFormFeedback(copy, locale);
  const [reload, setReload] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const dirty = !!saved && fieldKeys.some(key => values[key] !== String(saved[key]));
  const changedDefaults = fieldKeys.some(key => values[key] !== String(defaultAgentSettings[key]));
  const searching = !!searchQuery.trim();
  const matches = (group: Group) => matchesSettingsEntry(settingsEntries.find(entry => entry.id === `agent.${group}`)!, searchQuery);
  const prepared = useSettingsPreparation(preparation, !!saved, !dirty && !busy, applyPreparation);
  useEffect(() => {
    let active = true;
    void window.workspace.getAgentSettings().then(value => { if (active) { const normalized = normalizeAgentSettings(value); setSaved(normalized); setValues(asForm(normalized)); setError(''); } }).catch(reason => { if (active) setError((copy, locale) => formError(reason, copy.loadError, locale)); });
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
    setError(''); setNotice(copy => copy.prepared);
  }
  function update(key: Field, value: string) { setValues(current => ({ ...current, [key]: value })); setError(''); setNotice(''); }
  function discard() { if (!saved || busy) return; setValues(asForm(saved)); setError(''); setNotice(copy => copy.discarded); }
  function defaults() { setValues(asForm(defaultAgentSettings)); setError(''); setNotice(copy => copy.defaultsReady); }
  function summary(group: Group): string {
    const value = (key: Field) => values[key] ? Number(values[key]).toLocaleString(locale) : '–';
    if (locale === 'en') {
      if (group === 'execution') return `${value('maxToolRounds')} ${Number(values.maxToolRounds) === 1 ? 'round' : 'rounds'} · ${value('maxToolCalls')} ${Number(values.maxToolCalls) === 1 ? 'call' : 'calls'} · ${value('timeoutSeconds')} s`;
      if (group === 'context') return `${value('contextTokenBudget')} estimated tokens · ${value('outputTokenReserve')} reserved`;
      return `${value('requestTimeoutSeconds')} s provider timeout · ${value('transportRetries')} ${Number(values.transportRetries) === 1 ? 'retry' : 'retries'}`;
    }
    if (group === 'execution') return `${value('maxToolRounds')} ${Number(values.maxToolRounds) === 1 ? 'Runde' : 'Runden'} · ${value('maxToolCalls')} ${Number(values.maxToolCalls) === 1 ? 'Aufruf' : 'Aufrufe'} · ${value('timeoutSeconds')} s`;
    if (group === 'context') return `${value('contextTokenBudget')} Tokens geschätzt · ${value('outputTokenReserve')} Antwortreserve`;
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
      setError(copy => copy.invalid);
      requestAnimationFrame(() => { invalid?.focus(); invalid?.reportValidity(); });
      return;
    }
    const parsed = agentSettingsSchema.safeParse(Object.fromEntries(fieldKeys.map(key => [key, Number(values[key])])));
    if (!parsed.success) {
      const issue = parsed.error.issues[0], field = String(issue?.path[0] ?? '') as Field;
      const group = groups.find(group => fields[group].some(item => item.key === field));
      onClearSearch?.();
      if (group) setOpenGroups(current => ({ ...current, [group]: true }));
      setError(copy => issue?.code === 'custom' && field === 'outputTokenReserve' ? copy.invalidReserve : copy.invalidSettings);
      requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>(`#agent-${field}`)?.focus());
      return;
    }
    setBusy(true);
    try {
      await window.workspace.saveAgentSettings(parsed.data);
      const updated = normalizeAgentSettings(await window.workspace.getAgentSettings());
      setSaved(updated); setValues(asForm(updated)); setNotice(copy => copy.saved);
    } catch (reason) { setError((copy, locale) => formError(reason, copy.saveError, locale)); }
    finally { setBusy(false); }
  }
  return <section className="agent-settings" aria-label={copy.settings}>
    {!saved && !error && <p className="agent-settings-note" role="status">{copy.loading}</p>}
    {!saved && error && <button type="button" className="agent-secondary" onClick={() => { setError(''); setReload(value => value + 1); }}>{copy.reload}</button>}
    <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || busy} onApply={prepared.accept} onDismiss={prepared.dismiss} />
    {saved && <form className="agent-form" ref={form} noValidate onSubmit={event => void save(event)}><fieldset disabled={busy}>
      {groups.map(group => <details className="agent-section" data-agent-group={group} key={group} hidden={searching && !matches(group)} open={searching ? matches(group) : openGroups[group]} onToggle={event => { const open = event.currentTarget.open; if (!searching) setOpenGroups(current => current[group] === open ? current : { ...current, [group]: open }); }}>
        <summary><span><strong>{groupTitles[group]}</strong><small title={summary(group)}>{summary(group)}{fields[group].some(field => values[field.key] !== String(saved[field.key])) ? ' · ' + copy.unsaved : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="agent-section-content">{fields[group].map(field => {
          const bounds = agentSettingsBounds[field.key], defaultValue = defaultAgentSettings[field.key];
          return <div className="agent-field" key={field.key}><div className="agent-field-description"><label htmlFor={`agent-${field.key}`}>{field.label}</label><p id={`agent-${field.key}-description`}>{field.description}</p><small>{copy.defaultValue} {formatted(defaultValue)}{field.unit ? ` ${field.unit}` : ''} · {formatted(bounds.min)}–{formatted(bounds.max)}</small></div><div className="agent-field-control"><input id={`agent-${field.key}`} name={field.key} type="number" required step={1} min={bounds.min} max={bounds.max} aria-describedby={`agent-${field.key}-description`} value={values[field.key]} onChange={event => update(field.key, event.target.value)} />{values[field.key] !== String(defaultValue) && <button type="button" className="agent-field-reset" title={copy.reset} aria-label={locale === 'de' ? `${field.label} auf Standard zurücksetzen` : `Reset ${field.label} to default`} onClick={() => update(field.key, String(defaultValue))}><RotateCcw size={13} aria-hidden="true" /></button>}</div></div>;
        })}</div>
      </details>)}
      <div className="agent-default-actions"><button type="button" className="agent-reset" disabled={!changedDefaults} onClick={defaults}><RotateCcw size={13} aria-hidden="true" />{copy.reset}</button>{dirty && <button type="button" className="agent-discard" onClick={discard}>{copy.discard}</button>}</div>
      <div className="agent-actions"><span className="agent-save-hint">{dirty ? copy.hint : ''}</span><button type="submit" className="agent-save" disabled={!dirty}>{busy ? copy.saving : copy.save}</button></div>
    </fieldset></form>}
    {error && <p className="agent-feedback error" role="alert">{error}</p>}{notice && <p className="agent-feedback success" role="status">{notice}</p>}
  </section>;
}

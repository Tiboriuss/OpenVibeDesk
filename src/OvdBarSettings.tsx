import { useFormFeedback, formError } from './form-feedback';
import { ovdBarText } from './ovd-bar-copy';
import { useUiLocale } from './locale';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import type { Settings } from '../shared/model';
import { defaultSettings } from '../shared/settings';
import { defaultBarSettings, resolveBarSettings, type BarSettings } from '../shared/ovd-bar';
import { barAppearanceEntry, barBehaviorEntry, matchesSettingsEntry } from './settings-registry';
import './ovd-bar-settings.css';

type Values = BarSettings & Pick<Settings, 'dockAlwaysOnTop'>;
type Group = 'appearance' | 'behavior';
const defaults: Values = { ...defaultBarSettings, dockAlwaysOnTop: defaultSettings.dockAlwaysOnTop };
const positionLabels = { de: { free: 'Frei', left: 'Links', right: 'Rechts', top: 'Oben', bottom: 'Unten' }, en: { free: 'Free', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' } };
const storageKey = 'openvibedesk.settings.ovdBar.groups';
function initialGroups(): Record<Group, boolean> {
  try { const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}'); return { appearance: value?.appearance !== false, behavior: value?.behavior === true }; }
  catch { return { appearance: true, behavior: false }; }
}

export function OvdBarSettings({ settings, searchQuery }: { settings: Settings; searchQuery: string }) {
  const locale = useUiLocale();
  const copy = ovdBarText[locale];
  const positions = positionLabels[locale];
  const percent = (ratio: number) => ratio.toLocaleString(locale, { style: 'percent', maximumFractionDigits: 0 });
  const [values, setValues] = useState<Values>(() => ({ ...resolveBarSettings(settings), dockAlwaysOnTop: settings.dockAlwaysOnTop }));
  const [groups, setGroups] = useState(initialGroups);
  const [searchGroups, setSearchGroups] = useState({ appearance: true, behavior: true });
  const [busy, setBusy] = useState(false), [error, setError] = useFormFeedback(copy, locale);
  const pending = useRef<Partial<Values>>({}), inFlight = useRef<Partial<Values>>({});
  const saving = useRef(false);
  const searching = !!searchQuery.trim();

  useEffect(() => { setValues({ ...resolveBarSettings(settings), dockAlwaysOnTop: settings.dockAlwaysOnTop, ...inFlight.current, ...pending.current }); }, [settings]);
  useEffect(() => { setSearchGroups({ appearance: true, behavior: true }); }, [searchQuery]);
  function toggle(group: Group) {
    if (searching) { setSearchGroups(current => ({ ...current, [group]: !current[group] })); return; }
    setGroups(current => { const next = { ...current, [group]: !current[group] }; try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep session state. */ } return next; });
  }
  async function flush() {
    if (saving.current || !Object.keys(pending.current).length) return;
    saving.current = true; setBusy(true); setError('');
    try {
      while (Object.keys(pending.current).length) {
        const patch = pending.current; pending.current = {}; inFlight.current = patch;
        try { await window.workspace.updateSettings(patch); }
        catch (reason) {
          pending.current = { ...patch, ...pending.current };
          setError((copy, locale) => formError(reason, copy.saveError, locale));
          break;
        } finally { inFlight.current = {}; }
      }
    } finally { saving.current = false; setBusy(false); }
  }
  function change(patch: Partial<Values>, commit = true) {
    pending.current = { ...pending.current, ...patch }; setValues(current => ({ ...current, ...patch }));
    if (commit) void flush();
  }
  const open = (group: Group) => searching ? searchGroups[group] : groups[group];
  const customized = (Object.keys(defaults) as (keyof Values)[]).some(key => values[key] !== defaults[key]);

  return <div className="ovd-bar-settings" aria-busy={busy}>
    <details className="workspace-settings-group" hidden={searching && !matchesSettingsEntry(barAppearanceEntry, searchQuery)} open={open('appearance')}>
      <summary onClick={event => { event.preventDefault(); toggle('appearance'); }}><span><strong>{copy.layout}</strong><small>{values.barOrientation === 'vertical' ? copy.vertical : copy.horizontal} · {positions[values.barPosition]} · {percent(values.barSize / 40)}</small></span><ChevronDown size={16} aria-hidden="true"/></summary>
      <div className="workspace-settings-content ovd-bar-setting-fields">
        <div className="ovd-bar-setting-row"><label htmlFor="ovd-bar-orientation">{copy.orientation}</label><select id="ovd-bar-orientation" value={values.barOrientation} onChange={event => change({ barOrientation: event.target.value as BarSettings['barOrientation'] })}><option value="vertical">{copy.vertical}</option><option value="horizontal">{copy.horizontal}</option></select></div>
        <div className="ovd-bar-setting-row"><label htmlFor="ovd-bar-position">Position</label><select id="ovd-bar-position" value={values.barPosition} onChange={event => change({ barPosition: event.target.value as BarSettings['barPosition'] })}>{Object.entries(positions).map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></div>
        <div className="ovd-bar-setting-row"><label htmlFor="ovd-bar-size">{copy.size}</label><div className="ovd-bar-range"><input id="ovd-bar-size" type="range" min={32} max={56} step={1} value={values.barSize} aria-valuetext={percent(values.barSize / 40)} onChange={event => change({ barSize: Number(event.target.value) }, false)} onPointerUp={() => void flush()} onPointerCancel={() => void flush()} onKeyUp={() => void flush()} onBlur={() => void flush()}/><output htmlFor="ovd-bar-size">{percent(values.barSize / 40)}</output></div></div>
        <div className="ovd-bar-setting-row"><label htmlFor="ovd-bar-opacity">{copy.opacity}</label><div className="ovd-bar-range"><input id="ovd-bar-opacity" type="range" min={70} max={100} step={1} value={values.barOpacity} aria-valuetext={percent(values.barOpacity / 100)} onChange={event => change({ barOpacity: Number(event.target.value) }, false)} onPointerUp={() => void flush()} onPointerCancel={() => void flush()} onKeyUp={() => void flush()} onBlur={() => void flush()}/><output htmlFor="ovd-bar-opacity">{percent(values.barOpacity / 100)}</output></div></div>
      </div>
    </details>
    <details className="workspace-settings-group" hidden={searching && !matchesSettingsEntry(barBehaviorEntry, searchQuery)} open={open('behavior')}>
      <summary onClick={event => { event.preventDefault(); toggle('behavior'); }}><span><strong>{copy.behavior}</strong><small>{values.dockAlwaysOnTop ? copy.above : copy.normal} · {values.barAutoHide ? copy.collapses : copy.expanded}</small></span><ChevronDown size={16} aria-hidden="true"/></summary>
      <div className="workspace-settings-content ovd-bar-setting-fields">
        <div className="ovd-bar-setting-row"><label htmlFor="ovd-bar-top">{copy.alwaysOnTop}</label><input id="ovd-bar-top" className="setting-toggle" type="checkbox" checked={values.dockAlwaysOnTop} onChange={event => change({ dockAlwaysOnTop: event.target.checked })}/></div>
        <div className="ovd-bar-setting-row"><label htmlFor="ovd-bar-auto-hide">{copy.autoHide}</label><input id="ovd-bar-auto-hide" className="setting-toggle" type="checkbox" checked={values.barAutoHide} onChange={event => change({ barAutoHide: event.target.checked })}/></div>
      </div>
    </details>
    {(customized || busy || error) && <div className="ovd-bar-settings-footer">{customized && <button type="button" className="settings-reset" onClick={() => change(defaults)}><RotateCcw size={13}/>{copy.restore}</button>}{busy && <small role="status">{copy.saving}</small>}</div>}
    {error && <div className="ovd-bar-settings-error" role="alert"><span>{error}</span><button type="button" onClick={() => void flush()}>{copy.retry}</button></div>}
  </div>;
}

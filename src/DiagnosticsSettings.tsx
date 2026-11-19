import { useFormFeedback } from './form-feedback';
import { diagnosticsText } from './diagnostics-copy';
import { useUiLocale } from './locale';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, RefreshCw, Trash2 } from 'lucide-react';
import type { DiagnosticsStatus } from '../shared/diagnostics';
import { matchesSettingsEntry, settingsEntries } from './settings-registry';
import './diagnostics-settings.css';

type Group = 'logging';
const storageKey = 'openvibedesk.settings.diagnosticsGroups';
function initialGroups(): Record<Group, boolean> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const value = raw as Record<string, unknown>;
      return { logging: value.logging === true };
    }
  } catch { /* Keep the groups usable when local storage is unavailable. */ }
  return { logging: false };
}
function formatBytes(value: number, locale: string): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  if (value >= 1024) return `${(value / 1024).toLocaleString(locale, { maximumFractionDigits: 1 })} KB`;
  return `${value.toLocaleString(locale)} B`;
}

export function DiagnosticsSettings({ active, enabled, searchQuery = '' }: { active: boolean; enabled: boolean; searchQuery?: string }) {
  const locale = useUiLocale();
  const copy = diagnosticsText[locale];
  const bytes = (value: number) => formatBytes(value, locale);
  const [status, setStatus] = useState<DiagnosticsStatus>();
  const [groups, setGroups] = useState(initialGroups);
  const [searchGroups, setSearchGroups] = useState<Record<Group, boolean>>({ logging: true });
  const [busy, setBusy] = useState<'toggle' | 'export' | 'clear'>();
  const [loading, setLoading] = useState(false), [error, setError] = useFormFeedback(copy, locale), [loadError, setLoadError] = useFormFeedback(copy, locale), [notice, setNotice] = useFormFeedback(copy, locale);
  const request = useRef(0), busyRef = useRef(false), mounted = useRef(true);
  const searching = !!searchQuery.trim();
  const matches = (group: Group) => !searching || matchesSettingsEntry(settingsEntries.find(entry => entry.id === `diagnostics.${group}`)!, searchQuery);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(groups)); } catch { /* The current session keeps its group state. */ }
  }, [groups]);
  useEffect(() => { if (searchQuery.trim()) setSearchGroups({ logging: true }); }, [searchQuery]);
  async function refresh(showLoading = false) {
    if (busyRef.current) return;
    const id = ++request.current;
    if (showLoading) setLoading(true);
    try {
      const value = await window.workspace.getDiagnosticsStatus();
      if (mounted.current && id === request.current) { setStatus(value); setLoadError(''); }
    } catch {
      if (mounted.current && id === request.current) setLoadError(copy => copy.loadError);
    } finally { if (mounted.current && id === request.current) setLoading(false); }
  }
  useEffect(() => {
    if (!active) return;
    void refresh(true);
    const timer = setInterval(() => void refresh(), 5000);
    return () => { clearInterval(timer); request.current++; };
  }, [active, enabled]);
  function toggleGroup(group: Group) {
    if (searching) setSearchGroups(current => ({ ...current, [group]: !current[group] }));
    else setGroups(current => ({ ...current, [group]: !current[group] }));
  }
  async function perform(operation: NonNullable<typeof busy>) {
    if (busyRef.current || !status) return;
    busyRef.current = true; request.current++; setLoading(false); setBusy(operation); setError(''); setNotice('');
    try {
      if (operation === 'toggle') {
        const next = await window.workspace.updateDiagnostics({ enabled: !status.enabled });
        if (mounted.current) { setStatus(next); setNotice(copy => next.enabled ? copy.enabled : copy.disabled); }
      } else if (operation === 'clear') {
        const next = await window.workspace.clearDiagnostics();
        if (mounted.current) { setStatus(next); setNotice(copy => copy.cleared); }
      } else {
        const result = await window.workspace.exportDiagnostics();
        if (mounted.current) setNotice((copy, locale) => result.cancelled ? copy.cancelled : result.fileName ? (locale === 'de' ? `Diagnoseprotokoll als „${result.fileName}“ exportiert.` : `Diagnostic log exported to “${result.fileName}”.`) : copy.exported);
      }
    } catch {
      if (mounted.current) setError(copy => operation === 'toggle' ? copy.toggleError : operation === 'clear' ? copy.clearError : copy.exportError);
    } finally { busyRef.current = false; if (mounted.current) setBusy(undefined); }
  }
  const summary = status ? `${status.enabled ? copy.on : copy.off} · ${status.entryCount.toLocaleString(locale)} ${status.entryCount === 1 ? copy.entry : copy.entries} · ${bytes(status.sizeBytes)}` : loading ? copy.loading : copy.unavailable;
  return <div className="diagnostics-settings">
    {(error || loadError) && <p className="diagnostics-feedback error" role="alert">{error || loadError}</p>}
    {notice && <p className="diagnostics-feedback" role="status">{notice}</p>}
    <details className="workspace-settings-group" hidden={!matches('logging')} open={searching ? searchGroups.logging : groups.logging}>
      <summary onClick={event => { event.preventDefault(); toggleGroup('logging'); }}><span><strong>{copy.log}</strong><small>{summary}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="workspace-settings-content">
        <div className="setting-row workspace-setting-row"><div><label htmlFor="diagnostics-enabled">{copy.enable}</label><p id="diagnostics-enabled-help">{copy.help}</p></div><input id="diagnostics-enabled" className="setting-toggle" type="checkbox" checked={status?.enabled ?? false} disabled={!status || !!busy} aria-describedby="diagnostics-enabled-help" onChange={() => void perform('toggle')} /></div>
        <div className="diagnostics-storage" aria-live="polite">
          {status && <><span>{status.entryCount.toLocaleString(locale)} {status.entryCount === 1 ? copy.entry : copy.entries} · {bytes(status.sizeBytes)}</span><span>{locale === 'de' ? `Maximal ${status.maxFiles} Dateien mit je ${bytes(status.maxFileBytes)}. Ältere Einträge werden automatisch ersetzt.` : `Up to ${status.maxFiles} files of ${bytes(status.maxFileBytes)} each. Older entries are replaced automatically.`}</span>{status.lastEventAt && <span>{copy.lastEntry} {new Date(status.lastEventAt).toLocaleString(locale)}</span>}</>}
          {status?.lastError === 'storage_unavailable' && <p className="diagnostics-feedback error" role="alert">{copy.storageError}</p>}
        </div>
        <div className="diagnostics-actions"><button type="button" disabled={!status || !!busy} onClick={() => void perform('export')}><Download size={14} aria-hidden="true" />{busy === 'export' ? copy.exporting : copy.export}</button><button type="button" disabled={!status || !!busy || !status.fileCount} onClick={() => void perform('clear')}><Trash2 size={14} aria-hidden="true" />{busy === 'clear' ? copy.clearing : copy.clear}</button><button type="button" disabled={!!busy || loading} onClick={() => void refresh(true)}><RefreshCw size={14} aria-hidden="true" />{loading ? copy.loading : copy.refresh}</button></div>
        <p className="diagnostics-help">{copy.reproduce}</p>
      </div>
    </details>
  </div>;
}

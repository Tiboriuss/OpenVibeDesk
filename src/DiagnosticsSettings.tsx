import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, RefreshCw, Trash2 } from 'lucide-react';
import type { DiagnosticsStatus } from '../shared/diagnostics';
import { matchesSettingsEntry, settingsEntries } from './settings-registry';
import './diagnostics-settings.css';

type Group = 'logging' | 'credentials';
const storageKey = 'openvibedesk.settings.diagnosticsGroups';
function initialGroups(): Record<Group, boolean> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const value = raw as Record<string, unknown>;
      return { logging: value.logging === true, credentials: value.credentials === true };
    }
  } catch { /* Keep the groups usable when local storage is unavailable. */ }
  return { logging: false, credentials: false };
}
function bytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  if (value >= 1024) return `${(value / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`;
  return `${value.toLocaleString('de-DE')} B`;
}

export function DiagnosticsSettings({ active, enabled, searchQuery = '' }: { active: boolean; enabled: boolean; searchQuery?: string }) {
  const [status, setStatus] = useState<DiagnosticsStatus>();
  const [groups, setGroups] = useState(initialGroups);
  const [searchGroups, setSearchGroups] = useState<Record<Group, boolean>>({ logging: true, credentials: true });
  const [busy, setBusy] = useState<'toggle' | 'export' | 'clear'>();
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [loadError, setLoadError] = useState(''), [notice, setNotice] = useState('');
  const request = useRef(0), busyRef = useRef(false), mounted = useRef(true);
  const searching = !!searchQuery.trim();
  const matches = (group: Group) => !searching || matchesSettingsEntry(settingsEntries.find(entry => entry.id === `diagnostics.${group}`)!, searchQuery);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(groups)); } catch { /* The current session keeps its group state. */ }
  }, [groups]);
  useEffect(() => { if (searchQuery.trim()) setSearchGroups({ logging: true, credentials: true }); }, [searchQuery]);
  useEffect(() => { if (!busyRef.current) setNotice(''); }, [enabled]);
  async function refresh(showLoading = false) {
    if (busyRef.current) return;
    const id = ++request.current;
    if (showLoading) setLoading(true);
    try {
      const value = await window.workspace.getDiagnosticsStatus();
      if (mounted.current && id === request.current) { setStatus(value); setLoadError(''); }
    } catch {
      if (mounted.current && id === request.current) setLoadError('Diagnosestatus konnte nicht geladen werden. Bitte erneut versuchen.');
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
        if (mounted.current) { setStatus(next); setNotice(next.enabled ? 'Diagnoseprotokoll aktiviert. Stelle den Fehler nach und exportiere anschließend das Protokoll.' : 'Diagnoseprotokoll deaktiviert. Vorhandene Einträge bleiben zum Export verfügbar.'); }
      } else if (operation === 'clear') {
        const next = await window.workspace.clearDiagnostics();
        if (mounted.current) { setStatus(next); setNotice('Diagnoseprotokoll geleert.'); }
      } else {
        const result = await window.workspace.exportDiagnostics();
        if (mounted.current) setNotice(result.cancelled ? 'Export abgebrochen.' : result.fileName ? `Diagnoseprotokoll als „${result.fileName}“ exportiert.` : 'Diagnoseprotokoll exportiert.');
      }
    } catch {
      if (mounted.current) setError(operation === 'toggle' ? 'Diagnoseeinstellung konnte nicht gespeichert werden. Der vorherige Zustand bleibt erhalten.' : operation === 'clear' ? 'Diagnoseprotokoll konnte nicht geleert werden.' : 'Diagnoseprotokoll konnte nicht exportiert werden.');
    } finally { busyRef.current = false; if (mounted.current) setBusy(undefined); }
  }
  const summary = status ? `${status.enabled ? 'Ein' : 'Aus'} · ${status.entryCount.toLocaleString('de-DE')} ${status.entryCount === 1 ? 'Eintrag' : 'Einträge'} · ${bytes(status.sizeBytes)}` : loading ? 'Wird geladen …' : 'Status nicht verfügbar';
  return <div className="diagnostics-settings">
    {(error || loadError) && <p className="diagnostics-feedback error" role="alert">{error || loadError}</p>}
    {notice && <p className="diagnostics-feedback" role="status">{notice}</p>}
    <details className="workspace-settings-group" hidden={!matches('logging')} open={searching ? searchGroups.logging : groups.logging}>
      <summary onClick={event => { event.preventDefault(); toggleGroup('logging'); }}><span><strong>Diagnoseprotokoll</strong><small>{summary}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="workspace-settings-content">
        <div className="setting-row workspace-setting-row"><div><label htmlFor="diagnostics-enabled">Diagnoseprotokoll aktivieren</label><p id="diagnostics-enabled-help">Zeichnet KI-Verbindungen, Antwortformate und Fehler auf. Nachrichten, Mailtexte, Werkzeugargumente, Passwörter und Tokens werden nicht protokolliert. Standard: Aus.</p></div><input id="diagnostics-enabled" className="setting-toggle" type="checkbox" checked={status?.enabled ?? false} disabled={!status || !!busy} aria-describedby="diagnostics-enabled-help" onChange={() => void perform('toggle')} /></div>
        <div className="diagnostics-storage" aria-live="polite">
          {status && <><span>{status.entryCount.toLocaleString('de-DE')} {status.entryCount === 1 ? 'Eintrag' : 'Einträge'} · {bytes(status.sizeBytes)}</span><span>Maximal {status.maxFiles} Dateien mit je {bytes(status.maxFileBytes)}. Ältere Einträge werden automatisch ersetzt.</span>{status.lastEventAt && <span>Letzter Eintrag: {new Date(status.lastEventAt).toLocaleString('de-DE')}</span>}</>}
          {status?.lastError === 'storage_unavailable' && <p className="diagnostics-feedback error" role="alert">Das Diagnoseprotokoll konnte nicht geschrieben werden. Prüfe, ob das lokale App-Profil beschreibbar ist.</p>}
        </div>
        <div className="diagnostics-actions"><button type="button" disabled={!status || !!busy} onClick={() => void perform('export')}><Download size={14} aria-hidden="true" />{busy === 'export' ? 'Wird exportiert …' : 'Protokoll exportieren'}</button><button type="button" disabled={!status || !!busy || !status.fileCount} onClick={() => void perform('clear')}><Trash2 size={14} aria-hidden="true" />{busy === 'clear' ? 'Wird geleert …' : 'Leeren'}</button><button type="button" disabled={!!busy || loading} onClick={() => void refresh(true)}><RefreshCw size={14} aria-hidden="true" />{loading ? 'Wird geladen …' : 'Aktualisieren'}</button></div>
        <p className="diagnostics-help">Aktiviere das Protokoll, stelle den Fehler nach und exportiere die Datei zum Weitergeben. Das Ein- und Ausschalten wird sofort gespeichert. Ein Export wird nur lokal gespeichert.</p>
      </div>
    </details>
    <details className="workspace-settings-group" hidden={!matches('credentials')} open={searching ? searchGroups.credentials : groups.credentials}>
      <summary onClick={event => { event.preventDefault(); toggleGroup('credentials'); }}><span><strong>Zugangsdaten</strong><small>Lokal gespeichert · ohne Schlüsselbundabfrage</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="workspace-settings-content diagnostics-credentials"><p>OVD speichert Passwörter und Tokens verschlüsselt im lokalen App-Profil. Der Schlüssel liegt ebenfalls lokal. Das vermeidet Schlüsselbundabfragen, bietet aber weniger Schutz als der macOS-Schlüsselbund.</p><p>Zuvor im Schlüsselbund gespeicherte Zugangsdaten werden nicht automatisch ausgelesen. Trage API-, Mail- und MCP-Zugangsdaten einmal neu ein oder melde dich bei OAuth-Verbindungen erneut an.</p></div>
    </details>
  </div>;
}

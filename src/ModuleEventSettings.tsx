import type { ModuleEventStatus, ModuleInfo } from '../shared/modules';

const topicLabels: Record<string, { title: string; description: string }> = {
  'chat.request.committed': { title: 'Neue Chat-Anfragen', description: 'Begrenzter Text einer neu gespeicherten Anfrage.' },
  'chat.turn.finished': { title: 'Beendete Chat-Aufträge', description: 'Begrenzte Antwort und tatsächlicher Abschlussstatus, auch bei Fehlern oder Abbruch.' }
};

/** Immediate, per-source opt-in; the receiving module owns any later processing. */
export function ModuleEventSettings({ module, status, busy, onChange }: {
  module: ModuleInfo;
  status?: ModuleEventStatus;
  busy: boolean;
  onChange(topics: string[]): void;
}) {
  const declared = module.manifest?.contributions.events?.subscriptions ?? [];
  const enabled = status?.enabledTopics ?? [];
  const summary = !status ? 'Wird geladen …' : [enabled.length ? `${enabled.length} ${enabled.length === 1 ? 'Quelle aktiv' : 'Quellen aktiv'}` : 'Aus', status.pending ? `${status.pending} ausstehend` : '', status.failed ? `${status.failed} mit Zustellfehler` : ''].filter(Boolean).join(' · ');
  return <details className="module-event-settings">
    <summary><strong>Ereignisse empfangen</strong><small>{summary}</small></summary>
    <div className="module-event-fields">
      <p>Wähle, welche neuen Ereignisse dieses Modul im Hintergrund verarbeiten darf. Änderungen werden sofort gespeichert.</p>
      <fieldset disabled={busy || !status || module.status !== 'ready'}>
        <legend className="visually-hidden">Ereignisquellen für {module.title}</legend>
        {declared.map(topic => <label className="module-event-source" key={topic}>
          <input type="checkbox" checked={enabled.includes(topic)} onChange={event => onChange(event.target.checked ? [...enabled, topic] : enabled.filter(value => value !== topic))} />
          <span><strong>{topicLabels[topic]?.title ?? topic}</strong>{topicLabels[topic] ? <small>{topicLabels[topic].description}</small> : <small>Vom Quellmodul bereitgestelltes Ereignis.</small>}</span>
        </label>)}
      </fieldset>
      {enabled.length > 0 && <button type="button" disabled={busy} onClick={() => onChange([])}>Alle Quellen deaktivieren</button>}
      {module.status !== 'ready' && <p>Das Modul muss einsatzbereit sein, um weitere Ereignisquellen zu aktivieren.</p>}
      {!!status?.pending && <p role="status">Die Zustellung erfolgt im Hintergrund. Deaktivierte Workspace-Werkzeuge pausieren die Verarbeitung.</p>}
      {status?.lastError && <p className="module-event-error" role="status">{status.lastError}</p>}
      {!!status?.failed && <p>Fehlgeschlagene Zustellungen werden mit Wartezeit erneut versucht.</p>}
    </div>
  </details>;
}

import { formDetail } from './form-feedback';
import { moduleEventText } from './module-event-copy';
import { useUiLocale } from './locale';
import type { ModuleEventStatus, ModuleInfo } from '../shared/modules';

/** Immediate, per-source opt-in; the receiving module owns any later processing. */
export function ModuleEventSettings({ module, status, busy, onChange }: {
  module: ModuleInfo;
  status?: ModuleEventStatus;
  busy: boolean;
  onChange(topics: string[]): void;
}) {
  const locale = useUiLocale();
  const copy = moduleEventText[locale];
  const topicLabels: Record<string, { title: string; description: string }> = {
    'chat.request.committed': { title: copy.newRequests, description: copy.requestDescription },
    'chat.turn.finished': { title: copy.finishedTasks, description: copy.turnDescription }
  };
  const declared = module.manifest?.contributions.events?.subscriptions ?? [];
  const enabled = status?.enabledTopics ?? [];
  const summary = !status ? copy.loading : [enabled.length ? `${enabled.length.toLocaleString(locale)} ${enabled.length === 1 ? copy.activeSource : copy.activeSources}` : copy.off, status.pending ? `${status.pending.toLocaleString(locale)} ${locale === 'de' ? 'ausstehend' : 'pending'}` : '', status.failed ? `${status.failed.toLocaleString(locale)} ${locale === 'de' ? 'mit Zustellfehler' : 'failed'}` : ''].filter(Boolean).join(' · ');
  return <details className="module-event-settings">
    <summary><strong>{copy.receive}</strong><small>{summary}</small></summary>
    <div className="module-event-fields">
      <p>{copy.choose}</p>
      <fieldset disabled={busy || !status || module.status !== 'ready'}>
        <legend className="visually-hidden">{copy.sourcesFor} {module.title}</legend>
        {declared.map(topic => <label className="module-event-source" key={topic}>
          <input type="checkbox" checked={enabled.includes(topic)} onChange={event => onChange(event.target.checked ? [...enabled, topic] : enabled.filter(value => value !== topic))} />
          <span><strong>{topicLabels[topic]?.title ?? topic}</strong>{topicLabels[topic] ? <small>{topicLabels[topic].description}</small> : <small>{copy.moduleEvent}</small>}</span>
        </label>)}
      </fieldset>
      {enabled.length > 0 && <button type="button" disabled={busy} onClick={() => onChange([])}>{copy.disableAll}</button>}
      {module.status !== 'ready' && <p>{copy.notReady}</p>}
      {!!status?.pending && <p role="status">{copy.pending}</p>}
      {status?.lastError && <p className="module-event-error" role="status">{formDetail(status.lastError, locale)}</p>}
      {!!status?.failed && <p>{copy.retry}</p>}
    </div>
  </details>;
}

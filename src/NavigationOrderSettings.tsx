import { useFormFeedback, formError } from './form-feedback';
import { navigationOrderText } from './navigation-order-copy';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, RotateCcw } from 'lucide-react';
import type { Settings } from '../shared/model';
import type { ModuleInfo } from '../shared/modules';
import { useUiLocale } from './locale';
import { mergeNavigationOrder } from '../shared/navigation';
import { moduleIcon, workspaceNavigation } from './module-registry';
import { matchesSettingsEntry, navigationOrderEntry } from './settings-registry';
import './navigation-order-settings.css';

const openStorageKey = 'openvibedesk.settings.navigationOrder.open';
function initialOpen() {
  try { return localStorage.getItem(openStorageKey) === 'true'; }
  catch { return false; }
}

export function NavigationOrderSettings({ settings, modules, loading, searchQuery }: {
  settings: Settings; modules: ModuleInfo[]; loading: boolean; searchQuery: string;
}) {
  const locale = useUiLocale();
  const copy = navigationOrderText[locale];
  const [open, setOpen] = useState(initialOpen);
  const [searchOpen, setSearchOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFormFeedback(copy, locale);
  const [status, setStatus] = useFormFeedback(copy, locale);
  const saving = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const summary = useRef<HTMLElement>(null);
  const restoreFocus = useRef<{ id?: string; direction?: 'up' | 'down' } | undefined>(undefined);
  const entries = workspaceNavigation(modules, settings.navigationOrder, locale);
  const searching = !!searchQuery.trim();
  const visible = !searching || matchesSettingsEntry(navigationOrderEntry, searchQuery);
  const customized = !!settings.navigationOrder?.length;

  useEffect(() => { setSearchOpen(true); }, [searchQuery]);
  useLayoutEffect(() => {
    if (busy || !restoreFocus.current) return;
    const target = restoreFocus.current;
    restoreFocus.current = undefined;
    if (!target.id) { summary.current?.focus(); return; }
    const row = [...(list.current?.querySelectorAll<HTMLLIElement>('li') ?? [])].find(item => item.dataset.entryId === target.id);
    const preferred = row?.querySelector<HTMLButtonElement>(`button[data-direction="${target.direction}"]`);
    (preferred && !preferred.disabled ? preferred : row?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
  }, [busy, settings.navigationOrder]);

  function toggle() {
    if (searching) { setSearchOpen(value => !value); return; }
    setOpen(value => {
      const next = !value;
      try { localStorage.setItem(openStorageKey, String(next)); } catch { /* Keep the open state for this session. */ }
      return next;
    });
  }
  async function save(order: string[], message: (copy: typeof navigationOrderText.en, language: typeof locale) => string, focus: { id?: string; direction?: 'up' | 'down' }) {
    if (saving.current || loading) return;
    saving.current = true; setBusy(true); setError(''); setStatus(''); restoreFocus.current = focus;
    try { await window.workspace.updateSettings({ navigationOrder: order }); setStatus(message); }
    catch (reason) { setError((copy, locale) => formError(reason, copy.saveError, locale)); }
    finally { saving.current = false; setBusy(false); }
  }
  function move(id: string, direction: 'up' | 'down') {
    const index = entries.findIndex(item => item.id === id);
    const destination = index + (direction === 'up' ? -1 : 1);
    if (index < 0 || destination < 0 || destination >= entries.length) return;
    const reordered = entries.map(item => item.id);
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    void save(mergeNavigationOrder(settings.navigationOrder, reordered), (_copy, locale) => (locale === 'de' ? `${entries[index].title} steht jetzt an Position ${destination + 1}.` : `Moved ${entries[index].title} to position ${destination + 1}.`), { id, direction });
  }

  return <details className="workspace-settings-group navigation-order-settings" hidden={!visible} open={searching ? searchOpen : open}>
    <summary ref={summary} onClick={event => { event.preventDefault(); toggle(); }}><span><strong>{copy.title}</strong><small>{loading ? copy.loading : `${entries.length.toLocaleString(locale)} ${locale === 'de' ? (entries.length === 1 ? 'Eintrag' : 'Einträge') : (entries.length === 1 ? 'item' : 'items')} · ${customized ? copy.custom : copy.standard}`}</small></span><ChevronDown size={16} aria-hidden="true"/></summary>
    <div className="workspace-settings-content navigation-order-content" aria-busy={busy}>
      <ol ref={list} className="navigation-order-list" aria-label={copy.order}>{entries.map((entry, index) => {
        const Icon = moduleIcon(entry.icon);
        const up = locale === 'de' ? `${entry.title} nach oben verschieben` : `Move ${entry.title} up`;
        const down = locale === 'de' ? `${entry.title} nach unten verschieben` : `Move ${entry.title} down`;
        return <li key={entry.id} data-entry-id={entry.id}><span className="navigation-order-position" aria-hidden="true">{index + 1}</span><Icon size={16} aria-hidden="true"/><span className="navigation-order-label"><strong>{entry.title}</strong><small>{entry.moduleTitle}</small></span><span className="navigation-order-actions"><button type="button" data-direction="up" disabled={busy || loading || index === 0} aria-label={up} title={up} onClick={() => move(entry.id, 'up')}><ArrowUp size={14} aria-hidden="true"/></button><button type="button" data-direction="down" disabled={busy || loading || index === entries.length - 1} aria-label={down} title={down} onClick={() => move(entry.id, 'down')}><ArrowDown size={14} aria-hidden="true"/></button></span></li>;
      })}</ol>
      <div className="navigation-order-footer"><button type="button" className="settings-reset" disabled={!customized || busy || loading} onClick={() => void save([], copy => copy.restored, {})}><RotateCcw size={13} aria-hidden="true"/>{copy.reset}</button><small>{busy ? copy.saving : error ? copy.failed : copy.immediate}</small></div>
      <div className="navigation-order-status" aria-live="polite">{status}</div>
      {error && <p className="navigation-order-error" role="alert">{error}</p>}
    </div>
  </details>;
}

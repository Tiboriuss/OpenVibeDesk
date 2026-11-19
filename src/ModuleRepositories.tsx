import { useFormFeedback, formError, formDetail } from './form-feedback';
import { settingsText } from './settings-copy';
import { repositoriesText } from './repositories-copy';
import { useUiLocale } from './locale';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Download, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import type { ModuleInfo } from '../shared/modules';
import type { ModuleRepositorySource, RepositoryState } from '../shared/module-repositories';
import { preparationValues, SettingsPreparationNotice, useSettingsPreparation, type SettingsSuggestion } from './settings-preparation';
import './module-repositories.css';

type EditStatus = 'clean' | 'dirty' | 'busy';
type SourceValues = { title: string; url: string; token: string; removeToken: boolean };
const emptyState: RepositoryState = { sources: [], modules: [], busy: false };
const emptyValues: SourceValues = { title: '', url: '', token: '', removeToken: false };
const sourceValues = (source?: ModuleRepositorySource): SourceValues => ({ title: source?.title ?? '', url: source?.url ?? '', token: '', removeToken: false });

function RepositoryEditor({ source, preparation, locked, onSave, onRemove, onStatus }: {
  source?: ModuleRepositorySource; preparation?: SettingsSuggestion; locked: boolean;
  onSave(input: { id?: string; title: string; url: string; token?: string; removeToken?: boolean }): Promise<RepositoryState>;
  onRemove(id: string): Promise<void>; onStatus(id: string, status: EditStatus | undefined): void;
}) {
  const locale = useUiLocale();
  const copy = repositoriesText[locale];
  const id = source?.id ?? 'new';
  const [values, setValues] = useState<SourceValues>(() => sourceValues(source));
  const [baseline, setBaseline] = useState<SourceValues>(() => sourceValues(source));
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useFormFeedback(copy, locale), [notice, setNotice] = useFormFeedback(copy, locale);
  const [removePending, setRemovePending] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const form = useRef<HTMLFormElement>(null);
  const sourceKey = JSON.stringify(sourceValues(source));
  useEffect(() => {
    if (dirty || busy || sourceKey === JSON.stringify(baseline)) return;
    const next = sourceValues(source); setBaseline(next); setValues(next);
  }, [sourceKey, source, baseline, dirty, busy]);
  const status = busy ? 'busy' : dirty ? 'dirty' : 'clean';
  useLayoutEffect(() => { onStatus(id, status); }, [id, status, onStatus]);
  useEffect(() => () => onStatus(id, undefined), [id, onStatus]);
  useEffect(() => { if (preparation) setOpen(true); }, [preparation]);
  const suggestion = useSettingsPreparation(preparation, !locked && !busy, !dirty && !locked && !busy, request => {
    const prepared = preparationValues(request);
    setValues(current => ({ ...current, ...(typeof prepared.title === 'string' ? { title: prepared.title } : {}), ...(typeof prepared.url === 'string' ? { url: prepared.url } : {}) }));
    setOpen(true); setError(''); setNotice(copy => copy.prepared);
  });
  function update(patch: Partial<SourceValues>) { setValues(current => ({ ...current, ...patch })); setError(''); setNotice(''); setRemovePending(false); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || busy || !form.current?.reportValidity()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await onSave({ ...(source ? { id: source.id } : {}), title: values.title.trim(), url: values.url.trim(), ...(values.token ? { token: values.token } : {}), ...(values.removeToken ? { removeToken: true } : {}) });
      const saved = source ? sourceValues(result.sources.find(item => item.id === source.id)) : { ...emptyValues };
      setValues(saved); setBaseline(saved); setRemovePending(false);
      setNotice(copy => source ? copy.saved : copy.added);
      if (!source) setOpen(false);
    } catch (reason) { setError((copy, locale) => formError(reason, copy.saveError, locale)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!source || dirty || busy || locked) return;
    setBusy(true); setError('');
    try { await onRemove(source.id); }
    catch (reason) { setError((copy, locale) => formError(reason, copy.removeError, locale)); }
    finally { setBusy(false); }
  }
  return <details className="repository-editor" open={open} onToggle={event => { if (event.target === event.currentTarget) setOpen(event.currentTarget.open); }}>
    <summary><span>{source ? <><strong>{source.title}</strong><small>{source.url}</small></> : <strong><Plus size={14} aria-hidden="true" /> {copy.addRepo}</strong>}</span><span className="repository-editor-state">{dirty ? copy.unsaved : source ? source.tokenConfigured ? copy.tokenSaved : copy.noToken : ''}<ChevronDown size={15} aria-hidden="true" /></span></summary>
    <form ref={form} onSubmit={event => void save(event)} data-repository-source={id} data-status={status}>
      <SettingsPreparationNotice suggestion={suggestion.pending} blocked={dirty || locked || busy} onApply={suggestion.accept} onDismiss={suggestion.dismiss} />
      <fieldset disabled={locked || busy}>
        <div className="repository-field"><label htmlFor={`repository-${id}-title`}>Name</label><input id={`repository-${id}-title`} value={values.title} required maxLength={120} placeholder={copy.example} onChange={event => update({ title: event.target.value })} /></div>
        <div className="repository-field"><label htmlFor={`repository-${id}-url`}>{copy.url}</label><input id={`repository-${id}-url`} type="url" value={values.url} required maxLength={2048} placeholder="https://github.com/Tiboriuss/OpenVibeDesk-Modules" spellCheck={false} onChange={event => update({ url: event.target.value })} /><p>{copy.urlHelp}</p></div>
        <div className="repository-field"><label htmlFor={`repository-${id}-token`}>{copy.token} <span>optional</span></label><input id={`repository-${id}-token`} type="password" autoComplete="new-password" maxLength={4096} value={values.token} disabled={values.removeToken} placeholder={source?.tokenConfigured ? copy.keepToken : copy.privateToken} onChange={event => update({ token: event.target.value })} /><p>{copy.tokenHelp}</p></div>
        {source?.tokenConfigured && <label className="repository-checkbox"><input type="checkbox" checked={values.removeToken} onChange={event => update({ removeToken: event.target.checked, token: '' })} /> {copy.removeToken}</label>}
        <div className="repository-form-actions">{source && <button type="button" className="repository-remove" disabled={dirty} onClick={() => setRemovePending(true)}><Trash2 size={13} aria-hidden="true" /> {copy.removeSource}</button>}<span />{dirty && <button type="button" onClick={() => { setValues(baseline); setError(''); setNotice(copy => copy.discarded); setRemovePending(false); }}>{copy.discard}</button>}<button type="submit" className="repository-primary" disabled={!dirty}>{busy ? copy.saving : source ? copy.save : copy.add}</button></div>
      </fieldset>
      {removePending && <div className="repository-remove-confirm" role="status"><p>{copy.confirmRemove}</p><div><button type="button" disabled={locked || busy} onClick={() => void remove()}>{copy.removeNow}</button><button type="button" disabled={locked || busy} onClick={() => setRemovePending(false)}>{copy.cancel}</button></div></div>}
      {error && <p className="repository-feedback error" role="alert">{error}</p>}{notice && <p className="repository-feedback" role="status">{notice}</p>}
    </form>
  </details>;
}

export function ModuleRepositories({ preparation, installedModules, moduleBusy, onActivate, searchQuery = '' }: {
  preparation?: SettingsSuggestion; installedModules: ModuleInfo[]; moduleBusy: boolean; onActivate(id: string): Promise<void>; searchQuery?: string;
}) {
  const locale = useUiLocale();
  const copy = repositoriesText[locale];
  const installedStatusLabels = settingsText[locale].status;
  const [state, setState] = useState<RepositoryState>(emptyState);
  const [loading, setLoading] = useState(true), [operation, setOperation] = useState('');
  const [error, setError] = useFormFeedback(copy, locale), [notice, setNotice] = useFormFeedback(copy, locale);
  const [statuses, setStatuses] = useState<Record<string, EditStatus>>({});
  const [sourceFilter, setSourceFilter] = useState(''), [query, setQuery] = useState('');
  const [sourcesOpen, setSourcesOpen] = useState(false), [catalogOpen, setCatalogOpen] = useState(false);
  const [searchGroups, setSearchGroups] = useState({ sources: true, catalog: true });
  const searching = !!searchQuery.trim();
  useEffect(() => { if (searching) setSearchGroups({ sources: true, catalog: true }); }, [searchQuery]);
  const mounted = useRef(true), loadVersion = useRef(0);
  const setEditorStatus = useCallback((id: string, status: EditStatus | undefined) => setStatuses(current => {
    if (current[id] === status) return current;
    const next = { ...current }; if (status) next[id] = status; else delete next[id]; return next;
  }), []);
  const acceptState = useCallback((next: RepositoryState) => { if (mounted.current) { setState(next); setLoading(false); } return next; }, []);
  const reload = useCallback(async () => {
    const version = ++loadVersion.current;
    try { const result = await window.workspace.getModuleRepositories(); if (mounted.current && version === loadVersion.current) { acceptState(result); setError(''); } }
    catch (reason) { if (mounted.current && version === loadVersion.current) { setError((copy, locale) => formError(reason, copy.sourcesError, locale)); setLoading(false); } }
  }, [acceptState]);
  useEffect(() => {
    mounted.current = true; void reload();
    const stop = window.workspace.onModuleRepositoriesChanged(() => void reload());
    const stopModules = window.workspace.onModulesChanged(() => void reload());
    return () => { mounted.current = false; stop(); stopModules(); };
  }, [reload]);
  const busy = state.busy || !!operation || Object.values(statuses).includes('busy');
  const dirty = Object.values(statuses).includes('dirty');
  const blocked = busy || !!state.error;
  useLayoutEffect(() => { window.workspace.setModuleRepositorySettingsStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean'); }, [busy, dirty]);
  useLayoutEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    if (dirty || busy) window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, busy]);
  useEffect(() => () => window.workspace.setModuleRepositorySettingsStatus('clean'), []);
  useEffect(() => { if (preparation) setSourcesOpen(true); }, [preparation]);
  useEffect(() => { if (sourceFilter && !state.sources.some(source => source.id === sourceFilter)) setSourceFilter(''); }, [sourceFilter, state.sources]);
  async function refresh(sourceId?: string) {
    if (blocked) return;
    setOperation(sourceId ? `refresh:${sourceId}` : 'refresh'); setError(''); setNotice('');
    try { acceptState(await window.workspace.refreshModuleRepositories(sourceId)); }
    catch (reason) { setError((copy, locale) => formError(reason, copy.catalogError, locale)); }
    finally { setOperation(''); }
  }
  async function install(sourceId: string, moduleId: string, version: string) {
    if (blocked || moduleBusy) return;
    setOperation(`install:${sourceId}:${moduleId}`); setError(''); setNotice('');
    try {
      await window.workspace.installRepositoryModule({ sourceId, moduleId, version }); await reload();
      setNotice((copy, locale) => locale === 'de' ? `${moduleId} ${version} ist installiert. Zur Ausführung bitte freigeben und aktivieren.` : `${moduleId} ${version} installed. Approve and enable it to use it.`);
    } catch (reason) { setError((copy, locale) => formError(reason, copy.installError, locale)); }
    finally { setOperation(''); }
  }
  async function save(input: { id?: string; title: string; url: string; token?: string; removeToken?: boolean }) {
    setOperation('save'); setError(''); setNotice('');
    try { const next = acceptState(await window.workspace.saveModuleRepository(input)); setNotice(copy => copy.sourceReady); return next; }
    finally { setOperation(''); }
  }
  async function remove(id: string) {
    setOperation('remove'); setError(''); setNotice('');
    try { acceptState(await window.workspace.removeModuleRepository(id)); setNotice(copy => copy.removed); }
    finally { setOperation(''); }
  }
  const filtered = state.modules.filter(item => (!sourceFilter || item.sourceId === sourceFilter) && `${item.title} ${item.id} ${item.description}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale).trim()));
  const updates = state.modules.filter(item => item.status === 'update').length;
  const preparedSource = typeof preparation?.values.sourceId === 'string' ? preparation.values.sourceId : undefined;
  return <div className="module-repositories">
    {loading && <p role="status">{copy.loadingSources}</p>}
    {(error || state.error) && <p className="repository-feedback error" role="alert">{error || formDetail(state.error, locale)}</p>}{notice && <p className="repository-feedback" role="status">{notice}</p>}
    <details className="workspace-settings-group" open={searching ? searchGroups.sources : sourcesOpen}>
      <summary onClick={event => { event.preventDefault(); if (searching) setSearchGroups(current => ({ ...current, sources: !current.sources })); else setSourcesOpen(value => !value); }}><span><strong>{copy.sources}</strong><small>{state.sources.length.toLocaleString(locale)} {state.sources.length === 1 ? copy.repository : copy.repositories}{dirty ? ' · ' + copy.changes : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="repository-sources">
        {state.sources.map(source => <RepositoryEditor key={source.id} source={source} preparation={preparedSource === source.id ? preparation : undefined} locked={blocked || moduleBusy} onSave={save} onRemove={remove} onStatus={setEditorStatus} />)}
        <RepositoryEditor preparation={!preparedSource ? preparation : undefined} locked={loading || blocked || moduleBusy} onSave={save} onRemove={remove} onStatus={setEditorStatus} />
        {preparedSource && !loading && !state.sources.some(source => source.id === preparedSource) && <p className="repository-feedback error" role="alert">{copy.missingSource}</p>}
      </div>
    </details>
    <details className="workspace-settings-group" open={searching ? searchGroups.catalog : catalogOpen}>
      <summary onClick={event => { event.preventDefault(); if (searching) setSearchGroups(current => ({ ...current, catalog: !current.catalog })); else setCatalogOpen(value => !value); }}><span><strong>{copy.catalog}</strong><small>{state.modules.length.toLocaleString(locale)} {state.modules.length === 1 ? copy.module : copy.modules}{updates > 0 ? ` · ${updates.toLocaleString(locale)} ${updates === 1 ? copy.updateNoun : copy.updatesNoun} ${locale === 'de' ? 'verfügbar' : 'available'}` : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="repository-catalog">
        <div className="repository-catalog-toolbar"><input type="search" value={query} placeholder={copy.search} aria-label={copy.searchLabel} onChange={event => setQuery(event.target.value)} /><select aria-label={copy.filter} value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="">{copy.allSources}</option>{state.sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select><button type="button" disabled={loading || blocked || !state.sources.length} onClick={() => void refresh(sourceFilter || undefined)}><RefreshCw size={14} aria-hidden="true" />{operation.startsWith('refresh') ? copy.loading : copy.load}</button></div>
        <div className="repository-source-statuses">{state.sources.filter(source => !sourceFilter || source.id === sourceFilter).map(source => <div key={source.id} className={source.status === 'error' ? 'error' : ''}><span><strong>{source.title}</strong> · {source.status === 'unloaded' ? copy.unloaded : source.status === 'loading' ? copy.loading : source.status === 'error' ? formDetail(source.error, locale) || copy.unavailable : `${source.moduleCount.toLocaleString(locale)} ${source.moduleCount === 1 ? copy.module : copy.modules}`}{source.checkedAt && <small>{copy.checked} {new Date(source.checkedAt).toLocaleString(locale)}</small>}</span>{source.status !== 'loading' && <button type="button" disabled={blocked} aria-label={locale === 'de' ? `Katalog von ${source.title} laden` : `Load catalog from ${source.title}`} title={copy.load} onClick={() => void refresh(source.id)}><RefreshCw size={13} aria-hidden="true" /></button>}</div>)}</div>
        {filtered.length === 0 && <p className="repository-empty" role="status">{!state.sources.length ? copy.addFirst : query.trim() ? copy.noMatches : state.sources.some(source => (!sourceFilter || source.id === sourceFilter) && source.status === 'unloaded') ? copy.loadFirst : state.sources.some(source => (!sourceFilter || source.id === sourceFilter) && source.status === 'error') ? copy.checkAccess : copy.empty}</p>}
        <div className="repository-module-list">{filtered.map(item => {
          const installed = installedModules.find(module => module.id === item.id);
          const source = state.sources.find(source => source.id === item.sourceId);
          const installable = item.status === 'available' || item.status === 'update';
          const canActivate = item.status === 'installed' && installed && ['approval_required', 'disabled'].includes(installed.status);
          const installing = operation === `install:${item.sourceId}:${item.id}`;
          return <article className="repository-module" key={`${item.sourceId}:${item.id}`}><div><strong>{item.title}</strong><small>{item.id} · {item.version} · {source?.title ?? copy.source}</small><p>{item.description}</p><span className={`repository-module-state ${item.status}`}>{item.status === 'available' ? copy.available : item.status === 'update' ? locale === 'de' ? `Update von ${item.installedVersion} auf ${item.version}` : `Update from ${item.installedVersion} to ${item.version}` : item.status === 'installed' ? `${copy.installed} · ${installed ? installedStatusLabels[installed.status] : copy.loadingModule}` : item.status === 'incompatible' ? copy.incompatible : copy.conflict}</span>{item.reason && <p>{formDetail(item.reason, locale)}</p>}{item.status === 'installed' && installed?.reason && installed.reason !== item.reason && <p>{formDetail(installed.reason, locale)}</p>}</div>{installable && <button type="button" className="repository-primary" disabled={blocked || moduleBusy || source?.status !== 'ready'} onClick={() => void install(item.sourceId, item.id, item.version)}><Download size={13} aria-hidden="true" />{installing ? copy.installing : item.status === 'update' ? copy.update : copy.install}</button>}{canActivate && <button type="button" disabled={blocked || moduleBusy} onClick={() => void onActivate(item.id)}><ShieldCheck size={13} aria-hidden="true" />{installed.status === 'approval_required' ? copy.approve : copy.enable}</button>}</article>;
        })}</div>
        {state.modules.length > 0 && <p className="repository-catalog-note">{copy.approvalInfo}</p>}
      </div>
    </details>
  </div>;
}

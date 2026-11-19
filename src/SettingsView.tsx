import { useEffect, useRef, useState } from 'react';
import { Activity, Bot, ChevronDown, Monitor, Package, PanelsTopLeft, RotateCcw, Search, Settings, Workflow, X } from 'lucide-react';
import { SettingsChoiceRow } from './SettingsChoiceRow';
import { SpeechSettings } from './SpeechSettings';
import { AiSettings } from './AiSettings';
import { AgentSettings } from './AgentSettings';
import { DiagnosticsSettings } from './DiagnosticsSettings';
import { NavigationOrderSettings } from './NavigationOrderSettings';
import { OvdBarSettings } from './OvdBarSettings';
import { coreSettingsCategories, settingsEntries, matchesSettingsEntry, type SettingsCategoryId, type SettingsCategory, type SettingsEntry } from './settings-registry';
import { uiText, useUiLocale } from './locale';
import { settingsText } from './settings-copy';
import { formDetail, useFormFeedback } from './form-feedback';
import type { LanguagePreference } from '../shared/locale';
import { defaultSettings } from '../shared/settings';
import type { Settings as WorkspaceSettings } from '../shared/model';
import type { SettingsSuggestion } from './settings-preparation';
import { moduleIcon, moduleSettings, useWorkspaceModules } from './module-registry';
import './settings-view.css';
import { ModuleAttentionDot, useModuleAttention } from './ModuleAttentionDot';
import { ModuleRepositories } from './ModuleRepositories';
import { ModuleEventSettings } from './ModuleEventSettings';
import type { ModuleEventStatus } from '../shared/modules';

const groupStorageKey = 'openvibedesk.settings.groups';
const icons = { ai: Bot, agent: Workflow, display: Monitor, dock: PanelsTopLeft, diagnostics: Activity, modules: Package };

function initialInstalledOpen(): boolean {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(groupStorageKey) ?? '{}');
    if (stored && typeof stored === 'object') {
      return (stored as { installed?: unknown }).installed !== false;
    }
  } catch { /* Use defaults when local storage is unavailable or invalid. */ }
  return true;
}

export function SettingsView({ settings, onUpdate }: { settings: WorkspaceSettings; onUpdate(patch: Partial<WorkspaceSettings>): Promise<void> }) {
  const locale = useUiLocale();
  const copy = settingsText[locale];
  const hostText = uiText[locale];
  const coreCategories = coreSettingsCategories(locale);
  const categoryTitle = (id: string) => coreCategories.find(item => item.id === id)!.title;
  const appearanceChange = useRef(0);
  const [appearanceError, setAppearanceError] = useState<'language' | 'textSize'>();
  async function updateAppearance<K extends 'language' | 'textSize'>(key: K, value: WorkspaceSettings[K]) {
    const revision = ++appearanceChange.current;
    setAppearanceError(undefined);
    try { await onUpdate({ [key]: value }); }
    catch { if (appearanceChange.current === revision) setAppearanceError(key); }
  }
  const [speechNavigation, setSpeechNavigation] = useState(0);
  const languageSelect = useRef<HTMLSelectElement>(null);
  const textSizeSelect = useRef<HTMLSelectElement>(null);
  const [languageNavigation, setLanguageNavigation] = useState(0);
  const [preparation, setPreparation] = useState<SettingsSuggestion>();
  const preparationToken = useRef(0);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<SettingsCategoryId>('ai');
  const [installedOpen, setInstalledOpen] = useState(initialInstalledOpen);
  const [searchInstalledOpen, setSearchInstalledOpen] = useState(true);
  const content = useRef<HTMLElement>(null);
  const moduleState = useWorkspaceModules();
  const moduleAttention = useModuleAttention();
  const [moduleBusy, setModuleBusy] = useState<string>();
  const [moduleError, setModuleError] = useFormFeedback(copy, locale);
  const [eventStatus, setEventStatus] = useState<ModuleEventStatus[]>([]);
  const [eventStatusError, setEventStatusError] = useState(false);
  const eventRequest = useRef(0);
  const [visitedModuleSettings, setVisitedModuleSettings] = useState<Set<string>>(() => new Set());
  const contributedSettings = moduleSettings(moduleState.modules);
  const categories: SettingsCategory[] = [...coreCategories, ...contributedSettings.map(item => ({ id: item.categoryId, title: item.title, description: item.description ?? '', icon: item.icon, order: item.order }))].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const entries: SettingsEntry[] = [...settingsEntries, ...contributedSettings.map(item => ({ id: `${item.moduleId}.${item.id}`, category: item.categoryId, title: item.title, description: item.description ?? '', keywords: (item.keywords ?? []).join(' '), apply: 'save' as const }))];
  const categoryIds = useRef(new Set<string>());
  categoryIds.current = new Set(categories.map(item => item.id));
  useEffect(() => {
    const unsubscribeOpen = window.workspace.onShowMailSettings(() => { setActive('mail'); setSearch(''); });
    const unsubscribePrepare = window.workspace.onPrepareSettings(request => {
      if (!request || !['mail', 'ai', 'agent', 'modules'].includes(request.category) || !['account', 'smtp', 'ai', 'agent', 'speech', 'module-repository'].includes(request.kind) || !request.values || typeof request.values !== 'object' || Array.isArray(request.values)) return;
      setActive(request.category); setSearch(''); setPreparation({ ...request, token: ++preparationToken.current });
    });
    const unsubscribeNavigate = window.workspace.onNavigateSettings(request => {
      if (!request || typeof request !== 'object') return;
      if (request.category && (categoryIds.current.has(request.category) || ['mail', 'modules'].includes(request.category))) setActive(request.category);
      const query = typeof request.search === 'string' ? request.search.slice(0, 200) : '';
      if (query.trim()) setSearchInstalledOpen(true);
      setSearch(query);
      if (request.sectionId === 'ai.speech') setSpeechNavigation(value => value + 1);
      if (request.sectionId === 'display.language') setLanguageNavigation(value => value + 1);
    });
    return () => { unsubscribeOpen(); unsubscribePrepare(); unsubscribeNavigate(); };
  }, []);
  useEffect(() => {
    if (languageNavigation) languageSelect.current?.focus();
  }, [languageNavigation]);
  useEffect(() => { if (!moduleState.loading && !categoryIds.current.has(active)) setActive('ai'); }, [moduleState.loading, moduleState.modules, active]);
  async function toggleModule(id: string, enabled: boolean) {
    setModuleBusy(id); setModuleError('');
    try { await window.workspace.setModuleEnabled(id, enabled); }
    catch (reason) { setModuleError((copy, locale) => formDetail(reason, locale) || copy.toggleFailed); }
    finally { setModuleBusy(undefined); }
  }
  const searching = search.trim().length > 0;
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [active, searching]);
  const visible = (id: SettingsCategoryId) => searching
    ? entries.some(entry => entry.category === id && matchesSettingsEntry(entry, search, categories))
    : active === id;
  const moduleSettingsVisible = visible('modules');
  async function refreshEventStatus() {
    const request = ++eventRequest.current;
    try {
      const result = await window.workspace.getModuleEventStatus();
      if (request === eventRequest.current) { setEventStatus(result); setEventStatusError(false); }
    } catch { if (request === eventRequest.current) setEventStatusError(true); }
  }
  useEffect(() => {
    if (!moduleSettingsVisible) return;
    void refreshEventStatus();
    const unsubscribe = window.workspace.onModulesChanged(() => void refreshEventStatus());
    const timer = setInterval(() => void refreshEventStatus(), 5000);
    return () => { unsubscribe(); clearInterval(timer); eventRequest.current++; };
  }, [moduleSettingsVisible]);
  async function setSubscriptions(moduleId: string, topics: string[]) {
    setModuleBusy(moduleId); setModuleError(''); eventRequest.current++;
    try { await window.workspace.setModuleEventSubscriptions(moduleId, topics); await refreshEventStatus(); }
    catch (reason) { setModuleError((copy, locale) => formDetail(reason, locale) || copy.subscriptionsFailed); }
    finally { setModuleBusy(undefined); }
  }
  const anyResults = entries.some(entry => matchesSettingsEntry(entry, search, categories));
  const category = categories.find(item => item.id === active) ?? categories[0];
  const availableModuleSettings = contributedSettings.map(item => item.categoryId).join('|');
  const visibleModuleSettings = contributedSettings.filter(item => visible(item.categoryId)).map(item => item.categoryId).join('|');
  useEffect(() => {
    const available = new Set(availableModuleSettings.split('|').filter(Boolean));
    const visible = visibleModuleSettings.split('|').filter(Boolean);
    setVisitedModuleSettings(previous => {
      const next = new Set([...previous].filter(id => available.has(id)));
      visible.forEach(id => next.add(id));
      return next.size === previous.size && [...next].every(id => previous.has(id)) ? previous : next;
    });
  }, [availableModuleSettings, visibleModuleSettings]);

  function updateSearch(value: string) {
    if (value.trim()) setSearchInstalledOpen(true);
    setSearch(value);
  }

  function chooseCategory(id: SettingsCategoryId) {
    setActive(id);
    setSearch('');
    const owner = contributedSettings.find(item => item.categoryId === id)?.moduleId;
    const ids = owner ? moduleAttention.filter(item => item.moduleId === owner).map(item => item.id) : [];
    if (owner && ids.length) void window.workspace.acknowledgeModuleAttention(owner, ids).catch(() => {});
  }

  function toggleInstalled() {
    if (searching) { setSearchInstalledOpen(!searchInstalledOpen); return; }
    const next = !installedOpen;
    setInstalledOpen(next);
    try { localStorage.setItem(groupStorageKey, JSON.stringify({ installed: next })); } catch { /* The current session remains usable. */ }
  }

  const matches = (id: string) => !searching || matchesSettingsEntry(settingsEntries.find(item => item.id === id)!, search, categories);
  return <div className="settings-view">
    <aside className="settings-sidebar">
      <div className="settings-sidebar-title"><span className="settings-view-icon"><Settings size={18} /></span><h1>{hostText.settings}</h1></div>
      <div className="settings-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={copy.search} placeholder={copy.searchPlaceholder} value={search} onChange={event => updateSearch(event.target.value)} />{search && <button type="button" aria-label={copy.clearSearch} title={copy.clearSearch} onClick={() => updateSearch('')}><X size={15} /></button>}</div>
      <nav className="settings-category-nav" aria-label={copy.categories}>{categories.map(item => {
        const Icon = icons[item.id as keyof typeof icons] ?? moduleIcon(item.icon);
        const owner = contributedSettings.find(category => category.categoryId === item.id)?.moduleId;
        const notices = owner ? moduleAttention.filter(notice => notice.moduleId === owner) : [];
        const label = notices.length ? `${item.title} · ${hostText.notices(notices.length)}` : item.title;
        return <button type="button" key={item.id} className={!searching && active === item.id ? 'active' : ''} aria-label={label} title={notices.length ? notices.map(notice => notice.message).join(' · ') : undefined} aria-current={!searching && active === item.id ? 'page' : undefined} onClick={() => chooseCategory(item.id)}><span className="module-attention-icon"><Icon size={16} aria-hidden="true" />{notices.length > 0 && <ModuleAttentionDot pulseUntil={Math.max(...notices.map(notice => notice.pulseUntil))} />}</span><span>{item.title}</span></button>;
      })}</nav>
    </aside>
    <main className="settings-view-content" ref={content}>
      <header className="settings-content-heading"><h2>{searching ? copy.results : category.title}</h2><p>{searching ? copy.searchFor(search.trim()) : category.description}</p></header>
      {searching && !anyResults && <div className="settings-empty" role="status"><Search size={20} /><strong>{copy.noResults}</strong><span>{copy.searchAgain}</span></div>}
      <section hidden={!visible('ai')} aria-label={categoryTitle('ai')}>
        {searching && <h3 className="settings-result-category">{categoryTitle('ai')}</h3>}
        <div hidden={searching && !settingsEntries.some(entry => entry.category === 'ai' && entry.id !== 'ai.speech' && matchesSettingsEntry(entry, search))}><AiSettings preparation={preparation?.kind === 'ai' ? preparation : undefined} searchQuery={search} onClearSearch={() => { setActive('ai'); setSearch(''); }} /></div>
        <SpeechSettings navigationRequest={speechNavigation} preparation={preparation?.kind === 'speech' ? preparation : undefined} searchQuery={search} />
      </section>
      <section hidden={!visible('agent')} aria-label={categoryTitle('agent')}>
        {searching && <h3 className="settings-result-category">{categoryTitle('agent')}</h3>}
        <AgentSettings preparation={preparation?.kind === 'agent' ? preparation : undefined} searchQuery={search} onClearSearch={() => { setActive('agent'); setSearch(''); }} />
      </section>
      <section hidden={!visible('display')} aria-label={categoryTitle('display')}>
        {searching && <h3 className="settings-result-category">{categoryTitle('display')}</h3>}
        <div className="workspace-settings-group settings-choices">
          <SettingsChoiceRow id="interface-language" ref={languageSelect} label={copy.language} hidden={!matches('display.language')}
            value={settings.language ?? defaultSettings.language} error={appearanceError === 'language' ? copy.languageSaveFailed : undefined}
            onChange={event => void updateAppearance('language', event.target.value as LanguagePreference)}>
            <option value="system">{copy.system}</option><option lang="de" value="de">Deutsch</option><option lang="en" value="en">English</option>
          </SettingsChoiceRow>
          <SettingsChoiceRow id="text-size" ref={textSizeSelect} label={copy.textSize} hidden={!matches('display.textSize')}
            value={settings.textSize} error={appearanceError === 'textSize' ? copy.textSizeSaveFailed : undefined}
            onChange={event => void updateAppearance('textSize', event.target.value as WorkspaceSettings['textSize'])}
            action={settings.textSize !== defaultSettings.textSize &&
              <button type="button" className="settings-choice-reset" title={copy.reset} aria-label={copy.reset}
                onClick={() => { textSizeSelect.current?.focus(); void updateAppearance('textSize', defaultSettings.textSize); }}><RotateCcw size={14} aria-hidden="true" /></button>}>
            <option value="standard">{copy.standard}</option><option value="large">{copy.large}</option>
          </SettingsChoiceRow>
        </div>
      </section>
      <section hidden={!visible('dock')} aria-label={categoryTitle('dock')}>
        {searching && <h3 className="settings-result-category">{categoryTitle('dock')}</h3>}
        <OvdBarSettings settings={settings} searchQuery={search}/>
        <NavigationOrderSettings settings={settings} modules={moduleState.modules} loading={moduleState.loading} searchQuery={search}/>
      </section>
      <section hidden={!visible('diagnostics')} aria-label={categoryTitle('diagnostics')}>
        {searching && <h3 className="settings-result-category">{categoryTitle('diagnostics')}</h3>}
        <DiagnosticsSettings active={visible('diagnostics')} enabled={settings.diagnosticsEnabled ?? false} searchQuery={search} />
      </section>
      <section hidden={!visible('modules')} aria-label={categoryTitle('modules')} className="module-management">
        {searching && <h3 className="settings-result-category">{categoryTitle('modules')}</h3>}
        {(moduleError || moduleState.error) && <p className="settings-feedback error" role="alert">{moduleError || moduleState.error}</p>}
        <details className="workspace-settings-group installed-module-settings" open={searching ? searchInstalledOpen : installedOpen} hidden={searching && !matchesSettingsEntry(settingsEntries.find(entry => entry.id === 'modules.installed')!, search, categories)}>
        <summary onClick={event => { event.preventDefault(); toggleInstalled(); }}><span><strong>{copy.installed}</strong><small>{moduleState.loading ? copy.loading : copy.moduleCount(moduleState.modules.filter(module => module.status === 'ready').length, moduleState.modules.length)}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="installed-module-list">
        {moduleState.loading && <p role="status">{copy.loadingModules}</p>}
        {eventStatusError && <p className="module-event-error" role="alert">{copy.eventsFailed}</p>}
        {moduleState.modules.map(module => {
          const runtimeError = module.status === 'invalid' && !!module.manifest;
          const canDisable = module.status === 'ready' || runtimeError;
          const statusLabel = runtimeError ? copy.moduleError : copy.status[module.status];
          return <div className="module-management-row" key={module.id}><Package size={17} aria-hidden="true" /><div><div className="installed-module-heading"><strong>{module.title}</strong><span className="module-status">{statusLabel}{module.required && ` · ${copy.required}`}</span></div><details className="installed-module-details" open={searching || undefined}><summary>{copy.details}</summary><small>{module.id} · {module.version || copy.unknownVersion} · {module.source === 'builtin' ? copy.bundled : copy.additional}</small><p>{module.description}</p></details>{module.reason && <p className="installed-module-reason">{formDetail(module.reason, locale)}</p>}{!!module.manifest?.contributions.events?.subscriptions.length && <ModuleEventSettings module={module} status={eventStatus.find(item => item.moduleId === module.id)} busy={!!moduleBusy} onChange={topics => void setSubscriptions(module.id, topics)} />}</div>{!module.required && (['ready', 'disabled', 'approval_required'].includes(module.status) || runtimeError) && <button type="button" disabled={!!moduleBusy} onClick={() => void toggleModule(module.id, !canDisable)}>{moduleBusy === module.id ? copy.changing : canDisable ? copy.disable : module.status === 'approval_required' ? copy.approve : copy.enable}</button>}</div>;
        })}
        </div>
        </details>
        <div hidden={searching && !matchesSettingsEntry(settingsEntries.find(entry => entry.id === 'modules.repositories')!, search, categories)}><ModuleRepositories preparation={preparation?.kind === 'module-repository' ? preparation : undefined} searchQuery={search} installedModules={moduleState.modules} moduleBusy={!!moduleBusy} onActivate={id => toggleModule(id, true)} /></div>
      </section>
      {contributedSettings.filter(item => visitedModuleSettings.has(item.categoryId)).map(item => <section key={`${item.moduleId}:${item.id}`} hidden={!visible(item.categoryId)} aria-label={item.title}>
        {searching && <h3 className="settings-result-category">{item.title}</h3>}
        <item.Component title={item.title} preparation={preparation} searchQuery={search} />
      </section>)}
    </main>
  </div>;
}

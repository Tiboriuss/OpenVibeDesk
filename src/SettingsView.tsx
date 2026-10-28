import { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, Monitor, Package, PanelsTopLeft, RotateCcw, Search, Settings, Workflow, X } from 'lucide-react';
import { AiSettings } from './AiSettings';
import { AgentSettings } from './AgentSettings';
import { NavigationOrderSettings } from './NavigationOrderSettings';
import { settingsCategories, settingsEntries, matchesSettingsEntry, type SettingsCategoryId, type SettingsCategory, type SettingsEntry } from './settings-registry';
import { defaultSettings } from '../shared/settings';
import type { Settings as WorkspaceSettings } from '../shared/model';
import type { SettingsSuggestion } from './settings-preparation';
import { moduleIcon, moduleSettings, useWorkspaceModules } from './module-registry';
import './settings-view.css';

type GroupId = 'display' | 'dock';
const groupStorageKey = 'openvibedesk.settings.groups';
const icons = { ai: Bot, agent: Workflow, display: Monitor, dock: PanelsTopLeft, modules: Package };

function initialGroups(): Record<GroupId, boolean> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(groupStorageKey) ?? '{}');
    if (stored && typeof stored === 'object') {
      const values = stored as Partial<Record<GroupId, unknown>>;
      return { display: values.display === true, dock: values.dock === true };
    }
  } catch { /* Use defaults when local storage is unavailable or invalid. */ }
  return { display: false, dock: false };
}

export function SettingsView({ settings, onUpdate }: { settings: WorkspaceSettings; onUpdate(patch: Partial<WorkspaceSettings>): void }) {
  const [preparation, setPreparation] = useState<SettingsSuggestion>();
  const preparationToken = useRef(0);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<SettingsCategoryId>('ai');
  const [groups, setGroups] = useState(initialGroups);
  const [searchGroups, setSearchGroups] = useState<Record<GroupId, boolean>>({ display: true, dock: true });
  const moduleState = useWorkspaceModules();
  const [moduleBusy, setModuleBusy] = useState<string>();
  const [moduleError, setModuleError] = useState('');
  const [visitedModuleSettings, setVisitedModuleSettings] = useState<Set<string>>(() => new Set());
  const contributedSettings = moduleSettings(moduleState.modules);
  const categories: SettingsCategory[] = [...settingsCategories, ...contributedSettings.map(item => ({ id: item.categoryId, title: item.title, description: item.description ?? '', icon: item.icon, order: item.order }))].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const entries: SettingsEntry[] = [...settingsEntries, ...contributedSettings.map(item => ({ id: `${item.moduleId}.${item.id}`, category: item.categoryId, title: item.title, description: item.description ?? '', keywords: (item.keywords ?? []).join(' '), apply: 'save' as const }))];
  const categoryIds = useRef(new Set<string>());
  categoryIds.current = new Set(categories.map(item => item.id));
  useEffect(() => {
    const unsubscribeOpen = window.workspace.onShowMailSettings(() => { setActive('mail'); setSearch(''); });
    const unsubscribePrepare = window.workspace.onPrepareSettings(request => {
      if (!request || !['mail', 'ai', 'agent'].includes(request.category) || !['account', 'smtp', 'ai', 'agent'].includes(request.kind) || !request.values || typeof request.values !== 'object' || Array.isArray(request.values)) return;
      setActive(request.category); setSearch(''); setPreparation({ ...request, token: ++preparationToken.current });
    });
    const unsubscribeNavigate = window.workspace.onNavigateSettings(request => {
      if (!request || typeof request !== 'object') return;
      if (request.category && (categoryIds.current.has(request.category) || ['mail', 'modules'].includes(request.category))) setActive(request.category);
      const query = typeof request.search === 'string' ? request.search.slice(0, 200) : '';
      if (query.trim()) setSearchGroups({ display: true, dock: true });
      setSearch(query);
    });
    return () => { unsubscribeOpen(); unsubscribePrepare(); unsubscribeNavigate(); };
  }, []);
  useEffect(() => { if (!moduleState.loading && !categoryIds.current.has(active)) setActive('ai'); }, [moduleState.loading, moduleState.modules, active]);
  async function toggleModule(id: string, enabled: boolean) {
    setModuleBusy(id); setModuleError('');
    try { await window.workspace.setModuleEnabled(id, enabled); }
    catch (reason) { setModuleError(reason instanceof Error ? reason.message : 'Modulzustand konnte nicht geändert werden.'); }
    finally { setModuleBusy(undefined); }
  }
  const searching = search.trim().length > 0;
  const visible = (id: SettingsCategoryId) => searching
    ? entries.some(entry => entry.category === id && matchesSettingsEntry(entry, search, categories))
    : active === id;
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
    if (value.trim()) setSearchGroups({ display: true, dock: true });
    setSearch(value);
  }

  function chooseCategory(id: SettingsCategoryId) {
    setActive(id);
    setSearch('');
  }

  function toggleGroup(id: GroupId) {
    if (searching) { setSearchGroups(current => ({ ...current, [id]: !current[id] })); return; }
    setGroups(current => {
      const next = { ...current, [id]: !current[id] };
      try { localStorage.setItem(groupStorageKey, JSON.stringify(next)); } catch { /* The current session remains usable. */ }
      return next;
    });
  }

  const isOpen = (id: GroupId) => searching ? searchGroups[id] : groups[id];
  return <div className="settings-view">
    <aside className="settings-sidebar">
      <div className="settings-sidebar-title"><span className="settings-view-icon"><Settings size={18} /></span><h1>Einstellungen</h1></div>
      <div className="settings-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Einstellungen durchsuchen" placeholder="Einstellungen suchen …" value={search} onChange={event => updateSearch(event.target.value)} />{search && <button type="button" aria-label="Suche löschen" title="Suche löschen" onClick={() => updateSearch('')}><X size={15} /></button>}</div>
      <nav className="settings-category-nav" aria-label="Einstellungskategorien">{categories.map(item => {
        const Icon = icons[item.id as keyof typeof icons] ?? moduleIcon(item.icon);
        return <button type="button" key={item.id} className={!searching && active === item.id ? 'active' : ''} aria-current={!searching && active === item.id ? 'page' : undefined} onClick={() => chooseCategory(item.id)}><Icon size={16} aria-hidden="true" /><span>{item.title}</span></button>;
      })}</nav>
    </aside>
    <main className="settings-view-content">
      <header className="settings-content-heading"><h2>{searching ? 'Suchergebnisse' : category.title}</h2><p>{searching ? `Einstellungen für „${search.trim()}“` : category.description}</p></header>
      {searching && !anyResults && <div className="settings-empty" role="status"><Search size={20} /><strong>Keine Einstellung gefunden</strong><span>Versuche einen anderen Suchbegriff.</span></div>}
      <section hidden={!visible('ai')} aria-label="KI & Verbindung">
        {searching && <h3 className="settings-result-category">KI & Verbindung</h3>}
        <AiSettings preparation={preparation?.kind === 'ai' ? preparation : undefined} searchQuery={search} onClearSearch={() => { setActive('ai'); setSearch(''); }} />
      </section>
      <section hidden={!visible('agent')} aria-label="Agent">
        {searching && <h3 className="settings-result-category">Agent</h3>}
        <AgentSettings preparation={preparation?.kind === 'agent' ? preparation : undefined} searchQuery={search} onClearSearch={() => { setActive('agent'); setSearch(''); }} />
      </section>
      <section hidden={!visible('display')} aria-label="Darstellung">
        {searching && <h3 className="settings-result-category">Darstellung</h3>}
        <details className="workspace-settings-group" open={isOpen('display')}>
          <summary onClick={event => { event.preventDefault(); toggleGroup('display'); }}><span><strong>Textgröße</strong><small>Aktuell: {settings.textSize === 'large' ? 'Größer' : 'Standard'}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="workspace-settings-content"><div className="setting-row workspace-setting-row"><div><label htmlFor="text-size">Textgröße</label><p>Größerer Text für Mail, Chat und Entwürfe. Standard: Standard.</p></div><select id="text-size" value={settings.textSize} onChange={event => onUpdate({ textSize: event.target.value as WorkspaceSettings['textSize'] })}><option value="standard">Standard</option><option value="large">Größer</option></select></div>{settings.textSize !== defaultSettings.textSize && <button type="button" className="settings-reset" onClick={() => onUpdate({ textSize: defaultSettings.textSize })}><RotateCcw size={13} /> Auf Standard zurücksetzen</button>}</div>
        </details>
      </section>
      <section hidden={!visible('dock')} aria-label="Dock & Fenster">
        {searching && <h3 className="settings-result-category">Dock & Fenster</h3>}
        <details className="workspace-settings-group" open={isOpen('dock')}>
          <summary onClick={event => { event.preventDefault(); toggleGroup('dock'); }}><span><strong>Dock im Vordergrund</strong><small>Aktuell: {settings.dockAlwaysOnTop ? 'Ein' : 'Aus'}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="workspace-settings-content"><div className="setting-row workspace-setting-row"><div><label htmlFor="dock-top">Dock im Vordergrund</label><p>Das Dock über anderen Fenstern anzeigen. Standard: Ein.</p></div><input id="dock-top" className="setting-toggle" type="checkbox" checked={settings.dockAlwaysOnTop} onChange={event => onUpdate({ dockAlwaysOnTop: event.target.checked })} /></div>{settings.dockAlwaysOnTop !== defaultSettings.dockAlwaysOnTop && <button type="button" className="settings-reset" onClick={() => onUpdate({ dockAlwaysOnTop: defaultSettings.dockAlwaysOnTop })}><RotateCcw size={13} /> Auf Standard zurücksetzen</button>}</div>
        </details>
      </section>
      <section hidden={!visible('modules')} aria-label="Module" className="module-management">
        {searching && <h3 className="settings-result-category">Module</h3>}
        {(moduleError || moduleState.error) && <p className="mail-account-feedback error" role="alert">{moduleError || moduleState.error}</p>}
        <NavigationOrderSettings settings={settings} modules={moduleState.modules} loading={moduleState.loading || !!moduleBusy} searchQuery={search}/>
        <div hidden={searching && !matchesSettingsEntry(settingsEntries.find(entry => entry.id === 'modules.installed')!, search, categories)}>
        {moduleState.loading && <p role="status">Module werden geladen …</p>}
        {moduleState.modules.map(module => <div className="module-management-row" key={module.id}><Package size={20} /><div><strong>{module.title}</strong><small>{module.id} · {module.version || 'Unbekannte Version'} · {module.source === 'builtin' ? 'Mitgeliefert' : 'Zusatzmodul'}{module.required ? ' · Pflichtmodul' : ''}</small><p>{module.description}</p>{module.reason && <p>{module.reason}</p>}<span className="module-status">{{ ready: 'Aktiv', disabled: 'Deaktiviert', incompatible: 'Nicht kompatibel', invalid: 'Ungültiges Modul', approval_required: 'Freigabe erforderlich', unsupported: 'Nicht unterstützt' }[module.status]}</span></div>{!module.required && ['ready', 'disabled', 'approval_required'].includes(module.status) && <button type="button" disabled={!!moduleBusy} onClick={() => void toggleModule(module.id, module.status !== 'ready')}>{moduleBusy === module.id ? 'Wird geändert …' : module.status === 'ready' ? 'Deaktivieren' : 'Aktivieren'}</button>}</div>)}
        </div>
      </section>
      {contributedSettings.filter(item => visitedModuleSettings.has(item.categoryId)).map(item => <section key={`${item.moduleId}:${item.id}`} hidden={!visible(item.categoryId)} aria-label={item.title}>
        {searching && <h3 className="settings-result-category">{item.title}</h3>}
        <item.Component preparation={preparation} searchQuery={search} />
      </section>)}
      {(!searching || anyResults) && <p className="settings-save-note">Darstellung, Dock und Navigationsreihenfolge werden sofort gespeichert. KI-, Agent- und Verbindungseinstellungen speicherst du im jeweiligen Bereich.</p>}
    </main>
  </div>;
}

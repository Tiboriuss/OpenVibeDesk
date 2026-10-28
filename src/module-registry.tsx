import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Archive, Bot, Calendar, FilePlus2, FileText, Folder, FolderClock, Grid2X2, Mail, Package, Settings, type LucideIcon } from 'lucide-react';
import { ModuleViewHost } from './ModuleViewHost';
import type { ModuleInfo } from '../shared/modules';
import type { WindowKind, WorkspaceState } from '../shared/model';
import type { UiAction } from '../shared/actions';
import type { SettingsSuggestion } from './settings-preparation';
import { coreNavigationEntries, orderNavigationEntries } from '../shared/navigation';

export type ModuleViewProps = { state: WorkspaceState; onAction(action: UiAction): Promise<void>; onError(message: string): void };
export type ModuleSettingsProps = { preparation?: SettingsSuggestion; searchQuery: string };
type FrontendAdapter = { views: Record<string, ComponentType<ModuleViewProps>>; settings: Record<string, ComponentType<ModuleSettingsProps>>; navigationActions?: Record<string, UiAction> };

const MailModuleView = lazy(() => import('./modules/mail').then(module => ({ default: module.MailModuleView })));
const MailDraftModuleView = lazy(() => import('./modules/mail').then(module => ({ default: module.MailDraftModuleView })));
const MailModuleSettings = lazy(() => import('./modules/mail').then(module => ({ default: module.MailModuleSettings })));
const FilesModuleView = lazy(() => import('./modules/files').then(module => ({ default: module.FilesModuleView })));
const McpModuleSettings = lazy(() => import('./modules/mcp').then(module => ({ default: module.McpModuleSettings })));
const moduleLoading = <div className="module-host-status" role="status">Modul wird geladen …</div>;

/** Executable renderer adapters are bundled and trusted; manifests never execute arbitrary renderer code. */
const adapters: Record<string, FrontendAdapter> = {
  'ovd-mcp': {
    views: {},
    settings: { 'mcp-settings': props => <Suspense fallback={moduleLoading}><McpModuleSettings searchQuery={props.searchQuery} /></Suspense> }
  },
  'ovd-files': {
    views: { files: props => <Suspense fallback={moduleLoading}><FilesModuleView {...props} /></Suspense> },
    settings: {},
    navigationActions: { files: { type: 'open_file_manager' } }
  },
  'ovd-mail': {
    views: { mail: ({ state }) => <Suspense fallback={moduleLoading}><MailModuleView state={state} /></Suspense>, draft: ({ state, onAction, onError }) => <Suspense fallback={moduleLoading}><MailDraftModuleView draft={state.drafts.find(draft => draft.id === state.activeDraftId)} onAction={onAction} onError={onError} /></Suspense> },
    settings: { 'mail-settings': props => <Suspense fallback={moduleLoading}><MailModuleSettings {...props} /></Suspense> },
    navigationActions: { draft: { type: 'create_draft' } }
  }
};
const moduleIcons: Record<string, LucideIcon> = { mail: Mail, draft: FilePlus2, compose: FilePlus2, file: FileText, files: Folder, folder: Folder, archive: Archive, settings: Settings, assistant: Bot, chat: Bot, sessions: FolderClock, calendar: Calendar, grid: Grid2X2 };
export function moduleIcon(name?: string): LucideIcon { return moduleIcons[name ?? ''] ?? Package; }

export function useWorkspaceModules() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => { void window.workspace.listModules().then(items => { if (active) { setModules(items); setLoading(false); setError(''); } }).catch(() => { if (active) { setError('Module konnten nicht geladen werden.'); setLoading(false); } }); };
    const unsubscribe = window.workspace.onModulesChanged(load);
    load();
    return () => { active = false; unsubscribe(); };
  }, []);
  return { modules, loading, error };
}

export function moduleViews(modules: ModuleInfo[]) {
  return modules.filter(module => module.status === 'ready' && module.manifest).flatMap(module => {
    const adapter = module.source === 'builtin' ? adapters[module.id] : undefined;
    return (module.manifest?.contributions?.views ?? []).flatMap(view => {
      const Component = view.renderer ? adapter?.views[view.renderer] : typeof ('entry' in view ? view.entry : undefined) === 'string' ? externalView(module.id, view.id, view.title) : undefined;
      return Component ? [{ ...view, moduleId: module.id, Component }] : [];
    });
  });
}
export function moduleNavigation(modules: ModuleInfo[]) {
  const availableViews = moduleViews(modules);
  return modules.filter(module => module.status === 'ready' && module.manifest).flatMap(module => (module.manifest?.contributions?.navigation ?? []).flatMap(item => {
    if (!availableViews.some(view => view.moduleId === module.id && view.id === item.view)) return [];
    return [{ ...item, moduleId: module.id, action: module.source === 'builtin' ? adapters[module.id]?.navigationActions?.[item.view] ?? { type: 'open_window' as const, kind: item.view as WindowKind } : undefined }];
  })).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
export interface WorkspaceNavigationEntry {
  id: string; title: string; icon?: string; order: number; moduleId: string; moduleTitle: string; action?: UiAction; view?: string;
}
/** Settings and the live app navigation use the same available entries and order. */
export function workspaceNavigation(modules: ModuleInfo[], savedOrder?: readonly string[]): WorkspaceNavigationEntry[] {
  const entries: WorkspaceNavigationEntry[] = [
    ...coreNavigationEntries.map(item => ({ ...item, moduleTitle: 'OpenVibeDesk' })),
    ...moduleNavigation(modules).map(item => ({ ...item, id: `${item.moduleId}:${item.id}`, moduleTitle: modules.find(module => module.id === item.moduleId)?.title ?? item.moduleId, order: item.order ?? 100 }))
  ];
  return orderNavigationEntries(entries, savedOrder);
}
export function moduleSettings(modules: ModuleInfo[]) {
  return modules.filter(module => module.status === 'ready' && module.manifest).flatMap(module => {
    const adapter = module.source === 'builtin' ? adapters[module.id] : undefined;
    return (module.manifest?.contributions?.settings ?? []).flatMap(item => {
      const Component = item.renderer ? adapter?.settings[item.renderer] : typeof ('entry' in item ? item.entry : undefined) === 'string' ? externalSettings(module.id, item.id, item.title) : undefined;
      return Component ? [{ ...item, moduleId: module.id, categoryId: module.source === 'builtin' ? item.id : `${module.id}:${item.id}`, Component }] : [];
    });
  }).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

const externalViews = new Map<string, ComponentType<ModuleViewProps>>();
function externalView(moduleId: string, viewId: string, title: string): ComponentType<ModuleViewProps> {
  const key = `${moduleId}:${viewId}`;
  let Component = externalViews.get(key);
  if (!Component) { Component = () => <ModuleViewHost moduleId={moduleId} viewId={viewId} title={title} />; externalViews.set(key, Component); }
  return Component;
}
const externalSettingsViews = new Map<string, ComponentType<ModuleSettingsProps>>();
function externalSettings(moduleId: string, viewId: string, title: string): ComponentType<ModuleSettingsProps> {
  const key = `${moduleId}:${viewId}`;
  let Component = externalSettingsViews.get(key);
  if (!Component) { Component = () => <ModuleViewHost moduleId={moduleId} viewId={viewId} title={title} />; externalSettingsViews.set(key, Component); }
  return Component;
}

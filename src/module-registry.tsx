import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Archive, Bot, Calendar, FilePlus2, FileText, Folder, FolderClock, Grid2X2, Mail, Package, Settings, type LucideIcon } from 'lucide-react';
import { ModuleViewHost } from './ModuleViewHost';
import { uiText, useUiLocale } from './locale';
import type { UiLocale } from '../shared/locale';
import type { ModuleInfo } from '../shared/modules';
import type { WindowKind, WorkspaceState } from '../shared/model';
import type { UiAction } from '../shared/actions';
import type { SettingsSuggestion } from './settings-preparation';
import { localizedCoreNavigation, orderNavigationEntries } from '../shared/navigation';

export type ModuleViewProps = { title?: string; state: WorkspaceState; onAction(action: UiAction): Promise<void>; onError(message: string): void };
export type ModuleSettingsProps = { title?: string; preparation?: SettingsSuggestion; searchQuery: string };
type FrontendAdapter = { views: Record<string, ComponentType<ModuleViewProps>>; settings: Record<string, ComponentType<ModuleSettingsProps>>; navigationActions?: Record<string, UiAction> };

const MailModuleView = lazy(() => import('./modules/mail').then(module => ({ default: module.MailModuleView })));
const MailDraftModuleView = lazy(() => import('./modules/mail').then(module => ({ default: module.MailDraftModuleView })));
const MailModuleSettings = lazy(() => import('./modules/mail').then(module => ({ default: module.MailModuleSettings })));
const FilesModuleView = lazy(() => import('./modules/files').then(module => ({ default: module.FilesModuleView })));
const McpModuleSettings = lazy(() => import('./modules/mcp').then(module => ({ default: module.McpModuleSettings })));
function ModuleLoading() {
  return <div className="module-host-status" role="status">{uiText[useUiLocale()].moduleLoading}</div>;
}

/** Executable renderer adapters are bundled and trusted; manifests never execute arbitrary renderer code. */
const adapters: Record<string, FrontendAdapter> = {
  'ovd-mcp': {
    views: {},
    settings: { 'mcp-settings': props => <Suspense fallback={<ModuleLoading />}><McpModuleSettings searchQuery={props.searchQuery} /></Suspense> }
  },
  'ovd-files': {
    views: { files: props => <Suspense fallback={<ModuleLoading />}><FilesModuleView {...props} /></Suspense> },
    settings: {},
    navigationActions: { files: { type: 'open_file_manager' } }
  },
  'ovd-mail': {
    views: { mail: ({ state }) => <Suspense fallback={<ModuleLoading />}><MailModuleView state={state} /></Suspense>, draft: ({ state, onAction, onError }) => <Suspense fallback={<ModuleLoading />}><MailDraftModuleView draft={state.drafts.find(draft => draft.id === state.activeDraftId)} onAction={onAction} onError={onError} /></Suspense> },
    settings: { 'mail-settings': props => <Suspense fallback={<ModuleLoading />}><MailModuleSettings {...props} /></Suspense> },
    navigationActions: { draft: { type: 'create_draft' } }
  }
};
const moduleIcons: Record<string, LucideIcon> = { mail: Mail, draft: FilePlus2, compose: FilePlus2, file: FileText, files: Folder, folder: Folder, archive: Archive, settings: Settings, assistant: Bot, chat: Bot, sessions: FolderClock, calendar: Calendar, grid: Grid2X2 };
export function moduleIcon(name?: string): LucideIcon { return moduleIcons[name ?? ''] ?? Package; }

export function useWorkspaceModules() {
  const locale = useUiLocale();
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      try {
        const items = await window.workspace.listModules();
        if (active && request === generation) { setModules(items); setFailed(false); }
      } catch { if (active && request === generation) setFailed(true); }
      finally { if (active && request === generation) setLoading(false); }
    };
    const unsubscribe = window.workspace.onModulesChanged(load);
    void load();
    return () => { active = false; unsubscribe(); };
  }, []);
  return { modules, loading, error: failed ? locale === 'en' ? 'Could not load modules.' : 'Module konnten nicht geladen werden.' : '' };
}

export function moduleViews(modules: ModuleInfo[]) {
  return modules.filter(module => module.status === 'ready' && module.manifest).flatMap(module => {
    const adapter = module.source === 'builtin' ? adapters[module.id] : undefined;
    return (module.manifest?.contributions?.views ?? []).flatMap(view => {
      const Component = view.renderer ? adapter?.views[view.renderer] : typeof ('entry' in view ? view.entry : undefined) === 'string' ? externalView(module.id, view.id) : undefined;
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
export function workspaceNavigation(modules: ModuleInfo[], savedOrder?: readonly string[], locale: UiLocale = 'de'): WorkspaceNavigationEntry[] {
  const entries: WorkspaceNavigationEntry[] = [
    ...localizedCoreNavigation(locale).map(item => ({ ...item, moduleTitle: 'OpenVibeDesk' })),
    ...moduleNavigation(modules).map(item => ({ ...item, id: `${item.moduleId}:${item.id}`, moduleTitle: modules.find(module => module.id === item.moduleId)?.title ?? item.moduleId, order: item.order ?? 100 }))
  ];
  return orderNavigationEntries(entries, savedOrder);
}
export function moduleSettings(modules: ModuleInfo[]) {
  return modules.filter(module => module.status === 'ready' && module.manifest).flatMap(module => {
    const adapter = module.source === 'builtin' ? adapters[module.id] : undefined;
    return (module.manifest?.contributions?.settings ?? []).flatMap(item => {
      const Component = item.renderer ? adapter?.settings[item.renderer] : typeof ('entry' in item ? item.entry : undefined) === 'string' ? externalView(module.id, item.id) : undefined;
      return Component ? [{ ...item, moduleId: module.id, categoryId: module.source === 'builtin' ? item.id : `${module.id}:${item.id}`, Component }] : [];
    });
  }).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

// Keep the component type stable across language changes so the iframe retains its form and focus.
const externalViews = new Map<string, ComponentType<{ title?: string }>>();
function externalView(moduleId: string, viewId: string): ComponentType<{ title?: string }> {
  const key = `${moduleId}:${viewId}`;
  let Component = externalViews.get(key);
  if (!Component) {
    Component = ({ title }) => <ModuleViewHost moduleId={moduleId} viewId={viewId} title={title ?? viewId} />;
    externalViews.set(key, Component);
  }
  return Component;
}

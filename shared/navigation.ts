import { z } from 'zod';
import type { UiAction } from './actions';
import type { ModuleInfo } from './modules';

export const navigationIdSchema = z.string().min(1).max(181).regex(/^(?:assistant|sessions|files|settings|[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*:[a-z][a-z0-9_.-]*)$/);
export const navigationOrderSchema = z.array(navigationIdSchema).max(500).refine(ids => new Set(ids).size === ids.length, 'Ein Navigationseintrag darf nur einmal vorkommen.');
export const navigationMoveSchema = z.object({ entryId: navigationIdSchema, beforeId: navigationIdSchema.optional(), afterId: navigationIdSchema.optional() }).strict().refine(value => Number(!!value.beforeId) + Number(!!value.afterId) === 1, 'Bitte genau ein Ziel vor oder nach einem anderen Eintrag angeben.');

export interface NavigationEntry {
  id: string;
  title: string;
  icon: string;
  order: number;
  moduleId: string;
  moduleTitle: string;
  available: boolean;
  action?: UiAction;
}

export const coreNavigationEntries: readonly NavigationEntry[] = [
  { id: 'assistant', title: 'Assistant', icon: 'assistant', order: 20, moduleId: 'ovd-assistant', moduleTitle: 'OpenVibeDesk', available: true, action: { type: 'open_window', kind: 'chat' } },
  { id: 'sessions', title: 'Chats', icon: 'sessions', order: 30, moduleId: 'ovd-assistant', moduleTitle: 'OpenVibeDesk', available: true, action: { type: 'open_window', kind: 'sessions' } },
  { id: 'settings', title: 'Einstellungen', icon: 'settings', order: 1000, moduleId: 'ovd-assistant', moduleTitle: 'OpenVibeDesk', available: true, action: { type: 'open_window', kind: 'settings' } }
];

/** Keep the user's existing position when the former core view becomes a module. */
export function migrateNavigationOrder(ids: readonly string[]): string[] {
  return [...new Set(ids.map(id => id === 'files' ? 'ovd-files:files' : id))];
}

/** Public metadata only: ordering never enables a module or executes its code. */
export function getNavigationEntries(modules: readonly ModuleInfo[], includeUnavailable = false): NavigationEntry[] {
  return [...coreNavigationEntries, ...modules.filter(module => module.manifest && (includeUnavailable || module.status === 'ready')).flatMap(module => (module.manifest?.contributions.navigation ?? []).filter(item => module.manifest!.contributions.views.some(view => view.id === item.view)).map(item => ({
    id: `${module.id}:${item.id}`, title: item.title, icon: item.icon ?? 'grid', order: item.order ?? 100,
    moduleId: module.id, moduleTitle: module.title, available: module.status === 'ready'
  })))];
}

export function orderNavigationEntries<T extends { id: string; order?: number }>(items: readonly T[], savedOrder: readonly string[] = []): T[] {
  const positions = new Map(migrateNavigationOrder(savedOrder).map((id, index) => [id, index]));
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const left = positions.get(a.item.id), right = positions.get(b.item.id);
    if (left !== undefined || right !== undefined) return (left ?? Infinity) - (right ?? Infinity);
    return (a.item.order ?? 100) - (b.item.order ?? 100) || a.index - b.index;
  }).map(({ item }) => item);
}

/** Replacing visible slots preserves dormant positions for temporarily absent modules. */
export function mergeNavigationOrder(currentOrder: readonly string[] | undefined, visibleIds: readonly string[]): string[] {
  const visible = [...new Set(visibleIds)], available = new Set(visible);
  let position = 0;
  const result = (currentOrder ?? []).map(id => available.has(id) ? visible[position++] : id);
  return [...result, ...visible.slice(position)];
}

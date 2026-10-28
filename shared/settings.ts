import { z } from 'zod';
import type { Settings } from './model';
import { migrateNavigationOrder, navigationOrderSchema } from './navigation';

export const defaultSettings: Settings = { textSize: 'standard', dockAlwaysOnTop: true };
export const settingsPatchSchema = z.object({ textSize: z.enum(['standard', 'large']).optional(), dockAlwaysOnTop: z.boolean().optional(), navigationOrder: navigationOrderSchema.optional().describe('Vollständige gewünschte Reihenfolge sichtbarer Eintrags-IDs aus navigation.get; gespeicherte Positionen nicht verfügbarer Module erhalten. [] setzt die Standardreihenfolge zurück.') }).strict();
export function normalizeSettings(value: unknown): Settings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const size = settingsPatchSchema.shape.textSize.safeParse(raw.textSize);
  const dock = settingsPatchSchema.shape.dockAlwaysOnTop.safeParse(raw.dockAlwaysOnTop);
  const order = navigationOrderSchema.safeParse(raw.navigationOrder);
  return { ...defaultSettings, ...(size.success && size.data ? { textSize: size.data } : {}), ...(dock.success && typeof dock.data === 'boolean' ? { dockAlwaysOnTop: dock.data } : {}), ...(order.success ? { navigationOrder: migrateNavigationOrder(order.data) } : {}) };
}

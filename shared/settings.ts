import { z } from 'zod';
import type { Settings } from './model';
import { migrateNavigationOrder, navigationOrderSchema } from './navigation';
import { defaultBarSettings, barSettingsPatchSchema, resolveBarSettings } from './ovd-bar';

/** Core categories accepted by host navigation; optional modules contribute their own IDs. */
export const coreSettingsCategoryIds = ['ai', 'agent', 'display', 'dock', 'diagnostics', 'modules'] as const;
export type CoreSettingsCategoryId = typeof coreSettingsCategoryIds[number];
export const defaultSettings: Settings = { textSize: 'standard', dockAlwaysOnTop: true, diagnosticsEnabled: false, ...defaultBarSettings };
export const settingsPatchSchema = z.object({ textSize: z.enum(['standard', 'large']).optional(), dockAlwaysOnTop: z.boolean().optional(), ...barSettingsPatchSchema.shape, diagnosticsEnabled: z.boolean().optional().describe('Lokales Diagnose-Logging einschalten oder ausschalten. Standard: aus. Technische Metadaten ohne Chattexte, Mailinhalte, Werkzeugargumente oder Zugangsdaten. Startet keinen Auftrag erneut.'), navigationOrder: navigationOrderSchema.optional().describe('Vollständige gewünschte Reihenfolge sichtbarer OVD-Bar-Eintrags-IDs aus navigation.get; gespeicherte Positionen nicht verfügbarer Module erhalten. [] setzt die Standardreihenfolge zurück.') }).strict();
export function normalizeSettings(value: unknown): Settings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const size = settingsPatchSchema.shape.textSize.safeParse(raw.textSize);
  const dock = settingsPatchSchema.shape.dockAlwaysOnTop.safeParse(raw.dockAlwaysOnTop);
  const diagnostics = settingsPatchSchema.shape.diagnosticsEnabled.safeParse(raw.diagnosticsEnabled);
  const order = navigationOrderSchema.safeParse(raw.navigationOrder);
  return { ...defaultSettings, ...resolveBarSettings(raw), ...(size.success && size.data ? { textSize: size.data } : {}), ...(dock.success && typeof dock.data === 'boolean' ? { dockAlwaysOnTop: dock.data } : {}), ...(diagnostics.success && typeof diagnostics.data === 'boolean' ? { diagnosticsEnabled: diagnostics.data } : {}), ...(order.success ? { navigationOrder: migrateNavigationOrder(order.data) } : {}) };
}

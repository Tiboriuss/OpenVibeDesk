import { z } from 'zod';
import type { Settings } from './model';
import { defaultUpdateChannel, ignoredUpdateVersionsSchema, updateChannelSchema } from './app-updates';
import { defaultUiLocale, languagePreferences } from './locale';
import { migrateNavigationOrder, navigationOrderSchema } from './navigation';
import { defaultBarSettings, barSettingsPatchSchema, resolveBarSettings } from './ovd-bar';

/** Core categories accepted by host navigation; optional modules contribute their own IDs. */
export const coreSettingsCategoryIds = ['ai', 'agent', 'display', 'dock', 'diagnostics', 'updates', 'modules'] as const;
export type CoreSettingsCategoryId = typeof coreSettingsCategoryIds[number];
// The destination form owns its suggestion kinds and validates the proposed fields.
export const settingsPreparationSchema = z.object({
  category: z.string().max(181).regex(/^[a-z][a-z0-9_.:-]*$/),
  kind: z.string().max(100).regex(/^[a-z][a-z0-9_.-]*$/),
  targetId: z.string().min(1).max(256).optional(),
  values: z.record(z.string(), z.unknown())
}).strict();
export type SettingsPreparation = z.infer<typeof settingsPreparationSchema>;

export const defaultSettings: Settings = { language: defaultUiLocale, textSize: 'standard', dockAlwaysOnTop: true, assistantAlwaysOnTop: false, diagnosticsEnabled: false, updateChannel: defaultUpdateChannel, checkUpdatesOnStartup: true, ...defaultBarSettings };
export const settingsPatchSchema = z.object({
  language: z.enum(languagePreferences).optional().describe('Interface language / Anzeigesprache: system, de (Deutsch), en (English).'),
  textSize: z.enum(['standard', 'large']).optional(),
  dockAlwaysOnTop: z.boolean().optional(),
  assistantAlwaysOnTop: z.boolean().optional().describe('Keep the Assistant chat window above ordinary windows. Takes effect when open and on next open. Check assistantPinSupported in settings.get.'),
  ...barSettingsPatchSchema.shape,
  diagnosticsEnabled: z.boolean().optional().describe('Lokales Diagnose-Logging einschalten oder ausschalten. Standard: aus. Technische Metadaten ohne Chattexte, Mailinhalte, Werkzeugargumente oder Zugangsdaten. Startet keinen Auftrag erneut.'),
  updateChannel: updateChannelSchema.optional().describe('Application release channel: preview includes prereleases such as alpha and beta; stable includes full releases only.'),
  checkUpdatesOnStartup: z.boolean().optional().describe('Check GitHub for app updates at startup.'),
  navigationOrder: navigationOrderSchema.optional().describe('Vollständige gewünschte Reihenfolge sichtbarer OVD-Bar-Eintrags-IDs aus navigation.get; gespeicherte Positionen nicht verfügbarer Module erhalten. [] setzt die Standardreihenfolge zurück.')
}).strict();

// Reminder history is persisted by the update service after validating the offered version.
export const storedSettingsSchema = settingsPatchSchema.extend({
  ignoredUpdateVersions: ignoredUpdateVersionsSchema.optional()
});

export function normalizeSettings(value: unknown): Settings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const language = settingsPatchSchema.shape.language.safeParse(raw.language);
  const size = settingsPatchSchema.shape.textSize.safeParse(raw.textSize);
  const dock = settingsPatchSchema.shape.dockAlwaysOnTop.safeParse(raw.dockAlwaysOnTop);
  const diagnostics = settingsPatchSchema.shape.diagnosticsEnabled.safeParse(raw.diagnosticsEnabled);
  const order = navigationOrderSchema.safeParse(raw.navigationOrder);
  const channel = updateChannelSchema.safeParse(raw.updateChannel);
  const ignored = ignoredUpdateVersionsSchema.safeParse(raw.ignoredUpdateVersions);
  return {
    ...defaultSettings,
    ...resolveBarSettings(raw),
    ...(channel.success ? { updateChannel: channel.data } : {}),
    ...(typeof raw.assistantAlwaysOnTop === 'boolean' ? { assistantAlwaysOnTop: raw.assistantAlwaysOnTop } : {}),
    ...(typeof raw.checkUpdatesOnStartup === 'boolean' ? { checkUpdatesOnStartup: raw.checkUpdatesOnStartup } : {}),
    ...(ignored.success ? { ignoredUpdateVersions: [...new Set(ignored.data)] } : {}),
    ...(language.success && language.data ? { language: language.data } : {}),
    ...(size.success && size.data ? { textSize: size.data } : {}),
    ...(dock.success && typeof dock.data === 'boolean' ? { dockAlwaysOnTop: dock.data } : {}),
    ...(diagnostics.success && typeof diagnostics.data === 'boolean' ? { diagnosticsEnabled: diagnostics.data } : {}),
    ...(order.success ? { navigationOrder: migrateNavigationOrder(order.data) } : {})
  };
}

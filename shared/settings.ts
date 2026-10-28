import { z } from 'zod';
import type { Settings } from './model';

export const defaultSettings: Settings = { textSize: 'standard', dockAlwaysOnTop: true };
export const settingsPatchSchema = z.object({ textSize: z.enum(['standard', 'large']).optional(), dockAlwaysOnTop: z.boolean().optional() }).strict();
export function normalizeSettings(value: unknown): Settings {
  const parsed = settingsPatchSchema.safeParse(value ?? {});
  return parsed.success ? { ...defaultSettings, ...parsed.data } : { ...defaultSettings };
}

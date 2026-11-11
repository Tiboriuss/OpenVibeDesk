import { z } from 'zod';
import type { Settings } from './model';

export interface BarSettings {
  barOrientation: 'vertical' | 'horizontal';
  barSize: number;
  barOpacity: number;
  barPosition: 'free' | 'left' | 'right' | 'top' | 'bottom';
  barAutoHide: boolean;
}

export const defaultBarSettings: BarSettings = {
  barOrientation: 'vertical', barSize: 40, barOpacity: 96, barPosition: 'left', barAutoHide: false,
};

export const barSettingsPatchSchema = z.object({
  barOrientation: z.enum(['vertical', 'horizontal']).optional().describe('Ausrichtung der OVD-Bar: vertikal oder horizontal.'),
  barSize: z.number().int().min(32).max(56).optional().describe('Größe der OVD-Bar: 32–56, Standard 40. Symbole und Bedienflächen skalieren gemeinsam.'),
  barOpacity: z.number().int().min(70).max(100).optional().describe('Deckkraft des OVD-Bar-Hintergrunds in Prozent (70–100). Symbole bleiben deckend.'),
  barPosition: z.enum(['free', 'left', 'right', 'top', 'bottom']).optional().describe('OVD-Bar am Bildschirmrand oder frei platzieren. free behält die zuletzt verschobene Position.'),
  barAutoHide: z.boolean().optional().describe('OVD-Bar bei Nichtbenutzung zu einem erreichbaren Griff einklappen. Maus oder Tastaturfokus blendet sie wieder ein.'),
}).strict();

/** Normalize each field independently so one invalid preference cannot reset the rest. */
export function resolveBarSettings(settings?: Partial<Settings> | Record<string, unknown>): BarSettings {
  const result = { ...defaultBarSettings };
  for (const key of Object.keys(defaultBarSettings) as (keyof BarSettings)[]) {
    const parsed = barSettingsPatchSchema.shape[key].safeParse(settings?.[key]);
    if (parsed.success && parsed.data !== undefined) Object.assign(result, { [key]: parsed.data });
  }
  return result;
}

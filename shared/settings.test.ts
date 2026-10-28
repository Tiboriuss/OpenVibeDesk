import { describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings, settingsPatchSchema } from './settings';

describe('settings', () => {
  it('migrates existing workspaces with no settings', () => {
    expect(normalizeSettings(undefined)).toEqual(defaultSettings);
    expect(normalizeSettings({ dockAlwaysOnTop: false })).toEqual({ textSize: 'standard', dockAlwaysOnTop: false });
  });
  it('accepts supported changes and rejects invalid or unknown settings', () => {
    expect(settingsPatchSchema.parse({ textSize: 'large', dockAlwaysOnTop: false })).toEqual({ textSize: 'large', dockAlwaysOnTop: false });
    expect(settingsPatchSchema.safeParse({ textSize: 'huge' }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ arbitrary: true }).success).toBe(false);
  });
});

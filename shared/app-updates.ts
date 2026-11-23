import { z } from 'zod';

export const updateChannelSchema = z.enum(['preview', 'stable']);
export type UpdateChannel = z.infer<typeof updateChannelSchema>;
export const defaultUpdateChannel: UpdateChannel = 'preview';
export const maxIgnoredUpdateVersions = 32;

export const updateVersionSchema = z.string().max(80)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/)
  .refine(value => {
    const [version, prerelease] = value.split(/-(.*)/s);
    return value === value.trim()
      && version.split('.').every(field => Number(field) <= 65535)
      && !prerelease?.split('.').some(field => /^0\d+$/.test(field));
  });
export const ignoredUpdateVersionsSchema = z.array(updateVersionSchema).max(maxIgnoredUpdateVersions);

export interface AvailableAppUpdate {
  version: string;
  prerelease: boolean;
  summary?: string;
}

export interface AppUpdateStatus {
  currentVersion: string;
  channel: UpdateChannel;
  phase: 'idle' | 'checking' | 'available' | 'current' | 'error' | 'unsupported' | 'development';
  update?: AvailableAppUpdate;
  ignored: boolean;
}

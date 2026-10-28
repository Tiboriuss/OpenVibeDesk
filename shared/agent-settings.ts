import { z } from 'zod';
import type { AgentSettings } from './model';
export type { AgentSettings } from './model';

/** These are execution/context budgets, not provider-specific sampling parameters. */
export const defaultAgentSettings: AgentSettings = {
  maxToolRounds: 25,
  maxToolCalls: 80,
  timeoutSeconds: 300,
  requestTimeoutSeconds: 60,
  maxActiveTools: 12,
  toolSchemaBudget: 40_000,
  historyMessageLimit: 30,
  historyCharBudget: 60_000,
  transportRetries: 1
};
export const agentSettingsBounds = {
  maxToolRounds: { min: 1, max: 100 },
  maxToolCalls: { min: 1, max: 500 },
  timeoutSeconds: { min: 15, max: 1800 },
  requestTimeoutSeconds: { min: 5, max: 600 },
  maxActiveTools: { min: 1, max: 24 },
  toolSchemaBudget: { min: 8000, max: 80_000 },
  historyMessageLimit: { min: 0, max: 100 },
  historyCharBudget: { min: 0, max: 200_000 },
  transportRetries: { min: 0, max: 2 }
} as const;
const bounded = (key: keyof AgentSettings) => z.number().int().min(agentSettingsBounds[key].min).max(agentSettingsBounds[key].max);
export const agentSettingsSchema = z.object({
  maxToolRounds: bounded('maxToolRounds'),
  maxToolCalls: bounded('maxToolCalls'),
  timeoutSeconds: bounded('timeoutSeconds'),
  requestTimeoutSeconds: bounded('requestTimeoutSeconds'),
  maxActiveTools: bounded('maxActiveTools'),
  toolSchemaBudget: bounded('toolSchemaBudget'),
  historyMessageLimit: bounded('historyMessageLimit'),
  historyCharBudget: bounded('historyCharBudget'),
  transportRetries: bounded('transportRetries')
}).strict();
export const agentSettingsPatchSchema = agentSettingsSchema.partial();

/** Invalid legacy fields fall back independently; valid saved choices survive. */
export function normalizeAgentSettings(value: unknown): AgentSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = { ...defaultAgentSettings };
  for (const key of Object.keys(defaultAgentSettings) as (keyof AgentSettings)[]) {
    const parsed = agentSettingsSchema.shape[key].safeParse(raw[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result;
}

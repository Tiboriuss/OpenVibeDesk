import { z } from 'zod';
import type { AgentSettings } from './model';
export type { AgentSettings } from './model';

/** These are execution/context budgets, not provider-specific sampling parameters. */
export const defaultAgentSettings: AgentSettings = {
  maxToolRounds: 25,
  maxToolCalls: 80,
  timeoutSeconds: 300,
  requestTimeoutSeconds: 60,
  contextTokenBudget: 128_000,
  outputTokenReserve: 8192,
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
  contextTokenBudget: { min: 16_000, max: 2_000_000 },
  outputTokenReserve: { min: 1024, max: 65_536 },
  maxActiveTools: { min: 1, max: 24 },
  toolSchemaBudget: { min: 8000, max: 80_000 },
  historyMessageLimit: { min: 0, max: 100 },
  historyCharBudget: { min: 0, max: 200_000 },
  transportRetries: { min: 0, max: 2 }
} as const;
const bounded = (key: keyof AgentSettings) => z.number().int().min(agentSettingsBounds[key].min).max(agentSettingsBounds[key].max);
const agentSettingsFieldsSchema = z.object({
  maxToolRounds: bounded('maxToolRounds'),
  maxToolCalls: bounded('maxToolCalls'),
  timeoutSeconds: bounded('timeoutSeconds'),
  requestTimeoutSeconds: bounded('requestTimeoutSeconds'),
  contextTokenBudget: bounded('contextTokenBudget').describe('Gesamtbudget für Anfrage plus Antwortreserve. Lokale vorsichtige Schätzung: jedes serialisierte UTF-8-Byte der Anfrage zählt als ein Eingabe-Token. Keine exakte Tokenzählung des Anbieters. Mindestens outputTokenReserve + 4096.'),
  outputTokenReserve: bounded('outputTokenReserve').describe('Vom Gesamtkontext freigehaltener Platz für die Antwort in Tokens. Lokale Reserve, kein universell erzwungenes Ausgabelimit des Anbieters. Mindestens 4096 Eingabe-Tokens müssen übrig bleiben.'),
  maxActiveTools: bounded('maxActiveTools'),
  toolSchemaBudget: bounded('toolSchemaBudget'),
  historyMessageLimit: bounded('historyMessageLimit'),
  historyCharBudget: bounded('historyCharBudget'),
  transportRetries: bounded('transportRetries')
}).strict();
const reserveMessage = 'Die Antwortreserve muss mindestens 4.096 Tokens unter dem Gesamtkontext liegen.';
export const agentSettingsSchema = agentSettingsFieldsSchema.refine(value => value.outputTokenReserve + 4096 <= value.contextTokenBudget, { path: ['outputTokenReserve'], message: reserveMessage });
export const agentSettingsPatchSchema = agentSettingsFieldsSchema.partial().refine(value => value.contextTokenBudget === undefined || value.outputTokenReserve === undefined || value.outputTokenReserve + 4096 <= value.contextTokenBudget, { path: ['outputTokenReserve'], message: reserveMessage });

/** Invalid legacy fields fall back independently; valid saved choices survive. */
export function normalizeAgentSettings(value: unknown): AgentSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = { ...defaultAgentSettings };
  for (const key of Object.keys(defaultAgentSettings) as (keyof AgentSettings)[]) {
    const parsed = agentSettingsFieldsSchema.shape[key].safeParse(raw[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  if (result.outputTokenReserve + 4096 > result.contextTokenBudget) result.outputTokenReserve = Math.min(defaultAgentSettings.outputTokenReserve, result.contextTokenBudget - 4096);
  return result;
}

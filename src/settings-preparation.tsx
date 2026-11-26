import { preparationText } from './preparation-copy';
import { useUiLocale } from './locale';
import { useEffect, useRef, useState } from 'react';
import { agentSettingsPatchSchema, defaultAgentSettings } from '../shared/agent-settings';
import { speechSettingsPatchSchema } from '../shared/speech';
import { aiConnectionFields } from '../shared/ai-providers';
import type { SettingsPreparation } from '../shared/model';
import './settings-preparation.css';

export type SettingsSuggestion = SettingsPreparation & { token: number };
type SafeValue = string | number | boolean;
const stringLimits: Record<string, number> = { baseUrl: 2048, smartModel: 200, simpleModel: 200 };

/** Only ordinary configuration fields reach the forms; secret fields are never copied. */
export function preparationValues(suggestion: SettingsSuggestion): Record<string, SafeValue> {
  if (suggestion.kind === 'speech') {
    const parsed = speechSettingsPatchSchema.safeParse(suggestion.values);
    return parsed.success ? parsed.data : {};
  }
  if (suggestion.kind === 'module-repository') {
    const result: Record<string, SafeValue> = {};
    for (const [key, max] of Object.entries({ sourceId: 36, title: 120, url: 2048 })) {
      const value = suggestion.values[key];
      if (typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)) result[key] = value;
    }
    return result;
  }
  if (suggestion.kind === 'agent') {
    const result: Record<string, SafeValue> = {};
    for (const key of Object.keys(defaultAgentSettings)) {
      const parsed = agentSettingsPatchSchema.safeParse({ [key]: suggestion.values[key] });
      if (parsed.success && typeof (parsed.data as Record<string, unknown>)[key] === 'number') result[key] = (parsed.data as Record<string, number>)[key];
    }
    return result;
  }
  if (suggestion.kind !== 'ai') return {};
  const allowed = ['provider', 'protocol', 'authMode', 'apiVersion', 'baseUrl', 'smartModel', 'simpleModel', 'smartThinking', 'simpleThinking', 'workspaceTools', 'confirmationMode'];
  const result: Record<string, SafeValue> = {};
  for (const key of allowed) {
    const value = suggestion.values[key];
    if (Object.hasOwn(aiConnectionFields, key)) {
      const parsed = aiConnectionFields[key as keyof typeof aiConnectionFields].safeParse(value);
      if (parsed.success && typeof parsed.data === 'string') result[key] = parsed.data;
      continue;
    }
    if (key in stringLimits && typeof value === 'string' && !/[\u0000-\u001f\u007f]/.test(value)) result[key] = value.slice(0, stringLimits[key]);
    else if ((key === 'smartThinking' || key === 'simpleThinking') && typeof value === 'string' && ['off', 'low', 'medium', 'high'].includes(value)) result[key] = value;
    else if (key === 'confirmationMode' && (value === 'ask' || value === 'never')) result[key] = value;
    else if (key === 'workspaceTools' && typeof value === 'boolean') result[key] = value;
  }
  return result;
}

export function useSettingsPreparation(suggestion: SettingsSuggestion | undefined, ready: boolean, canApply: boolean, apply: (suggestion: SettingsSuggestion) => void) {
  const lastToken = useRef<number | undefined>(undefined);
  const [pending, setPending] = useState<SettingsSuggestion>();
  useEffect(() => {
    if (!suggestion || !ready || suggestion.token === lastToken.current) return;
    lastToken.current = suggestion.token;
    if (canApply) { apply(suggestion); setPending(undefined); }
    else setPending(suggestion);
  }, [suggestion, ready, canApply]);
  return { pending, accept: () => { if (pending && canApply) { apply(pending); setPending(undefined); } }, dismiss: () => setPending(undefined) };
}

export function SettingsPreparationNotice({ suggestion, blocked, onApply, onDismiss }: { suggestion?: SettingsSuggestion; blocked: boolean; onApply(): void; onDismiss(): void }) {
  const locale = useUiLocale();
  const copy = preparationText[locale];
  if (!suggestion) return null;
  const labels: Record<string, string> = { ...copy, title: 'Name' };
  const values = preparationValues(suggestion);
  return <div className="settings-preparation" role="status"><strong>{copy.waiting}</strong><p>{blocked ? copy.unsaved : copy.ready}</p>{Object.keys(values).length > 0 && <dl>{Object.entries(values).map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{key === 'confirmationMode' ? value === 'never' ? copy.without : copy.with : typeof value === 'boolean' ? value ? copy.on : copy.off : typeof value === 'number' ? value.toLocaleString(locale) : String(value)}</dd></div>)}</dl>}<div><button type="button" disabled={blocked} onClick={onApply}>{copy.apply}</button><button type="button" onClick={onDismiss}>{copy.dismiss}</button></div></div>;
}

import { useEffect, useRef, useState } from 'react';
import { agentSettingsPatchSchema, defaultAgentSettings } from '../shared/agent-settings';
import type { SettingsPreparation } from '../shared/model';
import './settings-preparation.css';

export type SettingsSuggestion = SettingsPreparation & { token: number };
type SafeValue = string | number | boolean;
const stringLimits: Record<string, number> = { name: 120, email: 320, host: 253, username: 320, baseUrl: 2048, smartModel: 200, simpleModel: 200 };
const labels: Record<string, string> = { name: 'Anzeigename', email: 'E-Mail-Adresse', host: 'Server', port: 'Port', security: 'Verschlüsselung', username: 'Benutzername', useImapCredentials: 'IMAP-Zugangsdaten verwenden', baseUrl: 'KI-Endpunkt', smartModel: 'Intelligentes Modell', simpleModel: 'Einfaches Modell', smartThinking: 'Thinking · Intelligent', simpleThinking: 'Thinking · Einfach', workspaceTools: 'Workspace-Werkzeuge', realMailAccess: 'Allgemeiner Mailzugriff', confirmationMode: 'Bestätigungen', maxToolRounds: 'Werkzeugrunden', maxToolCalls: 'Werkzeugaufrufe', timeoutSeconds: 'Maximale Laufzeit (Sekunden)', maxActiveTools: 'Gleichzeitig geladene Werkzeuge', toolSchemaBudget: 'Werkzeugbeschreibungen (Zeichen)', historyMessageLimit: 'Ältere Nachrichten', historyCharBudget: 'Verlauf (Zeichen)', requestTimeoutSeconds: 'Anbieterwartezeit (Sekunden)', transportRetries: 'Wiederholungen bei Übertragungsfehlern' };

/** Only ordinary configuration fields reach the forms; secret fields are never copied. */
export function preparationValues(suggestion: SettingsSuggestion): Record<string, SafeValue> {
  if (suggestion.kind === 'agent') {
    const result: Record<string, SafeValue> = {};
    for (const key of Object.keys(defaultAgentSettings)) {
      const parsed = agentSettingsPatchSchema.safeParse({ [key]: suggestion.values[key] });
      if (parsed.success && typeof (parsed.data as Record<string, unknown>)[key] === 'number') result[key] = (parsed.data as Record<string, number>)[key];
    }
    return result;
  }
  const allowed = suggestion.kind === 'ai' ? ['baseUrl', 'smartModel', 'simpleModel', 'smartThinking', 'simpleThinking', 'workspaceTools', 'realMailAccess', 'confirmationMode'] : suggestion.kind === 'smtp' ? ['host', 'port', 'security', 'username', 'useImapCredentials'] : ['name', 'email', 'host', 'port', 'security', 'username'];
  const result: Record<string, SafeValue> = {};
  for (const key of allowed) {
    const value = suggestion.values[key];
    if (key in stringLimits && typeof value === 'string' && !/[\u0000-\u001f\u007f]/.test(value)) result[key] = value.slice(0, stringLimits[key]);
    else if (key === 'port' && typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535) result[key] = value;
    else if (key === 'security' && (value === 'tls' || value === 'starttls')) result[key] = value;
    else if ((key === 'smartThinking' || key === 'simpleThinking') && typeof value === 'string' && ['off', 'low', 'medium', 'high'].includes(value)) result[key] = value;
    else if (key === 'confirmationMode' && (value === 'ask' || value === 'never')) result[key] = value;
    else if (['workspaceTools', 'realMailAccess', 'useImapCredentials'].includes(key) && typeof value === 'boolean') result[key] = value;
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
  if (!suggestion) return null;
  const values = preparationValues(suggestion);
  return <div className="settings-preparation" role="status"><strong>Vorschlag des Assistenten wartet</strong><p>{blocked ? 'Deine vorhandenen Eingaben bleiben erhalten. Speichere oder verwerfe sie zuerst; übernimm anschließend den Vorschlag.' : 'Du kannst den vorbereiteten Vorschlag jetzt in das Formular übernehmen.'}</p>{Object.keys(values).length > 0 && <dl>{Object.entries(values).map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{key === 'confirmationMode' ? value === 'never' ? 'Ohne Abfragen' : 'Mit Bestätigungen' : typeof value === 'boolean' ? value ? 'Ein' : 'Aus' : String(value)}</dd></div>)}</dl>}<div><button type="button" disabled={blocked} onClick={onApply}>Vorschlag übernehmen</button><button type="button" onClick={onDismiss}>Vorschlag schließen</button></div></div>;
}

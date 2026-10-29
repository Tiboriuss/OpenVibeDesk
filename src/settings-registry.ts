import { defaultSettings } from '../shared/settings';
import { defaultAgentSettings } from '../shared/agent-settings';

export type SettingsCategoryId = string;
export interface SettingsCategory { id: string; title: string; description: string; icon?: string; order?: number; }
export interface SettingsEntry { id: string; category: string; title: string; description: string; keywords: string; defaultValue?: unknown; apply: 'save' | 'immediate'; }
export const navigationOrderEntry: SettingsEntry = { id: 'modules.navigationOrder', category: 'modules', title: 'Seitenleiste & Dock', description: 'Reihenfolge der Module und Navigationseinträge anordnen', keywords: 'modul module seitenleiste sidebar dock navigation reihenfolge sortieren sortierung anordnung verschieben position oben unten zuerst zuletzt anordnen menü menue leiste icons symbole', defaultValue: [], apply: 'immediate' };

/** Metadata shared by navigation and search; actual controls remain in their own components. */
export const settingsCategories = [
  { id: 'ai', title: 'KI & Verbindung', description: 'Anbieter, Modelle und Workspace-Zugriff', order: 10 },
  { id: 'agent', title: 'Agent', description: 'Ausführung, Werkzeuglimits und Gesprächskontext', order: 20 },
  { id: 'display', title: 'Darstellung', description: 'Lesbarkeit und Textgröße', order: 50 },
  { id: 'dock', title: 'Dock & Fenster', description: 'Verhalten des Docks', order: 60 },
  { id: 'modules', title: 'Module', description: 'Zusatzmodule und ihre verfügbaren Funktionen', order: 1000 }
] as const;

export const settingsEntries = [
  { id: 'ai.connection', category: 'ai', title: 'Verbindung', description: 'Endpunkt und API-Schlüssel', keywords: 'ki ai verbindung anbieter provider endpoint endpunkt url basis api schlüssel key zugang passwort', apply: 'save' },
  { id: 'ai.models', category: 'ai', title: 'Modelle', description: 'Modellauswahl und Thinking', keywords: 'ki ai modell modelle intelligent einfach smart simple thinking reasoning denken stufe laden aktualisieren', apply: 'save' },
  { id: 'ai.workspace', category: 'ai', title: 'Workspace-Zugriff', description: 'Was der Chat nutzen darf', keywords: 'ki ai werkzeuge tools tool calling workspace zugriff assistent mail e mail imap echte nachrichten freigabe suchen lesen öffnen datenschutz privatsphäre lokal cloud ohne abfragen nachfragen bestätigung bestätigungen dialog sicherheit automatisch senden versand kontoentfernung rückfragen confirmation', defaultValue: true, apply: 'save' },
  { id: 'agent.execution', category: 'agent', title: 'Ausführung', description: 'Werkzeugrunden, Aufrufe und maximale Laufzeit pro Auftrag', keywords: 'agent assistent schritte werkzeug werkzeuge tool tools runden rounds aufrufe calls limit limits anzahl maximum budget timeout dauer laufzeit sekunden zeit zeitlimit zeitgrenze begrenzung', defaultValue: { maxToolRounds: defaultAgentSettings.maxToolRounds, maxToolCalls: defaultAgentSettings.maxToolCalls, timeoutSeconds: defaultAgentSettings.timeoutSeconds }, apply: 'save' },
  { id: 'agent.context', category: 'agent', title: 'Kontext', description: 'Geladene Werkzeuge, Beschreibungen und älterer Chatverlauf', keywords: 'agent kontext context verlauf history ältere nachrichten historie zeichen text budget werkzeuge tools aktiv geladen schema schemas beschreibungen limit grenzen speicher', defaultValue: { maxActiveTools: defaultAgentSettings.maxActiveTools, toolSchemaBudget: defaultAgentSettings.toolSchemaBudget, historyMessageLimit: defaultAgentSettings.historyMessageLimit, historyCharBudget: defaultAgentSettings.historyCharBudget }, apply: 'save' },
  { id: 'agent.transport', category: 'agent', title: 'Verbindung & Fehlerbehandlung', description: 'Anbieterwartezeit und Wiederholungen bei Übertragungsfehlern', keywords: 'agent verbindung anbieter provider wartezeit timeout request fehler übertragung wiederholung wiederholungen retry retries versuche streaming stream werkzeugantwort transport', defaultValue: { requestTimeoutSeconds: defaultAgentSettings.requestTimeoutSeconds, transportRetries: defaultAgentSettings.transportRetries }, apply: 'save' },
  { id: 'display.textSize', category: 'display', title: 'Textgröße', description: 'Größerer Text für Mail, Chat und Entwürfe.', keywords: 'darstellung anzeige ansicht aussehen bildschirm schrift schriftgröße text textgröße groß größer klein lesbarkeit', defaultValue: defaultSettings.textSize, apply: 'immediate' },
  { id: 'dock.alwaysOnTop', category: 'dock', title: 'Dock im Vordergrund', description: 'Das Dock über anderen Fenstern anzeigen.', keywords: 'dock fenster vordergrund oben immer sichtbar anzeigen position desktop verhalten', defaultValue: defaultSettings.dockAlwaysOnTop, apply: 'immediate' },
  { id: 'modules.installed', category: 'modules', title: 'Installierte Module', description: 'Module aktivieren, deaktivieren und ihren Zustand prüfen', keywords: 'modul module plugin plugins erweiterung zusatz addon aktiv deaktiv status freigabe', apply: 'immediate' },
  { id: 'modules.repositories', category: 'modules', title: 'Modulquellen & Katalog', description: 'Öffentliche und private Repositories, Module installieren und aktualisieren', keywords: 'repository repositories repo github quelle quellen katalog catalog modul module herunterladen download installieren installation aktualisieren update updates token privat private firma unternehmen zugang erweiterung plugin', apply: 'save' },
  navigationOrderEntry
] as const;

function normalize(text: string): string {
  return text.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[-_]/g, ' ').trim();
}

export function matchesSettingsEntry(entry: SettingsEntry, query: string, categories: readonly SettingsCategory[] = settingsCategories): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const category = categories.find(item => item.id === entry.category) ?? { title: entry.category, description: '' };
  const haystack = normalize(`${category.title} ${category.description} ${entry.title} ${entry.description} ${entry.keywords}`);
  return terms.every(term => haystack.includes(term));
}

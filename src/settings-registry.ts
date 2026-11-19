import { defaultSettings, type CoreSettingsCategoryId } from '../shared/settings';
import type { UiLocale } from '../shared/locale';
import { defaultAgentSettings } from '../shared/agent-settings';

export type SettingsCategoryId = string;
export interface SettingsCategory { id: string; title: string; description: string; icon?: string; order?: number; }
export interface SettingsEntry { id: string; category: string; title: string; description: string; keywords: string; defaultValue?: unknown; apply: 'save' | 'immediate'; }
export const navigationOrderEntry: SettingsEntry = { id: 'modules.navigationOrder', category: 'dock', title: 'Einträge & Reihenfolge', description: 'Reihenfolge der Module und Navigationseinträge anordnen', keywords: 'ovd bar leiste modul module seitenleiste sidebar dock navigation reihenfolge sortieren sortierung anordnung verschieben position oben unten zuerst zuletzt anordnen menü menue leiste icons symbole', defaultValue: [], apply: 'immediate' };

export const barAppearanceEntry: SettingsEntry = { id: 'dock.appearance', category: 'dock', title: 'Anordnung & Darstellung', description: 'Ausrichtung, Größe, Bildschirmposition und Deckkraft der OVD-Bar', keywords: 'ovd bar dock sidebar seitenleiste leiste position frei links rechts oben unten horizontal vertikal ausrichtung größe skalierung klein groß icons symbole transparenz transparent deckkraft hintergrund opacity transparency orientation size scale vertical top bottom left right desktop bildschirm monitor', apply: 'immediate' };
export const barBehaviorEntry: SettingsEntry = { id: 'dock.behavior', category: 'dock', title: 'Verhalten', description: 'Im Vordergrund halten und bei Nichtbenutzung einklappen', keywords: 'ovd bar dock sidebar seitenleiste leiste vordergrund immer oben sichtbar ausblenden einblenden verstecken einklappen automatisch autohide auto hide fokus maus schwebend', apply: 'immediate' };

/** Metadata shared by navigation and search; actual controls remain in their own components. */
export const settingsCategories = [
  { id: 'ai', title: 'KI & Verbindung', description: 'Anbieter, Modelle und Workspace-Zugriff', order: 10 },
  { id: 'agent', title: 'Agent', description: 'Ausführung, Werkzeuglimits und Gesprächskontext', order: 20 },
  { id: 'display', title: 'Darstellung', description: 'Sprache und Textgröße', order: 50 },
  { id: 'dock', title: 'OVD-Bar', description: 'Anordnung, Aussehen und Verhalten', order: 60 },
  { id: 'diagnostics', title: 'Diagnose', description: 'Fehler nachvollziehen und Protokolle exportieren', order: 90 },
  { id: 'modules', title: 'Module', description: 'Zusatzmodule und ihre verfügbaren Funktionen', order: 1000 }
] as const satisfies readonly (SettingsCategory & { id: CoreSettingsCategoryId })[];

const englishCategories: Record<CoreSettingsCategoryId, { title: string; description: string }> = {
  ai: { title: 'AI & connection', description: 'Providers, models and workspace access' },
  agent: { title: 'Agent', description: 'Execution, tool limits and conversation context' },
  display: { title: 'Appearance', description: 'Language and text size' },
  dock: { title: 'OVD-Bar', description: 'Layout, appearance and behavior' },
  diagnostics: { title: 'Diagnostics', description: 'Investigate errors and export logs' },
  modules: { title: 'Modules', description: 'Add-ons and their available features' }
};

export function coreSettingsCategories(locale: UiLocale): SettingsCategory[] {
  return settingsCategories.map(item => locale === 'en' ? { ...item, ...englishCategories[item.id] } : item);
}

export const speechSettingsEntry: SettingsEntry = { id: 'ai.speech', category: 'ai', title: 'Spracheingabe', description: 'Mikrofon, Transkription und separate Audio-Verbindung', keywords: 'sprache spracheingabe diktat diktieren mikrofon microphone audio voice speech transcription transkription live realtime aufnahme nach aufnahme openai kompatibel azure foundry deepseek asr whisper', apply: 'save' };
export const settingsEntries = [
  speechSettingsEntry,
  { id: 'ai.connection', category: 'ai', title: 'Verbindung', description: 'Anbieter, Schnittstelle und Anmeldung', keywords: 'ki ai verbindung anbieter provider endpoint endpunkt url basis api schlüssel key zugang passwort openai azure foundry microsoft lokal gateway ollama lm studio auth authentifizierung bearer api-key schnittstelle responses chat completions version deployment chatgpt abo subscription oauth browser pkce anmelden abmelden konto account nutzung usage plan', apply: 'save' },
  { id: 'ai.models', category: 'ai', title: 'Modelle', description: 'Modell- und Deployment-Auswahl mit Thinking', keywords: 'ki ai modell modelle intelligent einfach smart simple thinking reasoning denken stufe laden aktualisieren deployment azure foundry responses chatgpt', apply: 'save' },
  { id: 'ai.workspace', category: 'ai', title: 'Workspace-Zugriff', description: 'Selbstständige Recherche und Bestätigungen für Aktionen', keywords: 'ki ai werkzeuge tools tool calling workspace zugriff assistent suchen lesen öffnen recherchieren selbstständig autonom ohne abfragen nachfragen bestätigung bestätigungen dialog automatisch senden versand kontoentfernung rückfragen confirmation', defaultValue: true, apply: 'save' },
  { id: 'agent.execution', category: 'agent', title: 'Ausführung', description: 'Werkzeugrunden, Aufrufe und maximale Laufzeit pro Auftrag', keywords: 'agent assistent schritte werkzeug werkzeuge tool tools runden rounds aufrufe calls limit limits anzahl maximum budget timeout dauer laufzeit sekunden zeit zeitlimit zeitgrenze begrenzung', defaultValue: { maxToolRounds: defaultAgentSettings.maxToolRounds, maxToolCalls: defaultAgentSettings.maxToolCalls, timeoutSeconds: defaultAgentSettings.timeoutSeconds }, apply: 'save' },
  { id: 'agent.context', category: 'agent', title: 'Kontext', description: 'Gesamtbudget, Antwortreserve, Werkzeuge und Chatverlauf', keywords: 'agent kontext context gesamtkontext gesamtbudget anfrage request tokens token schätzung geschätzt antwort reserve antwortreserve ausgabe output verlauf history ältere nachrichten historie zeichen text budget werkzeuge tools aktiv geladen schema schemas beschreibungen limit grenzen speicher', defaultValue: { contextTokenBudget: defaultAgentSettings.contextTokenBudget, outputTokenReserve: defaultAgentSettings.outputTokenReserve, maxActiveTools: defaultAgentSettings.maxActiveTools, toolSchemaBudget: defaultAgentSettings.toolSchemaBudget, historyMessageLimit: defaultAgentSettings.historyMessageLimit, historyCharBudget: defaultAgentSettings.historyCharBudget }, apply: 'save' },
  { id: 'agent.transport', category: 'agent', title: 'Verbindung & Fehlerbehandlung', description: 'Anbieterwartezeit und Wiederholungen bei Übertragungsfehlern', keywords: 'agent verbindung anbieter provider wartezeit timeout request fehler übertragung wiederholung wiederholungen retry retries versuche streaming stream werkzeugantwort transport', defaultValue: { requestTimeoutSeconds: defaultAgentSettings.requestTimeoutSeconds, transportRetries: defaultAgentSettings.transportRetries }, apply: 'save' },
  { id: 'display.language', category: 'display', title: 'Oberflächensprache', description: 'Sprache der Bedienoberfläche', keywords: 'display language locale interface anzeigesprache systemsprache menüsprache übersetzung sprache deutsch german englisch english system auto automatic', defaultValue: 'system', apply: 'immediate' },
  { id: 'display.textSize', category: 'display', title: 'Textgröße', description: 'Größerer Text für Mail, Chat und Entwürfe.', keywords: 'darstellung anzeige ansicht aussehen bildschirm schrift schriftgröße text textgröße groß größer klein lesbarkeit text size larger font readability', defaultValue: defaultSettings.textSize, apply: 'immediate' },
  barAppearanceEntry,
  barBehaviorEntry,
  { id: 'diagnostics.logging', category: 'diagnostics', title: 'Diagnoseprotokoll', description: 'Technische Abläufe aufzeichnen, Protokolle exportieren und leeren.', keywords: 'diagnose debugging debug log logs logging protokoll fehler fehlerbericht support azure foundry responses streaming schnittstelle verbindung anbieter export exportieren herunterladen leeren löschen aktivieren deaktivieren', defaultValue: false, apply: 'immediate' },
  { id: 'modules.installed', category: 'modules', title: 'Installierte Module', description: 'Module aktivieren, deaktivieren und ihren Zustand prüfen', keywords: 'modul module plugin plugins erweiterung zusatz addon aktiv deaktiv status freigabe ereignis ereignisse event events abonnement abonnements hintergrund gedächtnis memory lernen automatisch zustellung warteschlange quellen', apply: 'immediate' },
  { id: 'modules.repositories', category: 'modules', title: 'Modulquellen & Katalog', description: 'Öffentliche und private Repositories, Module installieren und aktualisieren', keywords: 'repository repositories repo github quelle quellen katalog catalog modul module herunterladen download installieren installation aktualisieren update updates token privat private firma unternehmen zugang erweiterung plugin', apply: 'save' },
  navigationOrderEntry
] as const;

// Also index the alternate language so a search still works after switching languages.
const englishSearch: Record<string, string> = {
  'ai.connection': 'connection provider sign in authentication endpoint API key',
  'ai.models': 'models model choice thinking reasoning',
  'ai.workspace': 'workspace access confirmation tools permissions',
  'ai.speech': 'voice input dictation speech language microphone settings',
  'agent.execution': 'execution run tool round call limits',
  'agent.context': 'context conversation history size',
  'agent.transport': 'connection error handling timeout retries',
  'dock.appearance': 'bar layout appearance size orientation',
  'dock.behavior': 'behavior keep on top collapse hide automatically',
  'diagnostics.logging': 'diagnostic logging export clear logs',
  'modules.installed': 'installed modules enable disable',
  'modules.repositories': 'module repositories catalog install update',
  'modules.navigationOrder': 'entries order sort reorder modules'
};

function normalize(text: string): string {
  return text.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[-_]/g, ' ').trim();
}

export function matchesSettingsEntry(entry: SettingsEntry, query: string, categories: readonly SettingsCategory[] = settingsCategories): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const category = categories.find(item => item.id === entry.category) ?? { title: entry.category, description: '' };
  const core = settingsCategories.find(item => item.id === entry.category);
  const alternate = core && englishCategories[core.id];
  const haystack = normalize(`${category.title} ${category.description} ${core?.title ?? ''} ${core?.description ?? ''} ${alternate?.title ?? ''} ${alternate?.description ?? ''} ${entry.title} ${entry.description} ${entry.keywords} ${englishSearch[entry.id] ?? ''}`);
  return terms.every(term => haystack.includes(term));
}

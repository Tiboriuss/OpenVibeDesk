import type { UiLocale } from '../shared/locale';

export const moduleDialogs = {
  en: {
    changeSubscriptions: (name: string) => `Change events for ${name}?`,
    subscribe: (topics: string[]) => `This module will receive these events in the background:\n${topics.join('\n')}`,
    unsubscribe: 'This module will stop receiving events.',
    disable: (name: string) => `Disable ${name}?`,
    disableDetail: 'Its windows will close. Saved data will be kept.',
    enable: (name: string) => `Enable ${name}?`,
    enableDetail: 'Its views and tools will become available in OVD.',
    approve: (name: string) => `Approve ${name}?`,
    approveDetail: (permissions: string[], source: string, version: string) =>
      `This module runs local code with your user permissions. Its separate process isolates crashes and has the same operating-system access as OVD.\n\nDeclared permissions: ${permissions.join(', ') || 'none'}\n\nSource: ${source}\nVersion: ${version}`,
    cancelled: 'The module action was canceled.',
    eventPending: 'Event delivery is waiting for acknowledgement.'
  },
  de: {
    changeSubscriptions: (name: string) => `Ereignisse für ${name} ändern?`,
    subscribe: (topics: string[]) => `Dieses Modul erhält künftig folgende Ereignisse im Hintergrund:\n${topics.join('\n')}`,
    unsubscribe: 'Dieses Modul erhält keine weiteren Ereignisse.',
    disable: (name: string) => `${name} deaktivieren?`,
    disableDetail: 'Seine Fenster werden geschlossen. Gespeicherte Daten bleiben erhalten.',
    enable: (name: string) => `${name} aktivieren?`,
    enableDetail: 'Seine Ansichten und Werkzeuge werden in OVD verfügbar.',
    approve: (name: string) => `${name} freigeben?`,
    approveDetail: (permissions: string[], source: string, version: string) =>
      `Dieses lokale Modul führt Programmcode mit deinen Benutzerrechten aus. Der eigene Prozess schützt OVD vor Abstürzen und hat dieselben Betriebssystemrechte wie OVD.\n\nDeklarierte Zugriffe: ${permissions.join(', ') || 'keine'}\n\nQuelle: ${source}\nVersion: ${version}`,
    cancelled: 'Die Modulfunktion wurde nicht ausgeführt.',
    eventPending: 'Ereignisverarbeitung wartet auf Bestätigung.'
  }
} satisfies Record<UiLocale, object>;

// Registry details may include vendor or OS errors. Keep unknown messages verbatim.
const englishReasons: Record<string, string> = {
  'Das Modul ist deaktiviert.': 'The module is disabled.',
  'Dieses Modul wurde erkannt. Seine Ausführung benötigt eine ausdrückliche Freigabe.': 'Approve this module to run it.',
  'Die Ausführung benötigt eine ausdrückliche Freigabe.': 'Approve this module to run it.',
  'Für dieses Modul ist kein passender vertrauenswürdiger Hostadapter verfügbar.': 'No trusted host adapter is available for this module.',
  'Mindestens eine deklarierte Modulfunktion ist in dieser OVD-Version nicht angebunden.': 'This version of OVD does not provide all the tools declared by the module.',
  'Diese Modul-API-Version wird von OVD nicht unterstützt.': 'OVD does not support this module API version.',
  'Das Modulverzeichnis konnte nicht gelesen werden.': 'Could not read the module directory.',
  'module.json enthält ungültiges JSON.': 'module.json contains invalid JSON.',
  'Das Modulmanifest entspricht nicht dem OVD-Modulvertrag.': 'The manifest does not match the OVD module contract.',
  'Das Modul konnte nicht geladen werden.': 'Could not load the module.'
};

export function moduleStatusReason(reason: string, locale: UiLocale): string {
  return locale === 'en' ? englishReasons[reason] ?? reason : reason;
}

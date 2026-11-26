export const settingsText = {
  de: {
    search: 'Einstellungen durchsuchen', searchPlaceholder: 'Einstellungen suchen …', clearSearch: 'Suche löschen',
    categories: 'Einstellungskategorien', results: 'Suchergebnisse', searchFor: (term: string) => `Einstellungen für „${term}“`,
    noResults: 'Keine Einstellung gefunden', searchAgain: 'Versuche einen anderen Suchbegriff.',
    languageSaveFailed: 'Sprache konnte nicht gespeichert werden. Bitte erneut auswählen.', textSizeSaveFailed: 'Textgröße konnte nicht gespeichert werden. Bitte erneut auswählen.',
    assistantPin: 'Assistent im Vordergrund halten', unpin: 'Assistentenfenster lösen', pinSaveFailed: 'Fenster-Pin konnte nicht gespeichert werden.', pinUnavailable: 'Auf diesem Desktop nicht verfügbar.',
    language: 'Oberflächensprache', system: 'System', textSize: 'Textgröße', large: 'Größer', standard: 'Standard', reset: 'Auf Standard zurücksetzen',
    installed: 'Installierte Module', loading: 'Wird geladen …', loadingModules: 'Module werden geladen …',
    moduleCount: (active: number, all: number) => `${active.toLocaleString('de')} aktiv · ${all.toLocaleString('de')} installiert`,
    status: { ready: 'Aktiv', disabled: 'Deaktiviert', incompatible: 'Nicht kompatibel', invalid: 'Ungültiges Modul', approval_required: 'Freigabe erforderlich', unsupported: 'Nicht unterstützt' },
    moduleError: 'Modulfehler', required: 'Pflichtmodul', details: 'Details', unknownVersion: 'Unbekannte Version', bundled: 'Mitgeliefert', additional: 'Zusatzmodul',
    changing: 'Wird geändert …', disable: 'Deaktivieren', approve: 'Freigeben & aktivieren', enable: 'Aktivieren',
    toggleFailed: 'Modulzustand konnte nicht geändert werden.', eventsFailed: 'Die Ereigniszustellung konnte nicht geladen werden.', subscriptionsFailed: 'Ereignis-Abonnements konnten nicht gespeichert werden.'
  },
  en: {
    search: 'Search settings', searchPlaceholder: 'Search settings…', clearSearch: 'Clear search',
    categories: 'Settings categories', results: 'Search results', searchFor: (term: string) => `Settings for “${term}”`,
    noResults: 'No matching settings', searchAgain: 'Try another search term.',
    languageSaveFailed: 'Could not save the language. Select it again to retry.', textSizeSaveFailed: 'Could not save the text size. Select it again to retry.',
    assistantPin: 'Keep Assistant on top', unpin: 'Unpin Assistant window', pinSaveFailed: 'Could not save the window pin.', pinUnavailable: 'Unavailable on this desktop.',
    language: 'Interface language', system: 'System', textSize: 'Text size', large: 'Larger', standard: 'Standard', reset: 'Reset to default',
    installed: 'Installed modules', loading: 'Loading…', loadingModules: 'Loading modules…',
    moduleCount: (active: number, all: number) => `${active.toLocaleString('en')} active · ${all.toLocaleString('en')} installed`,
    status: { ready: 'Active', disabled: 'Disabled', incompatible: 'Incompatible', invalid: 'Invalid module', approval_required: 'Approval required', unsupported: 'Unsupported' },
    moduleError: 'Module error', required: 'Required', details: 'Details', unknownVersion: 'Unknown version', bundled: 'Bundled', additional: 'Add-on',
    changing: 'Updating…', disable: 'Disable', approve: 'Approve and enable', enable: 'Enable',
    toggleFailed: 'Could not change module status.', eventsFailed: 'Could not load event delivery status.', subscriptionsFailed: 'Could not save event subscriptions.'
  }
};

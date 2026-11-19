import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { defaultUiLocale, type UiLocale } from '../shared/locale';

const LocaleContext = createContext<UiLocale>(defaultUiLocale);

export function LocaleProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  useLayoutEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useUiLocale(): UiLocale { return useContext(LocaleContext); }

export const uiText = {
  de: {
    loading: 'Arbeitsbereich wird geladen …', settings: 'Einstellungen', files: 'Dateien', draft: 'Entwurf', module: 'Modul',
    moduleLoading: 'Modul wird geladen …', moduleUnavailable: 'Dieses Modul ist nicht verfügbar. Prüfe seinen Status in den Einstellungen unter Module.',
    dismissError: 'Fehlermeldung schließen', close: 'Schließen', unsavedOther: 'Ein anderer Chat enthält einen ungesicherten Entwurf.', openDraft: 'Entwurf öffnen',
    saveStatusUnavailable: 'Der Speicherstatus ist nicht verfügbar.', checkStatus: 'Status prüfen', checking: 'Wird geprüft …',
    retrySave: 'Erneut speichern', saving: 'Wird gespeichert …', showSaveError: 'Speicherfehler anzeigen',
    revealBar: 'OVD-Bar einblenden', revealBarSave: 'OVD-Bar einblenden · Speicherstatus prüfen', moveBar: 'OVD-Bar verschieben', barMenu: 'OVD-Bar-Menü',
    notices: (count: number) => `${count.toLocaleString('de')} ${count === 1 ? 'Hinweis' : 'Hinweise'}`
  },
  en: {
    loading: 'Loading workspace…', settings: 'Settings', files: 'Files', draft: 'Draft', module: 'Module',
    moduleLoading: 'Loading module…', moduleUnavailable: 'This module is unavailable. Check its status under Modules in Settings.',
    dismissError: 'Dismiss error', close: 'Close', unsavedOther: 'Another chat has an unsaved draft.', openDraft: 'Open draft',
    saveStatusUnavailable: 'Save status is unavailable.', checkStatus: 'Check status', checking: 'Checking…',
    retrySave: 'Retry save', saving: 'Saving…', showSaveError: 'Show save error',
    revealBar: 'Show OVD-Bar', revealBarSave: 'Show OVD-Bar and check save status', moveBar: 'Move OVD-Bar', barMenu: 'OVD-Bar menu',
    notices: (count: number) => `${count.toLocaleString('en')} ${count === 1 ? 'notice' : 'notices'}`
  }
};

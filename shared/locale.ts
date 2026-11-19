export const languagePreferences = ['system', 'de', 'en'] as const;
export type LanguagePreference = typeof languagePreferences[number];
export type UiLocale = Exclude<LanguagePreference, 'system'>;

export function resolveUiLocale(preference: LanguagePreference | undefined, systemLocales: readonly string[]): UiLocale {
  if (preference === 'de' || preference === 'en') return preference;
  for (const tag of systemLocales) {
    try {
      const locale = new Intl.Locale(tag);
      if (locale.language === 'de' || locale.language === 'en') return locale.language;
    } catch { /* Some platforms report an empty or non-BCP 47 locale. */ }
  }
  return 'de';
}

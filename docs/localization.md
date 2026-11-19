# Localization

[Documentation index](README.md) · [Module contract](../CONTRIBUTING.md#building-modules) · [Working Notes example](../examples/notes-module/README.md)

OVD supplies one resolved interface language, currently `en` or `de`. New workspaces and older profiles without a saved language start in English. Explicit **Deutsch**, **English** and **System** selections survive upgrades. **System** uses the first supported language from the operating system’s list, falling back to English. Users can change it under **Settings → Appearance → Interface language** or ask the Assistant. A module has two places to translate: its contributions in the host and the controls inside its own window or settings form. Both use the same language.

## Translate the module manifest

OVD selects a module's optional `locales.de` or `locales.en` catalog using the resolved interface language. Each missing field falls back to the corresponding manifest literal. A module with no catalog keeps its existing titles and descriptions. Use canonical BCP 47 tags. Modules can also ship catalogs for languages a future host might support. The [Notes example](../examples/notes-module/module.json) includes a complete English catalog.

```json
{
  "locales": {
    "en": {
      "title": "Notes",
      "description": "Save and find local notes.",
      "keywords": ["memo", "ideas"],
      "navigation": { "notes": { "title": "Notes" } },
      "settings": { "settings": { "title": "Notes", "keywords": ["local storage"] } },
      "tools": { "sample-notes.list": { "label": "List notes", "description": "List or search local notes.", "keywords": ["lookup"] } }
    }
  }
}
```

Key `views`, `navigation`, `settings` and `referenceTypes` by their declared local contribution ID. All accept `title`. Settings also accept `description` and `keywords`. Key `tools` by the original capability name, such as `sample-notes.list`. Keep action effects, limits and prerequisites accurate in every translated description. Translated keywords support module, setting and tool discovery. OVD sends only short module summaries and the tools requested for a task. Tool IDs, schemas, confirmation requirements and backend arguments are shared across languages.

## Translate module views and settings

Inside an isolated view or settings page, listen for the host's `ovd:locale` message. The host sends the resolved language when the frame loads and on each language change. A view that attaches its listener later can request the current language. Switching language keeps the same iframe and input values.

```js
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'ovd:locale') return;
  const { locale } = event.data;
  if (locale !== 'de' && locale !== 'en') return;
  document.documentElement.lang = locale;
  renderLabels(locale);
});
parent.postMessage({ type: 'ovd:get-locale' }, '*');
```

## Publish and verify

Include `locales` only in packages targeting a host with this API-1 extension. Older OVD versions validate the manifest strictly and reject unknown fields. A changed package still requires approval for its new fingerprint. Dynamic server tool sources supply their own descriptions.

1. Open the module and its settings in a development checkout with an isolated profile. Type an unsaved value.
2. Switch between English and German. Check the OVD-Bar entry, window title, search, labels, keyboard controls and existing input. Try a missing catalog field and verify the literal fallback.
3. Ask the Assistant to find the module by a translated keyword and perform a harmless read. Both languages should discover the same logical tool and produce the same structured result.
4. Increment the module version and prepare the repository package as described in [publishing a module](module-repositories.md#publish-a-module).

## Host contributors

React views read `useUiLocale()` from the [locale provider](../src/locale.tsx). Keep both languages next to the feature and use the selected catalog for labels, accessible names, keyboard hints and status messages. Format dates, counts and units with `Intl` at display time. Render parameterized sentences as a unit so names, plurals and word order work in both languages.

Use stable IDs for settings navigation, tools and references. Preserve user-authored titles, message bodies, server data, timestamps and diagnostic codes. Native menus and recovery dialogs obtain their language from the main process. If a workspace is unreadable, recovery resolves the language from the operating system. A display-language change leaves the [speech transcription language](speech-input.md) under its own setting.

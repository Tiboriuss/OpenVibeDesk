# Mitwirken

OpenVibeDesk ist ein frühes Projekt. Issues und Pull Requests sind willkommen; beschreibe bei größeren Änderungen zuerst das Ziel und den geplanten Ansatz.

Für sichtbare Produktnamen, Logos, Farben und neue Oberflächen gilt der [Markenleitfaden](docs/brand.md). Die gemeinsamen Originaldateien unter `assets/brand/` verwenden; das OVD-Signet mit O als linkem Auge, dem V als einzigem violetten Schnabel und D als rechtem Auge nicht pro Modul neu zeichnen.

## Entwicklung

Installiere Node.js 22.13 oder neuer und pnpm 11.25.0. Im Projektordner:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Prüfe Änderungen zunächst praktisch in der App. Bei Bedarf lässt sich der Build lokal prüfen:

```powershell
pnpm build
```

Bitte beschreibe das Verhalten vor und nach der Änderung und wie du es praktisch geprüft hast. Die Entwicklung unter macOS ist praktisch erprobt. Weitere Plattform- und Installationsprüfungen stehen aus; Beiträge für Windows und Linux sind willkommen.

Benutzerdaten, API-Schlüssel, `.env`-Dateien, Datenbanken und generierte Build-Artefakte gehören nicht ins Repository. Nutze für Tests ausschließlich Beispieldaten und temporäre Zugangsdaten. Halte die Electron-Prozessgrenzen ein: keine Node-Integration im Renderer und keine allgemeinen IPC-Brücken.

## Eigene Module

Der OVD-Assistent ist das Pflichtmodul `ovd-assistant`. Fachmodule registrieren sich über ihr Manifest; der Chat benötigt dafür keine modulspezifischen Prompts oder Werkzeuglisten. Mail liegt mit Backend und Oberfläche unter `modules/ovd-mail/`, der Dateimanager unter `modules/ovd-files/` und die MCP-Anbindung unter `modules/ovd-mcp/`. Alle drei sind optionale Module. Ein kopierbares Fremdmodul steht in [`examples/notes-module/`](examples/notes-module/README.md).

| Vorlage | Zeigt |
| --- | --- |
| `ovd-mail` | Fachoberflächen, Kontoeinstellungen, gemeinsame Dienste und Mailreferenzen |
| `ovd-files` | Dateinavigation, Inhaltsseiten und allgemeine Modulreferenzen |
| [`ovd-mcp`](modules/ovd-mcp/README.md) | Verbindungseinstellungen, Geheimnisspeicher und dynamische Werkzeugquellen |
| `sample-notes` | Eigenständiges Prozessmodul mit HTML-Oberfläche, ohne Kernänderung installierbar |

Eigene Module werden beim Start aus `<userData>/modules/<modulordner>/module.json` gelesen; unter macOS liegt der Benutzerordner derzeit in `~/Library/Application Support/ai-workspace/`. Eingebaute Module liegen unter `<appPath>/modules/`. Nach dem Kopieren OVD neu starten und **Einstellungen → Module** öffnen. Fremdmodule brauchen eine ausdrückliche Freigabe ihres Dateifingerprints; geänderte Dateien erfordern eine neue Freigabe. Deaktivieren beendet die Bereitstellung der Beiträge und Funktionen, löscht aber keine Moduldaten. Freigaben und deaktivierte IDs stehen in `<userData>/module-settings.json`, eigene Daten in `<userData>/module-data/<moduleId>/`.

Ein Fremdmodul enthält mindestens:

```text
mein-modul/
  module.json
  backend.cjs
  ansicht.html       # optional
  einstellungen.html # optional
```

`module.json` folgt [`ModuleManifest`](shared/modules.ts) und dem validierten Schema in [`electron/modules.ts`](electron/modules.ts):

- `apiVersion: 1`, eindeutige `id`, `title`, semantische `version`, kurze `description` und passende `keywords` für die Modulsuche. Fremdmodule dürfen keine `ovd-`-IDs, Pflichtmodule oder internen Hostadapter beanspruchen.
- `runtime: { "type": "process", "entry": "backend.cjs" }` startet ein vorbereitetes JavaScriptbackend. Abhängigkeiten vorher bündeln; OVD installiert beim Laden keine Pakete.
- `tools` beschreibt jede Funktion mit Namen, verständlicher Beschreibung, optionalem Aktivitätslabel und begrenztem Objekt-JSON-Schema ohne `$ref`. Namen beginnen mit der eigenen Modul-ID, etwa `mein-modul.list`. `capabilities` führt dieselben Namen auf. Der Host erzeugt daraus anbietertaugliche Werkzeugnamen; Backend und Oberfläche verwenden weiterhin die Manifestnamen.
- `permissions` beschreibt die beabsichtigten Zugriffe. `confirmation` an einer Funktion nutzt vor dem Aufruf die zentrale Bestätigung des Hosts. Standardmäßig wird gefragt; bei ausdrücklich gespeichertem „Ohne Abfragen“ wird für beauftragte Assistentenaktionen automatisch zugestimmt. Die Dateifingerprint-Freigabe neuen oder geänderten Modulcodes bleibt davon getrennt. Versand, destruktive Änderungen und geschützte Einstellungen brauchen einen prüfbaren Bestätigungsablauf.
- `contributions.views` und `.settings` verweisen mit `entry` auf lokale HTML-Dateien; `.navigation` verweist auf eine im Modul deklarierte Ansicht. IDs müssen innerhalb des jeweiligen Beitragstyps eindeutig sein. Settings mit Beschreibung und Suchwörtern in das [Settings-Konzept](docs/settings-design.md) einordnen.

Der Backendvertrag lautet:

```js
exports.activate = async ({ moduleId, dataDirectory }) => ({
  tools: {
    'mein-modul.list': async (args, { signal }) => ({ items: [] })
  },
  dispose: async () => { /* Verbindungen und Ressourcen schließen */ }
});
```

Alle Manifestfunktionen müssen genau einmal implementiert sein. UI und Assistent rufen dieselben Funktionen auf; jede über die Oberfläche verfügbare Fachfunktion braucht diesen Zugang. Eingaben zusätzlich fachlich validieren, Ressourcen-IDs prüfen, Geheimnisse aus Ergebnissen halten, Abbrüche beachten und begrenzte JSON-Ergebnisse mit klaren Fehlern und Suchgrenzen liefern. Änderungen sicher speichern und Seiteneffekte nicht automatisch wiederholen. `activate` hat zehn Sekunden, einzelne Aufrufe höchstens 60 Sekunden; Argumente sind auf 16 KiB und Ergebnisse auf 32 KiB begrenzt. OVD lässt höchstens 16 gleichzeitige Aufrufe pro Modul zu.

Abfragen möglichst aus wenigen kombinierbaren Fachwerkzeugen aufbauen: Listen und Zählen verwenden dieselben validierten Filter. Eine Zählung darf nicht bloß die geladene Seite zählen. Ergebnisse nennen `scope`, `observedAt`, `countExact` und `complete`; bei unvollständiger Zählung ist `count` eine Untergrenze. Empfangszeit und Absenderdatum unterscheiden, relative Kalenderzeiträume in der lokalen IANA-Zeitzone mit exklusivem Ende auflösen. Die Systemzeit kommt bereits als kleiner Hostkontext mit jeder Anfrage; Zeit- und Rechenwerkzeuge werden wie andere Funktionen gezielt nachgeladen. Fachmodule sollen keine eigene Uhrzeit aus Chatdaten erraten oder ein separates Werkzeug für jede einzelne Frage benötigen.

HTML-Ansichten laufen in einem isolierten iframe ohne Node- oder Workspace-API. Sie senden `parent.postMessage({ type: 'ovd:invoke', requestId, tool, args }, '*')` und empfangen `ovd:result` mit derselben `requestId`, `ok` sowie `result` oder `error`. Dabei `event.source === parent` prüfen. Der Host akzeptiert nur das zugehörige Absenderfenster und Funktionen des eigenen Moduls. Assets des Beispiels sind inline eingebettet; beliebige externe Inhalte werden nicht geladen.

Der separate Backendprozess bietet Fehlerisolation, **keine Betriebssystem-Sandbox**. Freigegebener Code läuft mit den normalen Benutzerrechten; `permissions` ist keine erzwungene Beschränkung von Dateisystem oder Netzwerk. Modulautoren verantworten diese Zugriffe. Das Manifest ist auf 64 KiB, ein Modul auf 16 MiB, 200 Dateien und zwölf Verzeichnisebenen begrenzt; symbolische Verweise sind nicht erlaubt.

Den Kontextverbrauch bei jeder Erweiterung mitbedenken: Zunächst sieht der Assistent höchstens 20 kurze Modulbeschreibungen und nur `find_modules`/`get_module_tools`. Funktionssuche mit engem `query` und Seitenbegrenzung ermöglichen; der Agent hält höchstens zwölf ausgewählte Werkzeuge für den laufenden Auftrag. Beschreibungen müssen ausreichen, um eine Funktion gezielt zu finden. Keine vollständigen Kataloge, Nutzerdaten oder Schemas in die Modulbeschreibung oder dauerhafte Chatnachrichten schreiben.

Eingebaute Adapter mit dynamischen Werkzeugen können den allgemeinen `ModuleToolProvider` aus `shared/module-tool-provider.ts` registrieren. Er bietet kurze virtuelle Quellen, seitenweise Schemaauswahl und einen exakten aktuellen Lookup. Quell-IDs liegen unter der eigenen Modul-ID, Werkzeuge sind an ihre aktuelle Konfigurations-/Schemaversion gebunden. Der Host berücksichtigt den Parentstatus und laufende Aufrufe. Der Provider prüft selbst Berechtigungen und Argumente unmittelbar vor der Ausführung. Externe Serveranweisungen werden nicht zu Systemanweisungen. MCP nutzt diesen Vertrag, ohne einen Sonderfall im Agentenloop einzuführen.

Referenzen enthalten eine stabile Ressourcen-ID und eine begrenzte Momentaufnahme mit erkennbarem Umfang und Stand. Das zuständige Modul bietet zusätzlich einen gezielten Inhaltsabruf mit Fortsetzung an; auch einzelne lange Inhalte müssen vollständig erreichbar bleiben. Öffnen und Lesen einer Ressource sind getrennte Funktionen. Verschachtelte Referenzen werden nicht automatisch mit aufgelöst.

Der allgemeine Vertrag in `shared/references.ts` transportiert beim Ziehen ausschließlich `{moduleId,type,id}`. Eingebaute Hostadapter registrieren die Auflösung im `ModuleReferenceRegistry`; Dateilisten oder Renderer dürfen keinen fremden Text als vertrauenswürdige Momentaufnahme einreichen. Sichtbare Auswahl, Entfernen, Senden, lokale Wiederherstellung und Chat-Abzweigungen erhalten die Referenzen. Die reine Deklaration von `referenceTypes` führt keinen Modulcode aus und ersetzt keinen Resolver.

Praktisch prüfen: Modul kopieren, Freigabe und Neustart, eigene Ansicht und Einstellungen, denselben Auftrag im Assistenten, Abbruch, erforderliche Bestätigung sowie Deaktivieren. Vorhandene Mailreferenzen, Drag & Drop und lokale Daten müssen erhalten bleiben. Keine echten Mails für eine Funktionsprüfung versenden; keine routinemäßigen neuen Testdateien oder GitHub Actions hinzufügen.

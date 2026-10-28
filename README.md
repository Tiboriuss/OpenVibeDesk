# OpenVibeDesk

Ein lokales Open-Source-Projekt für einen installierbaren Single-User-AI-Workspace. Der OVD-Assistent ist als gleichberechtigter Zugang zu allen Fachfunktionen des Workspace gedacht: Informationen finden, Ansichten öffnen, Entwürfe vorbereiten und zulässige Änderungen über dieselben Dienste wie die Oberfläche ausführen. Version 0.1 enthält einen ersten IMAP- und SMTP-Zugang und einen Chat über einen OpenAI-kompatiblen Endpunkt. Intern vorhandene Beispieldaten bleiben erhalten, erscheinen aber nicht als Postfach in der Oberfläche. Die vollständige Abdeckung aller vorhandenen Funktionen durch gemeinsame Assistenz-Capabilities ist ein verbindlicher Produktgrundsatz; noch fehlende Zugänge werden als Integrationslücken ergänzt. Mail, Dateien und MCP-Verbindungen sind eigene optionale Module.

## Jetzt ausprobieren

Voraussetzungen: Node.js 22.13+ oder 24+ und pnpm 11.25.0. Die Entwicklung wurde unter macOS praktisch erprobt; zusätzliche Plattform- und Installationspaketprüfungen bleiben Teil der Roadmap.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Mail, Assistant, Entwürfe und Dateien öffnen sich als eigenständige Desktop-Fenster. Unter **Einstellungen → KI-Verbindung** eine Basis-URL (z. B. `https://api.openai.com/v1`) und bei Bedarf einen API-Schlüssel speichern. Anschließend lädt die App verfügbare Modell-IDs über `/models`. Wähle je ein intelligentes und ein einfaches Modell samt eigener Thinking-Stufe und speichere die Auswahl; falls der Anbieter keine Modellliste liefert, lassen sich IDs manuell eingeben. Im Chat kann zwischen beiden Modellen gewechselt werden; die zugehörige Thinking-Stufe wird dabei automatisch verwendet. Bei „Aus“ wird kein `reasoning_effort`-Parameter gesendet; das schaltet nicht zwingend internes Thinking des Modells ab. Andere Stufen funktionieren nur, wenn der Endpunkt sie unterstützt.

Der Schlüssel liegt im Zugangsdaten-Speicher des Betriebssystems. Nachrichten, Chatverlauf, angehängter Kontext und vom Chat angeforderte Werkzeugergebnisse werden an den gewählten Anbieter übermittelt. HTTP ist ausschließlich für lokale Loopback-Endpunkte erlaubt. Der Chat verwendet `/chat/completions` mit Streaming und Werkzeugaufrufen. Die Ausgabe lässt sich stoppen; bereits empfangener Text bleibt erhalten. Der Endpunkt muss Streaming im OpenAI-kompatiblen SSE-Format und für die Workspace-Werkzeuge kompatibles Tool-Calling unterstützen.

Datum, aktuelle lokale Uhrzeit, Zeitzone und Sprachformat werden dem Assistenten bei jeder Anfrage mitgegeben. Zeiträume wie heute oder letzte Woche werden mit Sommerzeitregeln berechnet. Für Mailfragen stehen gemeinsame Serverfilter zum Auflisten und Zählen bereit, etwa „Wie viele ungelesene Calimoto-Mails kamen heute?“ oder „Wann kam die letzte Mail?“. Im Mailfenster bietet **Filter & Anzahl** dieselben Funktionen. Ergebnisse nennen Konto-/Ordnerumfang und Stand und kennzeichnen unvollständige Erhebungen. Zählungen laden keine Mailtexte für die KI; Datumsabfragen können zur genauen Prüfung Metadaten benötigen. Begrenzte Rechen- und Zeitdifferenzwerkzeuge ergänzen den Assistenten bei Bedarf.

Die Workspace-Werkzeuge lassen sich in den KI-Einstellungen ausschalten, etwa für Modelle ohne Tool-Calling-Unterstützung. Der Assistent erhält zunächst nur kurze Beschreibungen der verfügbaren Module. Mit `find_modules` findet er das passende Modul und mit `get_module_tools` lädt er gezielt dessen benötigte Funktionen. Für „such nach hetzner“ entdeckt er beispielsweise das Mailmodul, lädt dessen Suchfunktion und führt erst damit die eigentliche Mailsuche aus. Werkzeugschemas werden nur für den aktuellen Auftrag geladen und nicht im Chatverlauf gespeichert. Oberfläche und Assistent verwenden dieselben validierten Fachfunktionen. Die ausdrücklich referenzierte oder im Mailfenster ausgewählte Mail ist gezielt für den Auftrag zugänglich.

Unter **Einstellungen → KI → Workspace-Zugriff** kann der allgemeine Zugriff auf echte IMAP-Mails ausdrücklich freigegeben werden; er ist standardmäßig ausgeschaltet. Für eine konkrete Serversuche bietet die App bei ausgeschalteter allgemeiner Freigabe eine einmalige sichtbare Zustimmung mit Suchbegriff, Konten und KI-Anbieter an. Diese Zustimmung aktiviert die allgemeine Freigabe nicht. Die Serversuche prüft pro Auftrag bis zu zehn auswählbare Ordner und zeigt höchstens 50 Treffer; Konto und Ordner können eingegrenzt werden. Das Ergebnis nennt den tatsächlichen Suchumfang (`scope`), durchsuchte und noch ausstehende Ordner (`foldersSearched`, `foldersRemaining`) und weitere verfügbare Treffer. Es ist keine Behauptung, das gesamte Postfach vollständig durchsucht zu haben. Die Treffer erscheinen auch im Mailfenster. Nachrichtentexte werden beim Lesen einer gefundenen Mail nachgeladen; Suchergebnisse und angeforderte Mailinhalte können an den eingestellten KI-Anbieter übertragen werden. Auf ausdrücklichen Auftrag kann der Chat zu einer verfügbaren Nachricht einen lokal gespeicherten Antwortentwurf erstellen und öffnen. Standardmäßig gilt für Versand und andere freigabepflichtige Aktionen derselbe sichtbare Bestätigungsschritt wie in der Oberfläche. Unter **KI → Workspace-Zugriff → Ohne Abfragen** lassen sich diese einzelnen Bestätigungen für ausdrücklich angeforderte Assistentenaktionen abschalten, einschließlich Mailversand und Kontoentfernung. Der Modus ist standardmäßig aus, wird erst mit „KI-Einstellungen speichern“ wirksam und ist im Chat erkennbar. Bestehende Zugriffsrechte gelten weiter; neue oder geänderte Fremdmodule benötigen weiterhin ihre eigene Freigabe. Chatantworten mit Mailinhalten werden lokal gespeichert. Das Öffnen einer echten Mail durch den Chat ändert ihren Gelesen-Status nicht.

Eine einzelne echte Mail lässt sich aus der Nachrichtenliste in den Chat ziehen und dort vor dem Senden wieder entfernen. Beim Ziehen wird nur ihre ID übertragen; der Main-Prozess prüft sie und liefert die Metadaten für den Referenz-Chip. Erst beim ausdrücklichen Senden wird ein begrenzter Textauszug der ausgewählten Mail als Kontext an den KI-Anbieter übermittelt und als Momentaufnahme im lokalen Chat gespeichert. Diese Auswahl gibt dem Chat keinen allgemeinen Zugriff auf das Postfach; die Freigabe für selbstständige Mail-Werkzeuge bleibt davon unabhängig. Die lokale Chatdatenbank ist nicht verschlüsselt.

Unter **Einstellungen → E-Mail** lassen sich IMAP-Konten mit Passwort oder App-Passwort anlegen und prüfen. Die Verbindung nutzt TLS direkt oder verpflichtendes STARTTLS mit Zertifikatsprüfung. Zugangsdaten liegen im Zugangsdaten-Speicher des Systems, Kontometadaten in einer lokalen Datei. Konten, deren Anbieter OAuth verlangt, werden noch nicht unterstützt. Das Mailfenster lädt zunächst bis zu 25 aktuelle Nachrichten pro Ordner; ältere Nachrichten können seitenweise nachgeladen werden. Höchstens 500 Nachrichten werden gleichzeitig angezeigt. Die Mailansicht verbindet Konto- und Ordnernavigation, eine kompakte Aktionsleiste, Nachrichtenliste und Lesebereich. Ihre Suche kann Serverergebnisse anzeigen; lokale Ungelesen-/Anhangfilter und das Filtern bereits geladener Metadaten bleiben verfügbar. Nachrichtentexte werden erst bei Bedarf geladen. Auch Server-Suchtreffer lassen sich öffnen und per Drag & Drop im Chat referenzieren. Anhänge können über einen Speicherdialog heruntergeladen und Nachrichten ausdrücklich als gelesen oder ungelesen markiert werden. Das bloße Öffnen einer echten Nachricht ändert diesen Status nicht. Ein dauerhafter Offline-Cache, eine vollständige Synchronisierung und eine HTML-Ansicht fehlen noch.

Für den Versand muss SMTP für das gewünschte Konto in den E-Mail-Einstellungen eingerichtet werden. Entwürfe werden lokal gespeichert und standardmäßig nach ausdrücklicher Bestätigung über SMTP versendet. Im gespeicherten Modus „Ohne Abfragen“ genügt dem Assistenten der eindeutige Versandauftrag; der manuelle Senden-Button behält seinen Bestätigungsdialog. Meldet die App einen unklaren Versandstatus, könnte der Server die Nachricht bereits angenommen haben; vor einem erneuten Versand den Status beim Anbieter prüfen. Eine Annahme durch den SMTP-Server garantiert weder die Zustellung noch einen Eintrag im Gesendet-Ordner.

Der interne Paketname `ai-workspace`, die bisherige App-ID und der Zugangsdaten-Eintrag behalten ihre Namen, damit vorhandene lokale Daten und gespeicherte Schlüssel nach der Umbenennung weiterverwendet werden können.

Das Dock öffnet die Fenster und beendet die gesamte App nach Bestätigung. Über **Chats** lassen sich Unterhaltungen erstellen, durchsuchen, umbenennen und öffnen. Einen anderen Chat per Drag & Drop oder über das Referenz-Symbol in den aktuellen Chat übernehmen; der Chip lässt sich vor dem Senden wieder entfernen. Die Referenz enthält eine ID und einen begrenzten Textauszug. Weitere gespeicherte Chatnachrichten kann der Assistent bei Bedarf seitenweise abrufen. Nachrichten können in einer neuen Chat-Abzweigung bearbeitet oder Antworten dort erneut erzeugt werden; der ursprüngliche Chat bleibt erhalten. Entwürfe, Einstellungen und Chatverläufe bleiben lokal gespeichert.

Das optionale Dateienmodul startet in Dokumente und navigiert frei durch alle mit den Betriebssystemrechten zugänglichen Ordner. Über die Pfadleiste beziehungsweise ⌘/Strg+L lassen sich absolute Pfade und `~` eingeben. Dateien lassen sich filtern, sortieren, als Textvorschau öffnen, im Chat referenzieren und an Mailentwürfe hängen. Der Assistent verwendet dieselben Dienste. UTF-8-Texte bis 2 MiB sind seitenweise lesbar; PDF, Office und andere Binärformate liefern vorerst Metadaten. Im Chat werden zunächst nur begrenzte Momentaufnahmen übertragen; weitere Inhalte lädt der Assistent gezielt nach.

## MCP-Verbindungen

Das optionale Modul `ovd-mcp` ergänzt **Einstellungen → MCP**. Dort lassen sich lokale Server über **Stdio** mit Programm, Argumenten und optionalem Arbeitsordner sowie entfernte Server über **Streamable HTTP** einrichten. HTTPS und lokale HTTP-Endpunkte werden unterstützt. Bearer-Tokens und geheime Umgebungswerte werden im System-Schlüsselspeicher gehalten; die Oberfläche zeigt gespeicherte Geheimnisse nicht wieder an. OAuth und der ältere SSE-Transport gehören noch nicht zu dieser ersten Ausbaustufe.

Server zunächst speichern, verbinden und anschließend die gewünschten Werkzeuge ausdrücklich freigeben. Ein neuer Server stellt noch keine Werkzeuge für den Assistenten bereit. Der automatische Verbindungsaufbau beim Appstart ist optional und anfangs aus. Lokale MCP-Server sind Programme mit den normalen Benutzerrechten; es handelt sich nicht um eine Betriebssystem-Sandbox.

Eine verbundene, freigegebene Quelle erscheint mit ihrem Namen und ihrer kurzen Beschreibung in der Modulsuche. `get_module_tools` lädt ausschließlich die benötigten echten Werkzeugschemas. Änderungen an Verbindung, Schema oder Freigabe machen alte Angebote ungültig; sie werden nicht stillschweigend weiterverwendet. Standardmäßig berücksichtigt ein Aufruf die OVD-Bestätigungen; der gespeicherte Modus „Ohne Abfragen“ gilt auch hier. Ein abgebrochener oder unklarer Aufruf wird nicht automatisch wiederholt. Ein kurzes Protokoll der aktuellen App-Sitzung enthält Server, Werkzeug, Dauer und Ergebnis ohne Argumente oder Inhalte.

Ein [kleiner MCP-Beispielserver](examples/mcp-server/README.md) zeigt die Anbindung eines eigenen Frameworks. Details stehen im [MCP-Modul](modules/ovd-mcp/README.md).

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm pack:win
```

`pack:win` erzeugt einen NSIS-Installer unter `release/`. Die Pakete sind derzeit nicht signiert.

## Milestones

| Schritt | Inhalt | Ergebnis |
| --- | --- | --- |
| 0.1 · Schale | Electron/React/TypeScript, Dock, unabhängige Fenster, SQLite-Zustand mit internen Beispieldaten, Chat mit Streaming und Sessions, typisierte Agent-UI-Aktionen, Dateidialog | **Implementiert** |
| 0.2 · Mail lesen | IMAP-Konten, begrenzte Nachrichtenliste, Serversuche und Textansicht, Anhang-Download und manueller Gelesen-Status vorhanden; dauerhafte Synchronisierung, Threads und HTML-Darstellung folgen | Begonnen |
| 0.3 · Mail schreiben | Lokale Textentwürfe, Anhänge und SMTP-Versand nach Bestätigung vorhanden; umfangreicher Editor, Forward und weitere Mailfunktionen folgen | Begonnen |
| 0.4 · LLM und Agent | OpenAI-kompatibler Chat mit Abbruch, Modulregistrierung und gezieltem Nachladen validierter Werkzeuge; begrenzte Serversuche mit Freigabe; Action-Protokoll und weitere Integrationen folgen | Begonnen |
| 0.5 · MCP | Optionales Modul mit Stdio und Streamable HTTP, Servereinstellungen, Geheimnisspeicher, gezieltem Schemaangebot, Werkzeugfreigaben und Sitzungsprotokoll; OAuth, Ressourcen und Prompts folgen | Basis implementiert |
| 0.6 · Plattformen | macOS-Entwicklung praktisch erprobt; weitere Plattformtests, Installationspakete, Signierung, Migrationen, Import/Export, Accessibility und Updates folgen | Begonnen |

## Architektur

- **Renderer (`src/`)**: Oberfläche der einzelnen nativen Fenster ohne Node-Integration. E-Mail-Inhalt wird derzeit ausschließlich als Text angezeigt.
- **Preload (`electron/preload.ts`)**: kleine, typisierte API für Zustand und explizite Dateiauswahl; kein generischer IPC-Proxy.
- **Main (`electron/`)**: Electron-Fenster, Senderprüfung für IPC, lokale Dateizugriffe und SQLite-Datei. Renderer-Sandbox und `contextIsolation` sind aktiv; Navigation, neue Fenster und Browser-Berechtigungen werden gesperrt.
- **Shared (`shared/`)**: Datenmodell, gemeinsame Capabilities und validierte Aktionen für Oberfläche und Assistent. Neue Fachfunktionen brauchen zugleich den passenden Assistenzzugang; erforderliche Nutzerfreigaben bleiben Teil des gemeinsamen Ablaufs.
- **Module (`modules/`)**: Pflichtmodul `ovd-assistant` und optionale Module `ovd-mail`, `ovd-files` und `ovd-mcp`. Jedes Fachmodul besitzt Backend, Oberfläche und Manifest. Dynamische Werkzeugquellen wie MCP-Server nutzen einen gemeinsamen Providervertrag im Modulhost.

Der Assistent soll alle implementierten OVD-Funktionen über den angebotenen Capability-Katalog erreichen können. Versand, destruktive Änderungen und geschützte Einstellungen werden dabei zur sichtbaren Nutzerfreigabe vorbereitet. Schlüssel und Passwörter bleiben im sicheren Speicher und werden dem Modell nicht offengelegt. Der aktuelle Katalog und die jeweiligen Ausführungsergebnisse bestimmen, was der Assistent in einer Sitzung tatsächlich tun kann.

Produktvorgaben: [Mail-Leitfaden](docs/mail-design.md) und [Settings-Konzept](docs/settings-design.md). Details und Sicherheitsgrenzen: [Architektur](docs/architecture.md) und [ADR 0001](docs/decisions/0001-local-desktop.md).

## Eigene Module

OVD erkennt beim Start Modulordner mit einer `module.json`. Eigene Module kommen in `modules` innerhalb des OVD-Benutzerdatenordners; unter macOS ist das derzeit `~/Library/Application Support/ai-workspace/modules/`. Unter **Einstellungen → Module** lassen sie sich prüfen, freigeben und deaktivieren. Der OVD-Assistent bleibt immer aktiv. Deaktivierte Module stellen keine Werkzeuge, Ansichten oder Einstellungsbeiträge bereit; ihre Daten bleiben erhalten.

Ein Modul bringt Metadaten, Funktionsschemas, ein JavaScriptbackend und bei Bedarf eigene HTML-Ansichten sowie Einstellungen mit. Externer Code startet erst nach ausdrücklicher Freigabe für seinen Dateifingerprint; eine Änderung benötigt eine neue Freigabe. Der Backendprozess hat die normalen Rechte des angemeldeten Nutzers und ist keine Betriebssystem-Sandbox. Nur vertrauenswürdigen Modulcode freigeben.

Der [Modulvertrag für Entwickler](CONTRIBUTING.md#eigene-module) beschreibt Registrierung, Steuerbarkeit und Grenzen. Das eigenständige [Notizmodul](examples/notes-module/README.md) zeigt Oberfläche und Assistentenwerkzeuge und wird nicht automatisch installiert.

## Entwicklungsstand und Grenzen

Die SQLite-Bindung verwendet `sql.js` (SQLite als WASM) und schreibt die Datenbankdatei nach Änderungen atomar. Das ist für den kleinen 0.1-Zustand portabel; vor einer großen Maildatenbank wird auf eine dateibasierte native SQLite-Bindung mit WAL und Migrationen umgestellt. Der Entwurfseditor ist ein Texteditor; eine HTML-Mailansicht fehlt. Die lokale SQLite-Datei ist nicht verschlüsselt. Abgerufene IMAP-Nachrichten liegen im Arbeitsspeicher; lokal gespeicherte Entwürfe und Chatantworten können jedoch echte Mailinhalte enthalten, und heruntergeladene Anhänge werden am gewählten Ort gespeichert. Vor einem dauerhaften Mail-Cache ist ein Schutzkonzept für ruhende Daten festzulegen.

## Lizenz

MIT — siehe `LICENSE`.

Unter **Einstellungen → Agent** lassen sich Werkzeugrunden, Gesamtaufrufe, Laufzeit und Anbieterwartezeit, gleichzeitig geladene Werkzeuge, Werkzeug-/Verlaufbudgets sowie Transportwiederholungen einstellen. Standard sind 25 Runden, 80 Aufrufe und fünf Minuten pro Agentenlauf. Modulsuche und Werkzeugladen zählen mit. Bei einer erreichten Grenze zeigt der Chat den Verbrauch und einen Einstellungsbutton; bereits ausgeführte Aktionen bleiben erhalten. Neue Werte gelten für neue Aufträge, ohne einen automatischen Wiederanlauf.

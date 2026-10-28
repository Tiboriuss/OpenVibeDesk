# OpenVibeDesk

Ein lokales Open-Source-Projekt für einen installierbaren Single-User-AI-Workspace. Version 0.1 enthält Mock-Mail und einen echten Chat über einen OpenAI-kompatiblen Endpunkt. IMAP, SMTP, Agent-Tools und MCP folgen in eigenen Milestones.

## Jetzt ausprobieren

Voraussetzungen: Node.js 22.13+ oder 24+, pnpm 11.25.0 und Windows. Linux/macOS sind im Build vorbereitet, aber noch nicht praktisch geprüft.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Mail, Assistant, Entwürfe und Dateien öffnen sich als eigenständige Desktop-Fenster. Unter **Einstellungen → KI-Verbindung** eine Basis-URL (z. B. `https://api.openai.com/v1`) und bei Bedarf einen API-Schlüssel speichern. Anschließend lädt die App verfügbare Modell-IDs über `/models`. Wähle je ein intelligentes und ein einfaches Modell samt eigener Thinking-Stufe und speichere die Auswahl; falls der Anbieter keine Modellliste liefert, lassen sich IDs manuell eingeben. Im Chat kann zwischen beiden Modellen gewechselt werden; die zugehörige Thinking-Stufe wird dabei automatisch verwendet. Bei „Aus“ wird kein `reasoning_effort`-Parameter gesendet; das schaltet nicht zwingend internes Thinking des Modells ab. Andere Stufen funktionieren nur, wenn der Endpunkt sie unterstützt.

Der Schlüssel liegt im Zugangsdaten-Speicher des Betriebssystems; Nachrichten, bisheriger Chatverlauf und ausdrücklich angehängter Kontext werden an den gewählten Anbieter übermittelt. HTTP ist ausschließlich für lokale Loopback-Endpunkte erlaubt. Der Chat verwendet `/chat/completions` mit echtem Streaming ohne Tools. Die Ausgabe lässt sich stoppen; bereits empfangener Text bleibt erhalten. Der Endpunkt muss Streaming im OpenAI-kompatiblen SSE-Format unterstützen.

Der interne Paketname `ai-workspace`, die bisherige App-ID und der Zugangsdaten-Eintrag behalten ihre Namen, damit vorhandene lokale Daten und gespeicherte Schlüssel nach der Umbenennung weiterverwendet werden können.

Das Dock öffnet die Fenster und beendet die gesamte App nach Bestätigung. Über **Chats** lassen sich Unterhaltungen erstellen, durchsuchen, umbenennen und öffnen. Einen älteren Chat per Drag & Drop oder über das Kontext-Symbol als Referenz in den aktuellen Chat übernehmen; der Chip lässt sich vor dem Senden wieder entfernen. Die Referenz enthält einen begrenzten Textauszug und wird als nicht vertrauenswürdiger Inhalt behandelt. Nachrichten können in einer neuen Chat-Abzweigung bearbeitet oder Antworten dort erneut erzeugt werden; der ursprüngliche Chat bleibt erhalten. E-Mails lassen sich ebenfalls per Drag & Drop in den Chat ziehen und über **Reply** als Entwurf öffnen. Entwürfe, Einstellungen und Chatverläufe bleiben lokal gespeichert. Der Dateimanager zeigt den Dokumente-Ordner; Dateien lassen sich an einen geöffneten Entwurf hängen. **Mail-Versand ist deaktiviert**, bis der SMTP- und Freigabeprozess implementiert ist.

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
| 0.1 · Schale | Electron/React/TypeScript, Dock, unabhängige Fenster, SQLite-Zustand, Mock-Mail, Chat mit Streaming und Sessions, typisierte Agent-UI-Aktionen, Dateidialog | **Implementiert** |
| 0.2 · Mail lesen | Konten im OS-Keychain, IMAP-Synchronisierung, Ordner/Threads, MIME-Parsing, sichere HTML-Darstellung und Attachment-Download | Geplant |
| 0.3 · Mail schreiben | Vollwertiger Editor, Reply/Forward, Anhänge, SMTP, explizite Versandfreigabe, lokale Entwurfswiederherstellung | Geplant |
| 0.4 · LLM und Agent | OpenAI-kompatibler Chat mit Abbruch vorhanden; Tool-Calling-Loop, Budget, Action-Protokoll und Freigabegates folgen | Begonnen |
| 0.5 · MCP | Stdio und Streamable HTTP, Serverkonfiguration, Tool-Schemas, Berechtigungen je Server und Tool, Audit-Ansicht | Geplant |
| 0.6 · Plattformen | Linux/macOS-Tests, Signierung, Migrationen, Import/Export, Accessibility und Updates | Geplant |

## Architektur

- **Renderer (`src/`)**: Oberfläche der einzelnen nativen Fenster ohne Node-Integration. E-Mail-Inhalt wird derzeit ausschließlich als Text angezeigt.
- **Preload (`electron/preload.ts`)**: kleine, typisierte API für Zustand und explizite Dateiauswahl; kein generischer IPC-Proxy.
- **Main (`electron/`)**: Electron-Fenster, Senderprüfung für IPC, lokale Dateizugriffe und SQLite-Datei. Renderer-Sandbox und `contextIsolation` sind aktiv; Navigation, neue Fenster und Browser-Berechtigungen werden gesperrt.
- **Shared (`shared/`)**: Datenmodell und validierte Agent-UI-Aktionen. Es gibt keine `send_email`- oder Löschaktion im Agent-Schema.

Details und Sicherheitsgrenzen: [Architektur](docs/architecture.md) und [ADR 0001](docs/decisions/0001-local-desktop.md).

## Entwicklungsstand und Grenzen

Die SQLite-Bindung verwendet `sql.js` (SQLite als WASM) und schreibt die Datenbankdatei nach Änderungen atomar. Das ist für den kleinen 0.1-Zustand portabel; vor einer großen Maildatenbank wird auf eine dateibasierte native SQLite-Bindung mit WAL und Migrationen umgestellt. Der Mock-Editor ist ein Texteditor. HTML-Mail, echte Anhänge aus IMAP und Versandfreigaben sind noch nicht implementiert. Die lokale SQLite-Datei ist nicht verschlüsselt; vor dem Speichern realer E-Mails ist ein Schutzkonzept für ruhende Daten festzulegen.

## Lizenz

MIT — siehe `LICENSE`.

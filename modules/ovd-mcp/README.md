# MCP als optionales OVD-Modul

`module.json` registriert Einstellungen und Verwaltungsfunktionen. Das Backend besitzt Konfiguration, Geheimnisspeicher, Verbindungen, Werkzeugkatalog und Ausführung. Die Oberfläche verwendet dieselben Dienste über typisierte IPC-Methoden. Das Modul fügt keinen eigenen Dockeintrag und keine MCP-Sonderlogik im Chat hinzu.

## Einrichtung

Unter **Einstellungen → MCP** einen Server anlegen:

- **Stdio:** ausführbares Programm, einzelne Argumente und optional Arbeitsordner. Es wird keine zusätzliche Shell gestartet. Zugangsdaten als geheime Umgebungswerte eingeben, statt sie in Programmargumente zu schreiben.
- **Streamable HTTP:** HTTPS-URL oder lokaler HTTP-Endpunkt; bei Bedarf Bearer-Token. URL-Zugangsdaten und Weiterleitungen werden nicht akzeptiert.

Nach dem Speichern verbinden und benötigte Werkzeuge auswählen. Die Freigaben separat speichern. Neue Werkzeuge erhalten keine automatische Freigabe. „Beim Appstart verbinden“ ist optional und zunächst aus. Konfigurations- oder Rechteänderungen durch den Assistenten werden im Formular vorbereitet; die endgültige Freigabe erfolgt durch den Nutzer.

Tokens und Umgebungswerte liegen im OS-Schlüsselspeicher. `servers.json` unter `<userData>/module-data/ovd-mcp/` enthält öffentliche Konfiguration und Freigaben. Änderungen werden atomar gespeichert. Ungespeicherte Formulare bleiben bei Kategorienwechsel und Suche erhalten und sind in den gemeinsamen Schließschutz integriert.

## Gezielte Werkzeugentdeckung

Eine verbundene Quelle mit freigegebenen Werkzeugen erscheint als virtuelle Modulquelle `ovd-mcp.<serverId>`. Name und Beschreibung stammen aus der eigenen Konfiguration. Der Modellkontext erhält kurze Metadaten; `find_modules` findet die Quelle und `get_module_tools` bietet nur die für einen Auftrag ausgewählten Schemas an. Das vollständige Serverinventar wird nicht an jede KI-Anfrage angehängt.

Der allgemeine Vertrag steht in `shared/module-tool-provider.ts`. Der Host prüft das aktuelle Angebot; das MCP-Modul prüft zusätzlich Verbindung, Freigabe und Eingaben. Werkzeugschemata sind auf 12.000 JSON-Zeichen begrenzt. Unterstützt werden Objekt-Schemas mit lokalen Referenzen; ungeeignete Schemas werden mit einem Grund in der Werkzeugliste angezeigt. Namen sind an Verbindung und Katalogstand gebunden. Veraltete Angebote werden vor einem Aufruf zurückgewiesen.

Serverbeschreibungen, Schemas und Ergebnisse sind nicht vertrauenswürdige Daten. Serveranweisungen werden nicht als Systemprompt übernommen. Hinweise wie `readOnlyHint` gelten nicht als Berechtigungsnachweis. Der Host berücksichtigt den OVD-Bestätigungsmodus; „Ohne Abfragen“ erteilt keine neuen Server- oder Werkzeugrechte.

Ergebnisse werden als begrenzter Text beziehungsweise strukturierte Daten zurückgegeben. Nicht-textuelle Inhalte werden als solche kenntlich gemacht. Fehler, Abbruch und unklarer Ausgang bleiben unterscheidbar; mögliche externe Änderungen werden bei einem Verbindungsfehler nicht automatisch wiederholt. Das Protokoll enthält höchstens 100 Metadateneinträge der aktuellen App-Sitzung. Deaktivieren oder Beenden schließt Verbindungen und lokale Serverprozesse.

## Als Vorlage verwenden

- `backend/store.ts`: öffentliche Konfiguration und geschützter Geheimnisspeicher.
- `backend/service.ts`: MCP-Client, gemeinsamer Aufrufdienst und dynamischer Provider.
- `backend/capabilities.ts` und `backend/index.ts`: validierte Verwaltung für Oberfläche und Assistent.
- `frontend/`: kompakte modulare Settingsoberfläche.
- [`examples/mcp-server/`](../../examples/mcp-server/README.md): ein separat startbarer Framework-Server mit drei Werkzeugen.

MCP ist hier zunächst eine Werkzeuganbindung. OAuth, alter HTTP/SSE-Transport, MCP-Ressourcen, Prompts, Sampling und Elicitation sind noch nicht integriert. Die Transporte verwenden das [offizielle TypeScript-SDK](https://ts.sdk.modelcontextprotocol.io/client).

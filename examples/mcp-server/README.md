# Ein kleines Framework über MCP anbinden

Dieser eigenständige MCP-Server zeigt, wie eine Anwendung ihre Funktionen für OVD bereitstellt. Er gehört nicht zu den automatisch gestarteten Komponenten. Die drei Werkzeuge zeigen Status, listen Aufgaben und erstellen eine Aufgabe in einem flüchtigen Speicher. Ein Neustart setzt diese Beispieldaten zurück.

Nach `pnpm install` im OVD-Repository:

1. In **Einstellungen → MCP** einen Server hinzufügen, etwa „Beispiel-Framework“ mit der Beschreibung „Aufgaben anlegen und suchen“.
2. Transport **Stdio** wählen. Als Programm `node` eintragen, gegebenenfalls dessen absoluten Pfad.
3. Als ein Argument den absoluten Pfad zu `examples/mcp-server/server.cjs` eintragen und speichern.
4. Verbinden und die gewünschten Werkzeuge in der Werkzeugliste freigeben.
5. Im Chat beispielsweise „Erstelle im Beispiel-Framework eine Aufgabe: Angebot prüfen“ schreiben.

OVD entdeckt die Verbindung als Werkzeugquelle und lädt nur die für den Auftrag benötigten Schemas. Nicht freigegebene Werkzeuge werden nicht angeboten. Der Server erhält keine OVD-Workspace-API und keine automatische Befugnis, OVD-Fenster zu steuern.

Eigene Frameworks können denselben Einstieg durch ihre tatsächlichen Dienste ersetzen. Dafür muss weder der OVD-Chat noch sein Systemprompt geändert werden. Das Beispiel verwendet das [offizielle TypeScript-SDK](https://ts.sdk.modelcontextprotocol.io/client) mit Stdio-Transport; entfernte Server können stattdessen Streamable HTTP verwenden.

# Eigenes Notizmodul

Dieses kleine, eigenständige Beispiel benötigt keine zusätzlichen Pakete. Es gehört nicht zu den standardmäßig geladenen OVD-Modulen.

1. Den ganzen Ordner `notes-module` in einen Benutzer-Modulordner von OVD kopieren; der Ordnername ist frei wählbar.
2. OVD neu starten.
3. Unter **Einstellungen → Module** das Modul **Notizen** prüfen und aktivieren. OVD fragt vor der ersten Ausführung nach einer Freigabe für den lokalen Modulcode.
4. Über **Notizen** im Dock Notizen hinzufügen oder suchen. Derselbe Ablauf ist über den OVD-Assistenten möglich, zum Beispiel „Speichere eine Notiz: Präsentation am Freitag vorbereiten“.

`module.json` beschreibt nur Metadaten, Beiträge und Funktionsschemas. Der Host lädt `backend.cjs` nach der Aktivierung in einem eigenen Prozess und ruft `activate({ moduleId, dataDirectory })` auf. Das Ergebnis enthält die namensgebundenen Funktionen in `tools`; jede Funktion erhält `(args, { signal })`. Der Code prüft seine Eingaben zusätzlich zum Manifest, beachtet Abbrüche, begrenzt gelistete Ergebnisse zusätzlich auf 24 KB pro Seite und schreibt Änderungen atomar in `notes.json` innerhalb des vom Host bereitgestellten Datenverzeichnisses.

`notes.html` und `settings.html` laufen jeweils in einem isolierten iframe. HTML, CSS und JavaScript sind vollständig in den Dateien enthalten. Die Oberfläche ruft Funktionen über `parent.postMessage({ type: 'ovd:invoke', requestId, tool, args }, '*')` auf und empfängt `ovd:result` mit derselben `requestId`, `ok` sowie `result` oder `error`. Beide Seiten prüfen die Absenderfenster. Modulansichten erhalten keinen direkten Zugriff auf die Workspace-API.

Ein eigener Prozess ist keine Betriebssystem-Sandbox. Die Freigabe gilt für vertrauenswürdigen lokalen Code. Die deklarierte Berechtigung `storage.module-data` beschreibt den beabsichtigten Zugriff des Beispiels; der Host stellt dafür das eigene Datenverzeichnis bereit.

Das Beispiel legt höchstens 500 Notizen mit jeweils 2000 Zeichen ab und bietet bewusst nur Suchen/Lesen und Hinzufügen an. Zum Deaktivieren **Einstellungen → Module** verwenden. Die Notizdaten bleiben im Modul-Datenverzeichnis erhalten.

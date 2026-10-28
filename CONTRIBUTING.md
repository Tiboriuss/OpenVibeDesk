# Mitwirken

OpenVibeDesk ist ein frühes Projekt. Issues und Pull Requests sind willkommen; beschreibe bei größeren Änderungen zuerst das Ziel und den geplanten Ansatz.

## Entwicklung

Installiere Node.js 22.13 oder neuer und pnpm 11.25.0. Unter Windows:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Vor einem Pull Request:

```powershell
pnpm build
pnpm test
```

Bitte beschreibe das Verhalten vor und nach der Änderung und wie du sie getestet hast. Die automatische Prüfung läuft derzeit unter Windows; Beiträge für Linux und macOS sind willkommen, ihre praktische Unterstützung ist noch nicht bestätigt.

Benutzerdaten, API-Schlüssel, `.env`-Dateien, Datenbanken und generierte Build-Artefakte gehören nicht ins Repository. Nutze für Tests ausschließlich Beispieldaten und temporäre Zugangsdaten. Halte die Electron-Prozessgrenzen ein: keine Node-Integration im Renderer und keine allgemeinen IPC-Brücken.

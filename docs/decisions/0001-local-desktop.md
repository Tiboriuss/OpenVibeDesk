# ADR 0001: Lokale Desktop-App ohne Backend-Server

**Status:** angenommen · 2026-10-27

## Kontext

Der Workspace soll wie eine installierte Single-User-App funktionieren. Mail, Dateien und Chat sollen in unabhängig verschiebbaren Desktop-Fenstern zusammenarbeiten. Ein separates Dock öffnet die Fenster. Ein separater Server, Docker, PostgreSQL und LibreChat würden Installation und Wartung unnötig verkomplizieren.

## Entscheidung

Electron stellt Main, Preload und sandboxed React-Renderer bereit. TypeScript definiert Prozessgrenzen und UI-Aktionen. Der gemeinsame Zustand und Chat-Sessions liegen lokal in SQLite; noch nicht abgesendete Chattexte werden im lokalen Speicher des Renderers gehalten. Ein API-Schlüssel wird im Renderer eingegeben, über die Preload-Schnittstelle an den Main-Prozess übermittelt und im Zugangsdaten-Speicher des Betriebssystems abgelegt. Gespeicherte Schlüssel werden dem Renderer nicht zurückgegeben. Die 0.1-Implementierung verwendet `sql.js` für einen ABI-unabhängigen Start. Der Preload erlaubt nur benannte Methoden, und der Main-Prozess prüft IPC-Herkunft und Eingaben.

## Folgen

Die App läuft ohne dedizierte Dienste und lässt sich als Windows-Installer verpacken. SQLite-WASM lädt und exportiert die komplette Datenbank, was für große Postfächer ungeeignet ist. Vor echter Mail-Synchronisierung folgt eine native SQLite-Bindung mit WAL, Migrationen und belastbarem Backup-Konzept. Linux/macOS bleiben Zielplattformen, werden aber erst nach Windows-Funktionsstabilität geprüft.

import { z } from 'zod';
import { mcpAuditQuerySchema, mcpServerIdSchema, mcpToolQuerySchema } from '../../../shared/mcp';
import type { CapabilityDefinition, CapabilityMetadata } from '../../../electron/workspace-capabilities';

export const mcpPreparationSchema = z.object({
  id: mcpServerIdSchema.optional(), name: z.string().trim().min(1).max(100).optional(), description: z.string().max(500).optional(),
  transport: z.enum(['stdio', 'http']).optional(), command: z.string().min(1).max(4096).optional(), args: z.array(z.string().max(4096)).max(100).optional(),
  cwd: z.string().min(1).max(4096).optional(), url: z.string().min(1).max(2048).optional(), allowedTools: z.array(z.string().min(1).max(200)).max(500).optional()
}).strict();
export const mcpCapabilitySchemas = {
  'mcp.servers': z.object({ offset: z.number().int().min(0).max(500).optional(), limit: z.number().int().min(1).max(40).optional() }).strict(),
  'mcp.connect': z.object({ serverId: mcpServerIdSchema }).strict(),
  'mcp.disconnect': z.object({ serverId: mcpServerIdSchema }).strict(),
  'mcp.remove': z.object({ serverId: mcpServerIdSchema }).strict(),
  'mcp.settings': mcpPreparationSchema,
  'mcp.tools': mcpToolQuerySchema,
  'mcp.audit': mcpAuditQuerySchema.extend({ limit: z.number().int().min(1).max(50).optional() })
} as const;
export type McpCapabilitySchemas = typeof mcpCapabilitySchemas;
const metadata: Record<keyof McpCapabilitySchemas, CapabilityMetadata> = {
  'mcp.servers': { label: 'MCP-Verbindungen anzeigen', description: 'Liste konfigurierte MCP-Server mit ID, kurzer Fachbeschreibung, Verbindungsstatus und Anzahl freigegebener Werkzeuge. Keine Zugangsdaten, Programmargumente oder Schemas. Bei hasMore weiterblättern. Verbundene freigegebene Quellen mit find_modules finden und deren benötigte Werkzeuge mit get_module_tools gezielt laden.', needsUserInteraction: false },
  'mcp.connect': { label: 'MCP-Server verbinden', description: 'Verbinde einen bereits vom Nutzer gespeicherten MCP-Server anhand seiner serverId. Bei Stdio wird der konfigurierte lokale Prozess gestartet, bei HTTP der gespeicherte Endpunkt verbunden. Ändert weder Serverkonfiguration noch Werkzeugrechte. Erforderliche Bestätigungen verarbeitet der Host.', needsUserInteraction: true },
  'mcp.disconnect': { label: 'MCP-Server trennen', description: 'Trenne einen gespeicherten MCP-Server und entferne seine Werkzeuge aus dem Angebot. Bereits ausgelöste externe Änderungen werden dadurch nicht rückgängig gemacht und nicht wiederholt.', needsUserInteraction: false },
  'mcp.remove': { label: 'MCP-Server entfernen', description: 'Fordere das Trennen und Entfernen einer gespeicherten MCP-Verbindung samt gespeicherten Zugangsdaten an. Der Host berücksichtigt den Bestätigungsmodus. Entfernt keine externen Daten auf dem Server.', needsUserInteraction: true },
  'mcp.settings': { label: 'MCP-Einstellungen vorbereiten', description: 'Öffne MCP-Einstellungen und bereite öffentliche Serverangaben oder allowedTools für eine bestehende Verbindung im Formular vor. Der Nutzer prüft und speichert. Keine Verbindung einrichten oder Rechte selbst erteilen. Tokens und geheime Umgebungswerte ausschließlich in der Oberfläche eingeben; diese Argumente sind nicht erlaubt.', needsUserInteraction: true },
  'mcp.tools': { label: 'MCP-Werkzeuge prüfen', description: 'Zeige begrenzt Namen, Beschreibungen, Unterstützungs- und Freigabestatus der Werkzeuge eines verbundenen MCP-Servers. Optional refresh aktualisiert den Serverkatalog, ändert aber keine Freigaben. Keine Eingabeschemas im Ergebnis; tatsächliche Aufrufe über find_modules und get_module_tools der jeweiligen Serverquelle laden.', needsUserInteraction: false },
  'mcp.audit': { label: 'MCP-Aufrufverlauf anzeigen', description: 'Zeige das begrenzte lokale Verbindungs- und Aufrufprotokoll dieser App-Sitzung: Zeitpunkt, Server, Werkzeug, Dauer und tatsächlicher Ausgang. Keine Argumente, Inhalte oder Zugangsdaten. Bei hasMore weitere Einträge laden.', needsUserInteraction: false }
};
export const mcpCapabilityDefinitions = Object.fromEntries((Object.keys(mcpCapabilitySchemas) as (keyof McpCapabilitySchemas)[]).map(name => [name, { name, schema: mcpCapabilitySchemas[name], category: 'mcp', ...metadata[name] }])) as { [N in keyof McpCapabilitySchemas]: CapabilityDefinition<N, McpCapabilitySchemas[N]> };

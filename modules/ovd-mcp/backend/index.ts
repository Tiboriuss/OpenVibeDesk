import { ipcMain } from 'electron';
import { z } from 'zod';
import type { CapabilityContext, WorkspaceCapabilityRegistry } from '../../../electron/workspace-capabilities';
import { mcpAuditQuerySchema, mcpPermissionsSchema, mcpServerIdSchema, type McpPrepareRequest } from '../../../shared/mcp';
import { mcpCapabilityDefinitions, mcpPreparationSchema } from './capabilities';
import { McpConfigStore } from './store';
import { McpService } from './service';

export interface McpModuleHost {
  dataRoot: string;
  verifySender(event: Electron.IpcMainInvokeEvent): void;
  verifySettings(event: Electron.IpcMainInvokeEvent): void;
  uiOperationContext(event: Electron.IpcMainInvokeEvent): CapabilityContext;
  confirm(context: CapabilityContext, message: string, detail: string): Promise<boolean>;
  prepareServer(request: McpPrepareRequest): Promise<void>;
  changed(): void;
  requestTimeoutMs(): number;
}

/** MCP owns transport, secrets and tools; the host only supplies common UI hooks. */
export function createMcpModule(host: McpModuleHost) {
  const service = new McpService(new McpConfigStore(host.dataRoot), host);
  // Preserve cursor/count envelopes through the common model result bounds,
  // including JSON escaping of arbitrary server names and descriptions.
  function boundedRows<T>(rows: T[]): T[] {
    const result: T[] = [];
    for (const row of rows.slice(0, 50)) {
      if (JSON.stringify([...result, row]).length > 26000) break;
      result.push(row);
    }
    return result;
  }
  function summary(id: string) {
    const found = service.listServers().find(server => server.id === id);
    if (!found) throw new Error('MCP-Server nicht gefunden.');
    return found;
  }
  async function prepare(values: z.infer<typeof mcpPreparationSchema>) {
    if (values.id) summary(values.id);
    await host.prepareServer({ values });
    return { status: 'requires_user_input', opened: 'mcp', note: 'Die Angaben sind im Formular vorbereitet. Der Nutzer prüft und speichert; Geheimnisse ausschließlich dort eingeben.' };
  }
  function registerCapabilities(registry: WorkspaceCapabilityRegistry) {
    registry.registerDefinition(mcpCapabilityDefinitions['mcp.servers'], ({ offset = 0, limit = 20 }) => {
      const all = service.listServers();
      const servers = boundedRows(all.slice(offset, offset + limit).map(({ id, name, description, transport, status, toolCount, allowedToolCount, error, warning }) => ({ id, name, description: description.slice(0, 240), transport, status, toolCount, allowedToolCount, ...(error ? { error } : {}), ...(warning ? { warning } : {}) })));
      const hasMore = offset + servers.length < all.length;
      return { servers, total: all.length, hasMore, ...(hasMore ? { nextOffset: offset + servers.length } : {}) };
    });
    registry.registerDefinition(mcpCapabilityDefinitions['mcp.connect'], async ({ serverId }, context) => {
      const result = await service.connect(serverId, context);
      return result.cancelled ? { ...result, ok: false, outcome: 'cancelled', message: 'Die Verbindung wurde nicht freigegeben.' } : { ...result, ok: true, outcome: 'completed' };
    });
    registry.registerDefinition(mcpCapabilityDefinitions['mcp.disconnect'], ({ serverId }, context) => service.disconnect(serverId, context));
    registry.registerDefinition(mcpCapabilityDefinitions['mcp.remove'], async ({ serverId }, context) => {
      const result = await service.removeServer(serverId, context);
      return result.cancelled ? { ...result, ok: false, outcome: 'cancelled', message: 'Die MCP-Verbindung wurde nicht entfernt.' } : { ...result, ok: true, outcome: 'completed' };
    });
    registry.registerDefinition(mcpCapabilityDefinitions['mcp.settings'], prepare);
    registry.registerDefinition(mcpCapabilityDefinitions['mcp.tools'], async (query, context) => {
      const page = await service.listTools(query, context);
      return { ...page, tools: page.tools.map(({ name, title, description, allowed, supported, reason, readOnly }) => ({ name, ...(title ? { title } : {}), description: description.slice(0, 500), allowed, supported, ...(reason ? { reason } : {}), readOnlyHint: readOnly })) };
    });
    registry.registerDefinition(mcpCapabilityDefinitions['mcp.audit'], query => {
      const page = service.auditPage(query), entries = boundedRows(page.entries), hasMore = page.hasMore || entries.length < page.entries.length;
      return { entries, total: page.total, hasMore, ...(hasMore ? { nextOffset: (query.offset ?? 0) + entries.length } : {}) };
    });
  }
  function registerIpc() {
    ipcMain.handle('mcp:servers:list', event => { host.verifySettings(event); return service.listServers(); });
    ipcMain.handle('mcp:servers:save', (event, input: unknown) => { host.verifySettings(event); return service.saveServer(input as Parameters<McpService['saveServer']>[0], host.uiOperationContext(event)); });
    ipcMain.handle('mcp:servers:remove', async (event, raw: unknown) => { host.verifySettings(event); const result = await service.removeServer(mcpServerIdSchema.parse(raw), host.uiOperationContext(event)); return !!result.removed; });
    ipcMain.handle('mcp:servers:connect', async (event, raw: unknown) => { host.verifySettings(event); const id = mcpServerIdSchema.parse(raw); await service.connect(id, host.uiOperationContext(event)); return summary(id); });
    ipcMain.handle('mcp:servers:disconnect', async (event, raw: unknown) => { host.verifySettings(event); const id = mcpServerIdSchema.parse(raw); await service.disconnect(id, host.uiOperationContext(event)); return summary(id); });
    ipcMain.handle('mcp:tools:list', (event, query: unknown) => { host.verifySettings(event); return service.listTools(query as Parameters<McpService['listTools']>[0], host.uiOperationContext(event)); });
    ipcMain.handle('mcp:tools:permissions', (event, input: unknown) => { host.verifySettings(event); return service.permissions(mcpPermissionsSchema.parse(input), host.uiOperationContext(event)); });
    ipcMain.handle('mcp:audit', (event, query: unknown) => { host.verifySettings(event); return service.auditPage(mcpAuditQuerySchema.parse(query ?? {})); });
    ipcMain.handle('mcp:tools:call', (event, raw: unknown) => {
      host.verifySettings(event);
      const input = z.object({ serverId: mcpServerIdSchema, name: z.string().min(1).max(200), args: z.record(z.string(), z.unknown()) }).strict().parse(raw);
      if (JSON.stringify(input.args).length > 16000) throw new Error('Die Werkzeugargumente sind zu groß.');
      return service.callTool(input.serverId, input.name, input.args, host.uiOperationContext(event));
    });
  }
  return { initialize: () => service.initialize(), activate: () => service.activate(), deactivate: () => service.deactivate(), registerCapabilities, registerIpc, toolProvider: service.toolProvider };
}
export type McpModule = ReturnType<typeof createMcpModule>;

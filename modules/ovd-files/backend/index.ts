import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import type { CapabilityContext, WorkspaceCapabilityRegistry } from '../../../electron/workspace-capabilities';
import { fileIdSchema, fileOpenRequestSchema, fileChooseRequestSchema, type FileChooseKind, type FileListRequest, type FileOpenRequest, type FileOpenResult, type FileReadRequest } from '../../../shared/files';
import type { ModuleReference, ModuleReferenceSummary } from '../../../shared/references';
import type { WindowKind } from '../../../shared/model';
import { FilesService } from './file-service';
import { filesCapabilityDefinitions } from './capabilities';

export interface FilesModuleHost {
  dataRoot: string;
  panels: ReadonlyMap<WindowKind, BrowserWindow>;
  openPanel(kind: WindowKind): Promise<void>;
  operationOwner(context: CapabilityContext): BrowserWindow | undefined;
  uiOperationContext(event: Electron.IpcMainInvokeEvent): CapabilityContext;
  verifySender(event: Electron.IpcMainInvokeEvent): void;
  verifyPanel(event: Electron.IpcMainInvokeEvent, kinds: WindowKind[]): void;
  selectedLocalFiles: Set<string>;
  reference(summary: ModuleReferenceSummary): Promise<void>;
}

/** Optional, trusted file adapter. Main routes lifecycle; this module owns access and behavior. */
export function createFilesModule(host: FilesModuleHost) {
  const service = new FilesService({ documents: app.getPath('documents'), dataRoot: host.dataRoot, selectedLocalFiles: host.selectedLocalFiles });
  let active = false;
  const assertActive = (context: CapabilityContext) => { if (!active) throw new Error('Das Dateienmodul ist nicht verfügbar. Bitte unter Einstellungen → Module aktivieren.'); context.signal.throwIfAborted(); };
  async function list(request: FileListRequest = {}, context: CapabilityContext) { assertActive(context); const result = await service.list(request, context.signal); assertActive(context); return result; }
  async function read(request: FileReadRequest, context: CapabilityContext) { assertActive(context); const result = await service.read(request, context.signal); assertActive(context); return result; }
  async function open(rawRequest: FileOpenRequest = {}, context: CapabilityContext): Promise<FileOpenResult> {
    assertActive(context);
    const request = fileOpenRequestSchema.parse(rawRequest);
    let target = request.path ?? service.documents(), selectedId: string | undefined;
    if (request.id) {
      const entry = await service.entry(await service.pathForId(request.id, context.signal), context.signal);
      target = entry.isDirectory ? entry.path : path.dirname(entry.path);
      if (!entry.isDirectory) selectedId = entry.id;
    }
    const listing = await service.list({ path: target }, context.signal);
    assertActive(context);
    await host.openPanel('files');
    host.panels.get('files')?.webContents.send('files:show-folder', { path: listing.path, ...(selectedId ? { selectedId } : {}) });
    return { opened: true, path: listing.path, ...(selectedId ? { selectedId } : {}) };
  }
  async function choose(kind: FileChooseKind = 'file', context: CapabilityContext) {
    assertActive(context);
    kind = fileChooseRequestSchema.parse({ kind }).kind;
    const owner = host.operationOwner(context);
    if (!owner) throw new Error('Kein Fenster für die Dateiauswahl verfügbar.');
    const result = await dialog.showOpenDialog(owner, { title: kind === 'directory' ? 'Ordner auswählen' : 'Datei auswählen', defaultPath: service.documents(), properties: [kind === 'directory' ? 'openDirectory' : 'openFile'] });
    assertActive(context);
    if (result.canceled || !result.filePaths[0]) return null;
    const entry = await service.selectPath(result.filePaths[0], kind, context.signal);
    assertActive(context);
    await open({ id: entry.id }, context);
    return entry;
  }
  async function getReference(rawId: string, context: CapabilityContext): Promise<ModuleReferenceSummary> {
    assertActive(context);
    const id = fileIdSchema.parse(rawId), entry = await service.rememberReference(id, context.signal);
    assertActive(context);
    const extension = path.extname(entry.name).toLocaleLowerCase();
    return { moduleId: 'ovd-files', type: 'file', id, title: entry.name.slice(0, 200), description: 'Dateireferenz · Inhalt wird beim Senden gezielt aufgelöst', size: entry.size, mediaType: extension === '.md' || extension === '.markdown' ? 'text/markdown' : extension === '.json' ? 'application/json' : extension === '.csv' ? 'text/csv' : extension === '.pdf' ? 'application/pdf' : extension === '.txt' || extension === '.text' ? 'text/plain' : 'application/octet-stream', icon: 'file' };
  }
  async function snapshotReference(rawId: string, context: CapabilityContext): Promise<ModuleReference> {
    const summary = await getReference(rawId, context), page = await read({ id: summary.id, maxChars: 4000 }, context);
    return { ...summary, readable: page.readable, truncated: page.hasMore, capturedAt: page.observedAt, sourceVersion: page.revision, sourceUpdatedAt: page.modifiedAt, ...(page.text !== undefined ? { text: page.text } : {}), metadata: { path: page.path.slice(0, 1024), ...(page.path.length > 1024 ? { pathTruncated: true } : {}), name: page.name.slice(0, 200), size: page.size, format: page.format, ...(page.reason ? { reason: page.reason } : {}), textLength: page.textLength } };
  }
  async function reference(id: string, context: CapabilityContext) {
    const summary = await getReference(id, context);
    assertActive(context);
    await host.reference(summary);
    return { selected: true, reference: { moduleId: summary.moduleId, type: summary.type, id: summary.id }, title: summary.title, sent: false };
  }
  function registerCapabilities(registry: WorkspaceCapabilityRegistry) {
    registry.registerDefinition(filesCapabilityDefinitions['files.list'], list);
    registry.registerDefinition(filesCapabilityDefinitions['files.read'], read);
    registry.registerDefinition(filesCapabilityDefinitions['files.open'], open);
    registry.registerDefinition(filesCapabilityDefinitions['files.choose'], ({ kind }, context) => choose(kind, context));
    registry.registerDefinition(filesCapabilityDefinitions['files.reference'], ({ id }, context) => reference(id, context));
  }
  function registerIpc() {
    ipcMain.handle('files:list-page', (event, request: unknown) => { host.verifySender(event); return list(request as FileListRequest, host.uiOperationContext(event)); });
    ipcMain.handle('files:read', (event, request: unknown) => { host.verifySender(event); return read(request as FileReadRequest, host.uiOperationContext(event)); });
    ipcMain.handle('files:open', (event, request: unknown) => { host.verifySender(event); return open(request as FileOpenRequest, host.uiOperationContext(event)); });
    ipcMain.handle('files:choose-entry', (event, kind: unknown) => { host.verifySender(event); return choose(fileChooseRequestSchema.parse({ kind }).kind, host.uiOperationContext(event)); });
    ipcMain.handle('files:reference', (event, id: unknown) => { host.verifySender(event); return reference(fileIdSchema.parse(id), host.uiOperationContext(event)); });
  }
  return {
    async initialize() { await service.initialize(); active = true; },
    activate() { active = true; },
    deactivate() { active = false; },
    registerCapabilities, registerIpc, list, read, open, choose, getReference, snapshotReference
  };
}
export type FilesModule = ReturnType<typeof createFilesModule>;

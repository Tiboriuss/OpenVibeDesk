import { app, BrowserWindow, dialog, ipcMain, protocol, screen, session, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyUiAction, initialState, uiActionSchema } from '../shared/actions';
import { initializeStore, loadState, saveState } from './store';
import { settingsPatchSchema, normalizeSettings } from '../shared/settings';
import { normalizeSessions, createSession, selectSession, renameSession, forkSession, updateSessionMessages, snapshotSessionReference } from '../shared/sessions';
import { defaultAiConfig, normalizeAiConfig, parseAiInput, chatOptionsSchema, getKey, setKey, deleteKey, listModels, makeMessages } from './ai';
import { runAgent } from './agent';
import { agentSettingsSchema, normalizeAgentSettings } from '../shared/agent-settings';
import { getExternalChatUrl } from '../shared/chat-links';
import { getTimeContext, resolveTimeRange, resolveTimeDifference } from '../shared/time';
import { evaluateCalculation } from '../shared/calculation';
import { getNavigationEntries, mergeNavigationOrder, migrateNavigationOrder, orderNavigationEntries } from '../shared/navigation';
import { moduleReferenceInputSchema, moduleReferenceSchema, moduleReferenceSummarySchema, type ModuleReference, type ModuleReferenceInput, type ModuleReferenceSummary } from '../shared/references';
import { readChatHistory } from './chat-history';
import { ModuleHost } from './module-host';
import { streamCompletion } from './stream';
import type { ChatMessage, EmailReference, EmailReferenceSummary, FileListing, Mail, SelectedFile, WindowKind, WorkspaceState, AgentRunLimit } from '../shared/model';
import type { MailModule } from '../modules/ovd-mail/backend';
import type { FilesModule } from '../modules/ovd-files/backend';
import type { McpModule } from '../modules/ovd-mcp/backend';
import { ModuleReferenceRegistry, sameModuleReference } from './module-references';
import { WorkspaceCapabilityRegistry, type CapabilityContext } from './workspace-capabilities';

app.enableSandbox();
protocol.registerSchemesAsPrivileged([{ scheme: 'ovd-module', privileges: { standard: true, secure: true } }]);
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'ai-workspace'));
const appIconPath = path.join(app.getAppPath(), 'assets', 'brand', 'app-icon.png');
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
let currentState: WorkspaceState;
let dock: BrowserWindow | null = null;
const panels = new Map<WindowKind, BrowserWindow>();
const panelModules: Partial<Record<WindowKind, string>> = { mail: 'ovd-mail', draft: 'ovd-mail', files: 'ovd-files' };
const moduleWindows = new Map<string, { moduleId: string; viewId: string; window: BrowserWindow }>();
let moduleHost: ModuleHost | undefined;
let saveTimer: NodeJS.Timeout | undefined;
let settingsWrites: Promise<unknown> = Promise.resolve();
let quitting = false;
let readyToQuit = false;
let aiSettingsStatus: 'clean' | 'dirty' | 'busy' = 'clean';
let agentSettingsStatus: 'clean' | 'dirty' | 'busy' = 'clean';
let mcpSettingsStatus: 'clean' | 'dirty' | 'busy' = 'clean';
let mailModule: MailModule | undefined;
let filesModule: FilesModule | undefined;
let mcpModule: McpModule | undefined;
let allowSettingsUnload = false;
let chatBusy = false;
const forkMailReferences = new Map<string, EmailReference>();
const forkModuleReferences = new Map<string, ModuleReference[]>();
const moduleReferences = new ModuleReferenceRegistry((id, type) => !!moduleHost?.isReady(id) && !!moduleHost.registry.getModule(id)?.manifest?.contributions.referenceTypes?.some(item => item.id === type));
let activeStream: { controller: AbortController; flush(): void; sessionId: string; assistantId: string } | undefined;

function verifySender(event: Electron.IpcMainInvokeEvent): void {
  const known = [dock, ...panels.values(), ...[...moduleWindows.values()].map(item => item.window)].some(win => win && !win.isDestroyed() && event.sender === win.webContents);
  if (!known || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender');
}
function verifyPanel(event: Electron.IpcMainInvokeEvent, kinds: WindowKind[]): void {
  verifySender(event);
  if (!kinds.some(kind => panels.get(kind)?.webContents === event.sender)) throw new Error('Untrusted IPC sender');
}
function boundedEmailReference(mail: Pick<Mail, 'id' | 'from' | 'to' | 'subject' | 'date' | 'bodyText' | 'attachments' | 'accountName'> & Partial<EmailReference>, truncated = false): EmailReference {
  return { id: mail.id, from: mail.from.slice(0, 500), to: mail.to.slice(0, 500), subject: mail.subject.slice(0, 1000),
    date: mail.date.slice(0, 100), bodyText: mail.bodyText.slice(0, 12000),
    attachments: mail.attachments.slice(0, 20).map(item => ({ name: item.name.slice(0, 200), size: item.size })),
    ...(mail.accountName ? { accountName: mail.accountName.slice(0, 200) } : {}), ...(mail.accountId ? { accountId: mail.accountId } : {}), ...(mail.fromAddresses ? { fromAddresses: mail.fromAddresses.slice(0, 20).map(value => value.slice(0, 320)) } : {}), ...(mail.replyToAddresses ? { replyToAddresses: mail.replyToAddresses.slice(0, 20).map(value => value.slice(0, 320)) } : {}), ...(mail.messageId ? { messageId: mail.messageId.slice(0, 500) } : {}), ...(mail.references ? { references: mail.references.slice(-20).map(value => value.slice(0, 500)) } : {}), truncated: truncated || mail.bodyText.length > 12000 };
}
function savedEmailReference(id: string, sessionId = currentState.activeSessionId): EmailReference | undefined {
  const fork = forkMailReferences.get(sessionId);
  if (fork?.id === id) return fork;
  const sessions = [...currentState.sessions.filter(item => item.id === sessionId), ...currentState.sessions.filter(item => item.id !== sessionId)];
  for (const session of sessions) {
    const reference = [...session.messages].reverse().find(message => message.emailReference?.id === id)?.emailReference;
    if (reference) return boundedEmailReference(reference, reference.truncated);
  }
  return undefined;
}
function validateEmailReferenceId(id: unknown): string {
  if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Ungültige Mailreferenz.');
  return id;
}
function emailReferenceSummary(rawId: unknown): EmailReferenceSummary {
  const id = validateEmailReferenceId(rawId);
  const live = moduleHost?.isReady('ovd-mail') ? mailModule?.getLiveMail(id) : undefined;
  const mail = live ? mailModule!.externalMail(live) : savedEmailReference(id) ?? currentState.mails.find(item => item.id === id);
  if (!mail) throw new Error('Diese Mail ist nicht mehr geladen. Bitte im Postfach aktualisieren und erneut in den Chat ziehen.');
  return { id, subject: mail.subject.slice(0, 1000), from: mail.from.slice(0, 500), ...(mail.accountName ? { accountName: mail.accountName.slice(0, 200) } : {}) };
}
/** An explicitly selected reference grants context for this message, not general mailbox access. */
async function snapshotEmailReference(rawId: unknown, sessionId: string, signal: AbortSignal): Promise<EmailReference> {
  const id = validateEmailReferenceId(rawId);
  const fork = forkMailReferences.get(sessionId);
  if (fork?.id === id) return boundedEmailReference(fork, fork.truncated);
  const live = moduleHost?.isReady('ovd-mail') ? await mailModule?.snapshotLiveReference(id, signal) : undefined;
  if (live) return live;
  const saved = savedEmailReference(id, sessionId);
  if (saved) return saved;
  const legacy = currentState.mails.find(item => item.id === id);
  if (legacy) return boundedEmailReference(legacy);
  throw new Error('Diese Mail ist nicht mehr geladen. Bitte im Postfach aktualisieren und erneut in den Chat ziehen.');
}
function savedModuleReference(input: ModuleReferenceInput, sessionId = currentState.activeSessionId): ModuleReference | undefined {
  const candidates = [
    ...(forkModuleReferences.get(sessionId) ?? []),
    ...currentState.sessions.filter(item => item.id === sessionId).flatMap(item => [...item.messages].reverse().flatMap(message => message.references ?? [])),
    ...currentState.sessions.filter(item => item.id !== sessionId).flatMap(item => [...item.messages].reverse().flatMap(message => message.references ?? []))
  ];
  for (const candidate of candidates) {
    const result = moduleReferenceSchema.safeParse(candidate);
    if (result.success && sameModuleReference(input, result.data)) return result.data;
  }
  return undefined;
}
function referenceSummary(reference: ModuleReference): ModuleReferenceSummary {
  const { moduleId, type, id, title, description, mediaType, size, icon } = reference;
  return moduleReferenceSummarySchema.parse({ moduleId, type, id, title, description, mediaType, size, icon });
}
async function moduleReferenceSummary(raw: unknown, context: OperationContext): Promise<ModuleReferenceSummary> {
  const input = moduleReferenceInputSchema.parse(raw);
  try { return await moduleReferences.summary(input, context); }
  catch (error) {
    context.signal.throwIfAborted();
    const saved = savedModuleReference(input, context.sessionId);
    if (saved) return referenceSummary(saved);
    throw error;
  }
}
async function snapshotModuleReference(input: ModuleReferenceInput, sessionId: string, signal: AbortSignal): Promise<ModuleReference> {
  const fork = forkModuleReferences.get(sessionId)?.find(item => sameModuleReference(item, input));
  if (fork) return moduleReferenceSchema.parse(fork);
  try { return await moduleReferences.snapshot(input, { origin: 'ui', signal, sessionId, owner: panels.get('chat') }); }
  catch (error) {
    signal.throwIfAborted();
    const saved = savedModuleReference(input, sessionId);
    if (saved) return saved;
    throw error;
  }
}
async function selectModuleReference(raw: ModuleReferenceSummary): Promise<void> {
  const summary = moduleReferenceSummarySchema.parse(raw);
  await openPanel('chat');
  panels.get('chat')?.webContents.send('chat:reference-module', summary);
}
function broadcast(): void { for (const win of [dock, ...panels.values(), ...[...moduleWindows.values()].map(item => item.window)]) if (win && !win.isDestroyed()) win.webContents.send('workspace:changed', currentState); }
function commit(next: WorkspaceState): void {
  currentState = next;
  broadcast();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveState(currentState).catch(error => console.error('Workspace save failed', error)); }, 250);
}
function setupWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
}
function panelTitle(kind: WindowKind): string { return { mail: 'Mail', chat: 'Assistant', draft: 'Entwurf', files: 'Dateien', settings: 'Einstellungen', sessions: 'Chats' }[kind]; }

function confirmSettingsClose(force = false): boolean {
  if (!force && aiSettingsStatus === 'clean' && agentSettingsStatus === 'clean' && mcpSettingsStatus === 'clean' && (mailModule?.getSettingsStatus() ?? 'clean') === 'clean') return true;
  const owner = panels.get('settings');
  if (!owner || owner.isDestroyed()) return true;
  if (aiSettingsStatus === 'busy' || agentSettingsStatus === 'busy' || mcpSettingsStatus === 'busy' || mailModule?.getSettingsStatus() === 'busy') {
    dialog.showMessageBoxSync(owner, { type: 'info', title: 'Vorgang läuft', message: 'Bitte warte, bis der aktuelle Vorgang abgeschlossen ist.', buttons: ['OK'] });
    return false;
  }
  return dialog.showMessageBoxSync(owner, {
    type: 'warning', title: 'Ungespeicherte Änderungen',
    message: 'Ungespeicherte Einstellungen verwerfen?',
    detail: 'Deine Änderungen wurden noch nicht gespeichert.',
    buttons: ['Zurück', 'Änderungen verwerfen'], defaultId: 0, cancelId: 0, noLink: true
  }) === 1;
}

async function openPanel(kind: WindowKind): Promise<void> {
  if (kind === 'mail' || kind === 'draft') requireMailModule();
  if (kind === 'files') requireFilesModule();
  // Module tools can open a panel directly, before a dock action has created its
  // state record. Track that path too so window tools and restart agree with UI.
  if (!currentState.windows.some(window => window.kind === kind && !window.minimized)) commit(applyUiAction(currentState, { type: 'open_window', kind }).state);
  const existing = panels.get(kind);
  if (existing && !existing.isDestroyed()) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); return; }
  const saved = currentState.windows.find(w => w.kind === kind);
  const sizes: Record<WindowKind, [number, number]> = { mail: [1070, 720], chat: [570, 610], draft: [640, 530], files: [740, 580], settings: [650, 540], sessions: [560, 520] };
  const [width, height] = sizes[kind];
  const area = screen.getPrimaryDisplay().workArea;
  const actualWidth = Math.max(450, Math.min(saved?.width ?? width, area.width));
  const actualHeight = Math.max(360, Math.min(saved?.height ?? height, area.height));
  const x = saved ? Math.max(area.x, Math.min(saved.x, area.x + area.width - actualWidth)) : area.x + 100 + panels.size * 70;
  const y = saved ? Math.max(area.y, Math.min(saved.y, area.y + area.height - actualHeight)) : area.y + 80 + panels.size * 60;
  const win = new BrowserWindow({ x, y, width: actualWidth, height: actualHeight, icon: appIconPath,
    minWidth: 450, minHeight: 360, title: `OpenVibeDesk · ${panelTitle(kind)}`, frame: false, backgroundColor: '#ffffff', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  panels.set(kind, win);
  setupWindow(win);
  if (kind === 'settings') win.webContents.on('will-prevent-unload', event => {
    if (allowSettingsUnload || confirmSettingsClose(true)) {
      allowSettingsUnload = false;
      event.preventDefault();
    } else if (quitting) {
      quitting = false;
      readyToQuit = false;
    }
  });
  const rememberBounds = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    const bounds = win.getBounds();
    commit({ ...currentState, windows: currentState.windows.map(w => w.kind === kind ? { ...w, ...bounds } : w) });
  };
  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);
  win.on('closed', () => { panels.delete(kind); mailModule?.onPanelClosed(kind); if (kind === 'settings') { aiSettingsStatus = 'clean'; agentSettingsStatus = 'clean'; mcpSettingsStatus = 'clean'; allowSettingsUnload = false; } if (!quitting) commit({ ...currentState, windows: currentState.windows.map(w => w.kind === kind ? { ...w, minimized: true } : w) }); });
  await win.loadFile(path.join(__dirname, '../../dist/index.html'), { query: { view: kind } });
}

async function openDock(): Promise<void> {
  const area = screen.getPrimaryDisplay().workArea;
  const height = dockHeight();
  dock = new BrowserWindow({ x: area.x + 12, y: Math.round(area.y + (area.height - height) / 2), icon: appIconPath,
    width: 78, height, minWidth: 78, minHeight: 200, frame: false, transparent: true, resizable: false,
    movable: true, alwaysOnTop: currentState.settings.dockAlwaysOnTop, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  setupWindow(dock);
  dock.on('closed', () => { dock = null; app.quit(); });
  await dock.loadFile(path.join(__dirname, '../../dist/index.html'), { query: { view: 'dock' } });
}

async function dispatchAction(raw: unknown): Promise<void> {
  const action = uiActionSchema.parse(raw);
  if (action.type === 'read_email' || action.type === 'open_window' && ['mail', 'draft'].includes(action.kind)) requireMailModule();
  if (action.type === 'open_file_manager' || action.type === 'open_window' && action.kind === 'files') requireFilesModule();
  if (action.type === 'create_draft') { await requireMailModule().createDraft({ ...(action.replyTo ? { sourceEmailId: action.replyTo, mode: 'reply' as const } : {}) }, { origin: 'ui', signal: new AbortController().signal }); return; }
  if (action.type === 'update_draft' || action.type === 'attach_file' || action.type === 'remove_attachment') requireMailModule().validateAction(action);
  commit(applyUiAction(currentState, action).state);
  if (action.type === 'open_window' || action.type === 'read_email' || action.type === 'open_file_manager') {
    const kind = action.type === 'open_window' ? action.kind : action.type === 'read_email' ? 'mail' : 'files';
    await openPanel(kind);
    if (action.type === 'read_email') panels.get('mail')?.webContents.send('mail:show-example');
  } else if (action.type === 'focus_window') {
    const kind = currentState.windows.find(w => w.id === action.windowId)?.kind;
    if (kind) await openPanel(kind);
  } else if (action.type === 'request_user_input') panels.get('chat')?.webContents.send('workspace:input-request', action.prompt);
}

type OperationContext = CapabilityContext & { grantMailIds?(ids: string[]): void; primaryEmailId?: string };
const workspaceCapabilities = new WorkspaceCapabilityRegistry();
function uiOperationContext(event: Electron.IpcMainInvokeEvent): OperationContext {
  return { origin: 'ui', signal: new AbortController().signal, owner: BrowserWindow.fromWebContents(event.sender) ?? undefined };
}
function operationOwner(context: OperationContext): BrowserWindow | undefined {
  return context.owner && !context.owner.isDestroyed() ? context.owner : panels.get('chat') ?? panels.get('mail') ?? dock ?? undefined;
}
async function readAiSettings(context: OperationContext) {

    const config = currentState.ai ?? defaultAiConfig;
    return { baseUrl: config.baseUrl, smartModel: config.smartModel, simpleModel: config.simpleModel, smartThinking: config.smartThinking, simpleThinking: config.simpleThinking, workspaceTools: config.workspaceTools !== false, realMailAccess: config.realMailAccess === true, confirmationMode: config.confirmationMode === 'never' ? 'never' as const : 'ask' as const, hasApiKey: !!(await getKey(config.baseUrl)), configured: !!currentState.ai };
}
async function saveAiSettings(input: unknown, context: OperationContext) {

    let values: ReturnType<typeof parseAiInput>;
    try { values = parseAiInput(input); } catch (error) { if (error instanceof Error && error.message.startsWith('Bitte ')) throw error; throw new Error('Bitte gültige KI-Einstellungen eingeben.'); }
    if (values.apiKey) await setKey(values.baseUrl, values.apiKey);
    const ai = { baseUrl: values.baseUrl, smartModel: values.smartModel, simpleModel: values.simpleModel, smartThinking: values.smartThinking, simpleThinking: values.simpleThinking, workspaceTools: values.workspaceTools ?? true, realMailAccess: values.realMailAccess ?? false, confirmationMode: values.confirmationMode ?? currentState.ai?.confirmationMode ?? 'ask', historyStart: currentState.ai?.historyStart ?? currentState.chat.length };
    await saveState({ ...currentState, ai, provider: values.smartModel });
    commit({ ...currentState, ai, provider: values.smartModel });
}
async function chooseLocalFile(context: OperationContext) {

    const owner = operationOwner(context);
    if (!owner) throw new Error('Kein Dateifenster verfügbar.');
    const result = await dialog.showOpenDialog(owner, { properties: ['openFile'] });
    context.signal.throwIfAborted();
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = await fs.realpath(result.filePaths[0]); const stat = await fs.stat(selected); selectedLocalFiles.add(selected);
    return { path: selected, name: path.basename(selected), size: stat.size } satisfies SelectedFile;
}
function queueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsWrites.then(operation);
  settingsWrites = result.catch(() => {});
  return result;
}
async function persistSettingsPatch(input: unknown): Promise<void> {
  const patch = settingsPatchSchema.parse(input);
  if (patch.navigationOrder) patch.navigationOrder = migrateNavigationOrder(patch.navigationOrder);
  if (patch.navigationOrder?.length) {
    const modules = moduleHost?.list() ?? [];
    const active = getNavigationEntries(modules).map(item => item.id);
    const allowed = new Set([...getNavigationEntries(modules, true).map(item => item.id), ...(currentState.settings.navigationOrder ?? [])]);
    if (patch.navigationOrder.some(id => !allowed.has(id))) throw new Error('Ein Navigationseintrag ist nicht bekannt. Bitte die Liste aktualisieren.');
    if (active.some(id => !patch.navigationOrder!.includes(id))) throw new Error('Die Reihenfolge muss alle verfügbaren Einträge enthalten. Bitte die Liste aktualisieren.');
    patch.navigationOrder = settingsPatchSchema.parse({ navigationOrder: mergeNavigationOrder(currentState.settings.navigationOrder, patch.navigationOrder) }).navigationOrder;
  }
  const settings = { ...currentState.settings, ...patch };
  // Publish only after successful persistence, so all windows retain saved values on failure.
  await saveState({ ...currentState, settings });
  commit({ ...currentState, settings });
  dock?.setAlwaysOnTop(settings.dockAlwaysOnTop);
}
function changeSettings(input: unknown, _context: OperationContext): Promise<void> {
  const patch = settingsPatchSchema.parse(input);
  return queueSettingsWrite(() => persistSettingsPatch(patch));
}
async function confirmQuit(context: OperationContext) {
    if (await confirmCapability(context, 'OpenVibeDesk beenden?', 'Alle Workspace-Fenster werden geschlossen. Dein aktueller Zustand wird gespeichert.')) { app.quit(); return { quitRequested: true }; }
    return { cancelled: true };
}
const selectedLocalFiles = new Set<string>();
async function controlPanel(kind: WindowKind, action: 'minimize' | 'toggleMaximize' | 'close') {
  const win = panels.get(kind);
  if (!win || win.isDestroyed()) throw new Error('Dieses Fenster ist nicht geöffnet.');
  if (action === 'minimize') win.minimize();
  else if (action === 'toggleMaximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else win.close();
  return { kind, action, closed: win.isDestroyed() };
}
function newWorkspaceChat(title?: string) {
  const result = createSession(currentState);
  commit(title ? renameSession(result.state, result.session.id, title) : result.state);
  return result.session.id;
}
function selectWorkspaceChat(id: string) { commit(selectSession(currentState, id)); }
function renameWorkspaceChat(id: string, title: string) { commit(renameSession(currentState, id, title)); }
function forkWorkspaceChat(id: string, replacementText?: string, fromAgent = false) {
  if (chatBusy && !fromAgent) throw new Error('Bitte warte, bis die laufende Antwort beendet ist.');
  const state = fromAgent ? { ...currentState, sessions: currentState.sessions.map(item => item.id === currentState.activeSessionId ? { ...item, messages: item.messages.map(message => message.status === 'streaming' ? { ...message, status: 'cancelled' as const } : message) } : item) } : currentState;
  const result = forkSession(state, id, replacementText);
  const next = fromAgent ? { ...currentState, sessions: [result.state.sessions[0], ...currentState.sessions], activeSessionId: result.result.sessionId, chat: result.state.sessions[0].messages } : result.state;
  commit(next);
  if (result.result.emailReference) forkMailReferences.set(result.result.sessionId, result.result.emailReference);
  if (result.result.references?.length) forkModuleReferences.set(result.result.sessionId, result.result.references);
  return result.result;
}
async function referenceWorkspaceChat(id: string) {
  snapshotSessionReference(currentState, id);
  await openPanel('chat');
  panels.get('chat')?.webContents.send('chat:reference-session', id);
  return { sessionId: id, selectedAsContext: true };
}
async function prepareSettings(kind: 'account' | 'smtp' | 'ai' | 'agent', values: Record<string, unknown>, accountId?: string) {
  await dispatchAction({ type: 'open_window', kind: 'settings' });
  panels.get('settings')?.webContents.send('settings:prepare', { category: kind === 'ai' ? 'ai' : kind === 'agent' ? 'agent' : 'mail', kind, values, ...(accountId ? { accountId } : {}) });
  return { status: 'requires_user_input', opened: 'settings', note: 'Die Angaben sind im Formular vorbereitet. Der Nutzer prüft sie, ergänzt gegebenenfalls Zugangsdaten und speichert.' };
}
async function confirmCapability(context: OperationContext, message: string, detail: string, options: { alwaysAsk?: boolean } = {}): Promise<boolean> {
  context.signal.throwIfAborted();
  if (!options.alwaysAsk && context.origin === 'agent' && currentState.ai?.workspaceTools !== false && currentState.ai?.confirmationMode === 'never') return true;
  const owner = operationOwner(context);
  if (!owner) throw new Error('Kein Workspace-Fenster für die Bestätigung verfügbar.');
  const result = await dialog.showMessageBox(owner, { type: 'question', title: 'OpenVibeDesk', message, detail, buttons: ['Abbrechen', 'Bestätigen'], defaultId: 0, cancelId: 0, noLink: true });
  context.signal.throwIfAborted();
  return result.response === 1;
}
function asToolMail(reference: EmailReference): Mail {
  return { ...reference, folder: 'Inbox', threadId: reference.id, read: true, bodyLoaded: true, externalFolder: '__reference__' };
}
function registerWorkspaceCapabilities(): void {
  workspaceCapabilities.register('context.get', (_args, rawContext) => {
    const context = rawContext as OperationContext;
    const sessionId = context.sessionId ?? currentState.activeSessionId;
    const chatReferences = new Map<string, { sessionId: string; title: string; available: boolean }>();
    for (const message of [...(currentState.sessions.find(item => item.id === sessionId)?.messages ?? [])].reverse()) {
      const reference = message.sessionRef;
      if (reference && !chatReferences.has(reference.id)) chatReferences.set(reference.id, { sessionId: reference.id.slice(0, 128), title: reference.title.slice(0, 120), available: currentState.sessions.some(item => item.id === reference.id) });
      if (chatReferences.size === 10) break;
    }
    const resourceReferences = new Map<string, { moduleId: string; type: string; id: string; title: string; available: boolean }>();
    for (const reference of [...(currentState.sessions.find(item => item.id === sessionId)?.messages ?? [])].reverse().flatMap(message => message.references ?? [])) {
      const parsed = moduleReferenceSchema.safeParse(reference);
      if (!parsed.success) continue;
      const { moduleId, type, id, title } = parsed.data, key = JSON.stringify([moduleId, type, id]);
      if (!resourceReferences.has(key)) resourceReferences.set(key, { moduleId, type, id, title, available: moduleHost?.isReady(moduleId) ?? false });
      if (resourceReferences.size === 10) break;
    }
    return { time: getTimeContext(new Date(), undefined, app.getLocale()), workspaceAccess: { toolsEnabled: currentState.ai?.workspaceTools !== false, confirmationMode: currentState.ai?.confirmationMode ?? 'ask' }, windows: currentState.windows.map(item => ({ kind: item.kind, open: panels.has(item.kind), minimized: panels.get(item.kind)?.isMinimized() ?? true })), sessionId, chatReferences: [...chatReferences.values()], moduleReferences: [...resourceReferences.values()], activeSessionId: currentState.activeSessionId, settings: currentState.settings, ...(moduleHost?.isReady('ovd-mail') ? mailModule?.getContext(context) ?? {} : {}), moduleWindows: [...moduleWindows.values()].map(({ moduleId, viewId, window }) => ({ moduleId, viewId, minimized: window.isMinimized() })) };
  });
  workspaceCapabilities.register('time.now', ({ timeZone, locale }) => getTimeContext(new Date(), timeZone, locale ?? app.getLocale()));
  workspaceCapabilities.register('time.resolve_range', args => resolveTimeRange(args));
  workspaceCapabilities.register('time.difference', args => resolveTimeDifference(args));
  workspaceCapabilities.register('math.calculate', args => evaluateCalculation(args));
  workspaceCapabilities.register('windows.list', () => [...currentState.windows.filter(item => !panelModules[item.kind] || moduleHost?.isReady(panelModules[item.kind]!)).map(item => ({ ...item, open: panels.has(item.kind), minimized: panels.get(item.kind)?.isMinimized() ?? true })), ...[...moduleWindows.values()].map(({ moduleId, viewId, window }) => ({ moduleId, viewId, open: true, minimized: window.isMinimized() }))]);
  workspaceCapabilities.register('windows.open', async ({ kind }) => { await dispatchAction({ type: 'open_window', kind }); return { kind, opened: true }; });
  workspaceCapabilities.register('windows.control', ({ kind, action }) => controlPanel(kind, action));
  workspaceCapabilities.register('chats.list', ({ query, limit }) => currentState.sessions.filter(item => !query || `${item.title} ${item.messages.map(message => message.text).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, limit ?? 20).map(({ id, title, updatedAt, messages }) => ({ id, title, updatedAt, messageCount: messages.length })));
  workspaceCapabilities.register('chats.read', args => readChatHistory(currentState, args));
  workspaceCapabilities.register('chats.create', async ({ title }) => { const sessionId = newWorkspaceChat(title); await openPanel('chat'); return { sessionId, opened: true }; });
  workspaceCapabilities.register('chats.use_model', async ({ tier }) => { const config = currentState.ai; if (!config || !(tier === 'smart' ? config.smartModel : config.simpleModel)) throw new Error('Dieses Modell bitte zuerst in den KI-Einstellungen einrichten.'); await openPanel('chat'); panels.get('chat')?.webContents.send('chat:use-model', tier); return { tier, appliesTo: 'next_messages' }; });
  workspaceCapabilities.register('chats.open', async ({ sessionId }) => { selectWorkspaceChat(sessionId); await openPanel('chat'); return { sessionId, opened: true }; });
  workspaceCapabilities.register('chats.rename', ({ sessionId, title }) => { renameWorkspaceChat(sessionId, title); return { sessionId, renamed: true }; });
  workspaceCapabilities.register('chats.reference', ({ sessionId }) => referenceWorkspaceChat(sessionId));
  workspaceCapabilities.register('chats.fork', ({ messageId, replacementText }) => { const result = forkWorkspaceChat(messageId, replacementText, true); panels.get('chat')?.webContents.send('chat:fork-draft', result); return { sessionId: result.sessionId, created: true }; });
  workspaceCapabilities.register('settings.agent_get', () => normalizeAgentSettings(currentState.agentSettings));
  workspaceCapabilities.register('settings.agent_save', args => prepareSettings('agent', args));
  workspaceCapabilities.register('settings.get', () => currentState.settings);
  workspaceCapabilities.register('settings.update', async (args, context) => { await changeSettings(args, context); return currentState.settings; });
  workspaceCapabilities.register('navigation.get', ({ offset = 0, limit = 50 }) => {
    const entries = orderNavigationEntries(getNavigationEntries(moduleHost?.list() ?? []), currentState.settings.navigationOrder);
    const hasMore = offset + limit < entries.length;
    return { entries: entries.slice(offset, offset + limit).map(({ id, title, moduleId, moduleTitle }, index) => ({ id, title, moduleId, moduleTitle, position: offset + index + 1 })), total: entries.length, customOrder: !!currentState.settings.navigationOrder?.length, hasMore, ...(hasMore ? { nextOffset: offset + limit } : {}) };
  });
  workspaceCapabilities.register('navigation.move', ({ entryId, beforeId, afterId }) => queueSettingsWrite(async () => {
    const entries = orderNavigationEntries(getNavigationEntries(moduleHost?.list() ?? []), currentState.settings.navigationOrder);
    const target = beforeId ?? afterId!;
    if (!entries.some(item => item.id === entryId) || !entries.some(item => item.id === target)) throw new Error('Diese Navigationseinträge sind nicht verfügbar. Bitte die Seitenleiste neu abfragen.');
    if (entryId === target) throw new Error('Ein Eintrag kann nicht relativ zu sich selbst verschoben werden.');
    const ids = entries.map(item => item.id).filter(id => id !== entryId);
    ids.splice(ids.indexOf(target) + (afterId ? 1 : 0), 0, entryId);
    await persistSettingsPatch({ navigationOrder: mergeNavigationOrder(currentState.settings.navigationOrder, ids) });
    return { saved: true, entryId, position: ids.indexOf(entryId) + 1, ...(beforeId ? { beforeId } : { afterId }) };
  }));
  workspaceCapabilities.register('settings.open', async (args) => { await openSettingsCategory(args.category, args.search); return { opened: true, ...args }; });
  workspaceCapabilities.register('modules.list', () => moduleHost?.statuses() ?? []);
  workspaceCapabilities.register('modules.set_enabled', ({ moduleId, enabled }, context) => moduleHost!.setEnabled(moduleId, enabled, context).then(() => ({ moduleId, status: moduleHost!.registry.getModule(moduleId)?.status })));
  workspaceCapabilities.register('settings.ai_get', (_args, context) => readAiSettings(context));
  workspaceCapabilities.register('settings.ai_save', args => prepareSettings('ai', args));
  workspaceCapabilities.register('settings.ai_models', () => { const config = currentState.ai ?? defaultAiConfig; return getKey(config.baseUrl).then(key => listModels(config, key)); });
  workspaceCapabilities.register('settings.ai_clear_key', async (_args, context) => { if (!await confirmCapability(context, 'Gespeicherten API-Schlüssel entfernen?', 'Der KI-Anbieter benötigt gegebenenfalls anschließend einen neuen Schlüssel.')) return { cancelled: true }; await deleteKey((currentState.ai ?? defaultAiConfig).baseUrl); return { removed: true }; });
  workspaceCapabilities.register('app.quit', (_args, context) => confirmQuit(context));
}

async function sendChat(text: unknown, emailRef: unknown, rawOptions: unknown): Promise<void> {
  if (typeof text !== 'string' || !text.trim() || text.length > 20_000) throw new Error('Invalid message');
  if (emailRef !== undefined) validateEmailReferenceId(emailRef);
  if (chatBusy) throw new Error('Bitte warte auf die laufende Antwort.');
  const config = currentState.ai;
  const agentSettings = normalizeAgentSettings(currentState.agentSettings);
  const options = chatOptionsSchema.parse(rawOptions);
  if (options.clientRequestId && currentState.sessions.some(session => session.messages.some(message => message.clientRequestId === options.clientRequestId))) throw new Error('Diese Nachricht wurde bereits im Chat gespeichert. Bitte verwende für eine neue Anfrage eine neue Nachricht.');
  if (!config || !(options.tier === 'smart' ? config.smartModel : config.simpleModel)) throw new Error('Bitte zuerst ein Modell für diese Auswahl in den KI-Einstellungen speichern.');
  const sessionId = currentState.activeSessionId;
  if (options.sessionId && options.sessionId !== sessionId) throw new Error('Der aktive Chat wurde gewechselt. Bitte erneut versuchen.');
  const chatSession = currentState.sessions.find(s => s.id === sessionId);
  if (!chatSession) throw new Error('Chat nicht gefunden.');
  const sessionRef = options.sessionRefId ? snapshotSessionReference(currentState, options.sessionRefId, sessionId) : undefined;
  const message = text.trim();
  const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: message, ...(options.clientRequestId ? { clientRequestId: options.clientRequestId } : {}), sessionRef, timestamp: new Date().toISOString() };
  const assistant: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: '', status: 'streaming', timestamp: new Date().toISOString() };
  const history = chatSession.messages.slice(chatSession.historyStart).filter(m => m.status !== 'streaming' && m.status !== 'failed' && (m.role !== 'assistant' || m.text.trim()));
  chatBusy = true;
  const controller = new AbortController();
  let buffered = '', flushTimer: NodeJS.Timeout | undefined, lastCheckpoint = Date.now();
  const updateAssistant = (patch: Partial<ChatMessage>) => commit(updateSessionMessages(currentState, sessionId, messages => messages.map(m => m.id === assistant.id ? { ...m, ...patch } : m)));
  const flush = () => { if (flushTimer) clearTimeout(flushTimer); flushTimer = undefined; if (buffered) { const text = buffered; buffered = ''; commit(updateSessionMessages(currentState, sessionId, messages => messages.map(m => m.id === assistant.id ? { ...m, text: m.text + text } : m))); if (Date.now() - lastCheckpoint >= 2000) { lastCheckpoint = Date.now(); void saveState(currentState).catch(error => console.error('Workspace save failed', error)); } } };
  activeStream = { controller, flush, sessionId, assistantId: assistant.id };
  let prepared = false;
  let runLimit: AgentRunLimit | undefined;
  try {
    if (emailRef !== undefined) {
      user.emailReference = await snapshotEmailReference(emailRef, sessionId, controller.signal);
      user.emailRef = user.emailReference.id;
    }
    if (options.references?.length) {
      user.references = [];
      for (const reference of options.references) user.references.push(await snapshotModuleReference(reference, sessionId, controller.signal));
    }
    if (controller.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    commit(updateSessionMessages(currentState, sessionId, messages => [...messages, user, assistant]));
    try { await saveState(currentState); }
    catch {
      commit(updateSessionMessages(currentState, sessionId, messages => messages.filter(item => item.id !== user.id && item.id !== assistant.id)));
      throw new Error('Die Nachricht konnte lokal nicht gespeichert werden. Bitte erneut versuchen; es wurde keine KI-Anfrage gesendet.');
    }
    prepared = true;
    forkMailReferences.delete(sessionId);
    forkModuleReferences.delete(sessionId);
    if (options.clientRequestId) panels.get('chat')?.webContents.send('chat:request-committed', options.clientRequestId);
    const key = await getKey(config.baseUrl);
    if (controller.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    const toolsEnabled = config.workspaceTools !== false;
    const providerMessages = makeMessages(history, currentState.mails, user, toolsEnabled, moduleHost?.summaries() ?? [], config.confirmationMode ?? 'ask', agentSettings, getTimeContext(new Date(), undefined, app.getLocale()));
    const primaryEmailId = user.emailReference?.id ?? [...history].reverse().find(item => item.emailReference)?.emailReference?.id;
    const referenceIds = new Set([...[...history, user].map(item => item.emailReference?.id).filter((id): id is string => !!id), ...(mailModule?.getRecentSearchIds(sessionId) ?? [])]);
    const onDelta = (delta: string) => { buffered += delta; if (!flushTimer) flushTimer = setTimeout(flush, 50); };
    if (toolsEnabled) await runAgent(config, key, providerMessages, options, controller.signal, onDelta,
      { settings: agentSettings, getModules: query => moduleHost!.find(query),
        getModuleTools: query => moduleHost!.getTools(query),
        invokeModuleTool: (moduleId, name, args, signal) => moduleHost!.invoke(moduleId, name, args, { origin: 'agent', signal, owner: panels.get('chat'), referenceIds: [...referenceIds], primaryEmailId, sessionId, grantMailIds: ids => ids.forEach(id => referenceIds.add(id)) } as OperationContext),
        onLimitReached: info => { runLimit = info; updateAssistant({ agentRunLimit: info }); },
        onReplaceText: text => { flush(); updateAssistant({ text }); },
        onToolEvent: event => commit(updateSessionMessages(currentState, sessionId, messages => messages.map(m => m.id === assistant.id ? { ...m, toolEvents: [...(m.toolEvents ?? []), event] } : m))) });
    else await streamCompletion(config, key, providerMessages, options, controller.signal, onDelta, agentSettings.requestTimeoutSeconds * 1000);
    flush(); updateAssistant({ status: runLimit ? 'limited' : 'completed' });
  } catch (error) {
    if (!prepared) throw error;
    flush();
    const cancelled = controller.signal.aborted;
    updateAssistant({ status: cancelled ? 'cancelled' : 'failed', ...(!cancelled ? { error: error instanceof Error ? error.message : 'Die Antwort wurde unterbrochen.' } : {}) });
  } finally { activeStream = undefined; chatBusy = false; }
}

function requireMailModule(): MailModule {
  if (!mailModule || !moduleHost?.isReady('ovd-mail')) throw new Error('Das Mailmodul ist nicht verfügbar. Bitte unter Einstellungen → Module aktivieren.');
  return mailModule;
}
async function initializeMailModule(): Promise<void> {
  if (mailModule) return;
  const { createMailModule } = await import('../modules/ovd-mail/backend');
  const module = createMailModule({ getState: () => currentState, commit, saveState, panels, openPanel, dispatchAction, prepareSettings, confirmCapability, operationOwner, uiOperationContext, verifyPanel: (event, kinds) => { requireMailModule(); verifyPanel(event, kinds); }, verifySender: event => { requireMailModule(); verifySender(event); }, boundedEmailReference, savedEmailReference, snapshotEmailReference, emailReferenceSummary, selectedLocalFiles });
  await module.initialize();
  module.registerCapabilities(workspaceCapabilities);
  module.registerIpc();
  mailModule = module;
}
function requireFilesModule(): FilesModule {
  if (!filesModule || !moduleHost?.isReady('ovd-files')) throw new Error('Das Dateienmodul ist nicht verfügbar. Bitte unter Einstellungen → Module aktivieren.');
  return filesModule;
}
async function initializeFilesModule(): Promise<void> {
  if (filesModule) { filesModule.activate(); return; }
  const { createFilesModule } = await import('../modules/ovd-files/backend');
  const module = createFilesModule({ dataRoot: path.join(app.getPath('userData'), 'module-data', 'ovd-files'), panels, openPanel, operationOwner, uiOperationContext, selectedLocalFiles, reference: selectModuleReference,
    verifySender: event => { requireFilesModule(); verifySender(event); }, verifyPanel: (event, kinds) => { requireFilesModule(); verifyPanel(event, kinds); } });
  await module.initialize();
  module.registerCapabilities(workspaceCapabilities);
  module.registerIpc();
  moduleReferences.register('ovd-files', 'file', { summary: (id, context) => module.getReference(id, context), snapshot: (id, context) => module.snapshotReference(id, context) });
  filesModule = module;
}
function requireMcpModule(): McpModule {
  if (!mcpModule || !moduleHost?.isReady('ovd-mcp')) throw new Error('Das MCP-Modul ist nicht verfügbar. Bitte unter Einstellungen → Module aktivieren.');
  return mcpModule;
}
async function initializeMcpModule(): Promise<void> {
  if (mcpModule) { await mcpModule.activate(); return; }
  const { createMcpModule } = await import('../modules/ovd-mcp/backend');
  const module = createMcpModule({
    dataRoot: path.join(app.getPath('userData'), 'module-data', 'ovd-mcp'),
    verifySender: event => { requireMcpModule(); verifySender(event); },
    verifySettings: event => { requireMcpModule(); verifyPanel(event, ['settings']); },
    uiOperationContext, confirm: confirmCapability,
    requestTimeoutMs: () => normalizeAgentSettings(currentState.agentSettings).requestTimeoutSeconds * 1000,
    prepareServer: async request => { await openSettingsCategory('mcp'); panels.get('settings')?.webContents.send('mcp:prepare-server', request); },
    changed: () => {
      for (const win of [dock, ...panels.values()]) if (win && !win.isDestroyed()) win.webContents.send('mcp:changed');
      modulesChanged();
    }
  });
  await module.initialize();
  module.registerCapabilities(workspaceCapabilities);
  module.registerIpc();
  moduleHost!.registerToolProvider(module.toolProvider);
  mcpModule = module;
}

function controlNativeWindow(win: BrowserWindow, action: 'minimize' | 'toggleMaximize' | 'close') {
  if (action === 'minimize') win.minimize();
  else if (action === 'toggleMaximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  else win.close();
  return { action, closed: win.isDestroyed() };
}
function dockHeight(): number {
  const count = getNavigationEntries(moduleHost?.list() ?? []).length + 1;
  return Math.min(screen.getPrimaryDisplay().workArea.height - 24, Math.max(340, 66 + count * 60));
}
function modulesChanged(): void {
  for (const win of [dock, ...panels.values(), ...[...moduleWindows.values()].map(item => item.window)]) if (win && !win.isDestroyed()) win.webContents.send('modules:changed');
  if (dock && !dock.isDestroyed()) { const [width] = dock.getSize(); dock.setSize(width, dockHeight()); }
}
async function openSettingsCategory(category?: string, search?: string): Promise<void> {
  if (category && !['ai', 'agent', 'display', 'dock', 'modules', ...(moduleHost?.settingsCategories() ?? [])].includes(category)) throw new Error('Diese Einstellungskategorie ist nicht verfügbar.');
  await openPanel('settings');
  panels.get('settings')?.webContents.send('settings:navigate', { category, search });
}
async function openNativeModuleView(moduleId: string, viewId: string): Promise<void> {
  if (panelModules[viewId as WindowKind] === moduleId) return openPanel(viewId as WindowKind);
  const view = moduleHost?.registry.getModule(moduleId)?.manifest?.contributions.views.find(item => item.id === viewId);
  if (!view?.entry) throw new Error('Diese Modulansicht ist nicht verfügbar.');
  const key = `${moduleId}:${viewId}`, existing = moduleWindows.get(key)?.window;
  if (existing && !existing.isDestroyed()) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); return; }
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({ x: area.x + 130, y: area.y + 100, width: Math.min(800, area.width), height: Math.min(620, area.height), minWidth: 450, minHeight: 360, icon: appIconPath,
    title: `OpenVibeDesk · ${view.title}`, frame: false, backgroundColor: '#ffffff', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  moduleWindows.set(key, { moduleId, viewId, window: win });
  setupWindow(win);
  win.on('closed', () => moduleWindows.delete(key));
  await win.loadFile(path.join(__dirname, '../../dist/index.html'), { query: { view: 'module', moduleId, viewId } });
}
function verifyModuleFrame(event: Electron.IpcMainInvokeEvent, moduleId: unknown): string {
  verifySender(event);
  if (typeof moduleId !== 'string' || moduleId.length > 128 || !moduleHost?.isReady(moduleId)) throw new Error('Ungültiges Modul.');
  const ownWindow = [...moduleWindows.values()].some(item => item.moduleId === moduleId && item.window.webContents === event.sender);
  const settings = panels.get('settings')?.webContents === event.sender && !!moduleHost.registry.getModule(moduleId)?.manifest?.contributions.settings.length;
  if (!ownWindow && !settings) throw new Error('Die Modulansicht darf nur Funktionen ihres eigenen Moduls verwenden.');
  return moduleId;
}
async function initializeModules(): Promise<void> {
  const userData = app.getPath('userData');
  moduleHost = new ModuleHost({ builtInRoot: path.join(app.getAppPath(), 'modules'), userRoot: path.join(userData, 'modules'), dataRoot: path.join(userData, 'module-data'), configFile: path.join(userData, 'module-settings.json'), capabilities: workspaceCapabilities,
    activateBuiltin: async id => { if (id === 'ovd-mail') await initializeMailModule(); if (id === 'ovd-files') await initializeFilesModule(); if (id === 'ovd-mcp') await initializeMcpModule(); },
    beforeDisable: async id => {
      if (id === 'ovd-mail' && mailModule?.getSendingCount()) throw new Error('Bitte warte auf den laufenden Mailversand.');
      if (id === 'ovd-mail' && mailModule?.getSettingsStatus() !== undefined && mailModule.getSettingsStatus() !== 'clean') throw new Error('Bitte Mail-Einstellungen zuerst speichern oder zurücksetzen.');
      if (id === 'ovd-mcp' && mcpSettingsStatus !== 'clean') throw new Error('Bitte die MCP-Einstellungen zuerst speichern oder zurücksetzen.');
    },
    afterDisable: async id => {
      if (id === 'ovd-files') filesModule?.deactivate();
      if (id === 'ovd-mcp') { await mcpModule?.deactivate(); mcpSettingsStatus = 'clean'; }
      for (const [kind, moduleId] of Object.entries(panelModules)) if (moduleId === id) panels.get(kind as WindowKind)?.close();
      for (const item of [...moduleWindows.values()]) if (item.moduleId === id) item.window.close();
      panels.get('settings')?.webContents.send('settings:navigate', { category: 'modules' });
    }, changed: modulesChanged, openView: openNativeModuleView,
    controlView: (moduleId, viewId, action) => { const win = moduleWindows.get(`${moduleId}:${viewId}`)?.window; if (!win || win.isDestroyed()) throw new Error('Dieses Modulfenster ist nicht geöffnet.'); return controlNativeWindow(win, action); },
    openSettings: category => openSettingsCategory(category), confirm: confirmCapability });
  await moduleHost.initialize();
  protocol.handle('ovd-module', async request => {
    try {
      const url = new URL(request.url), parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (request.method !== 'GET' || url.hostname !== 'view' || parts.length !== 2 || url.search || url.username || url.password) throw new Error('Ungültige Modulansicht.');
      const html = await moduleHost!.readView(parts[0], parts[1]);
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'" } });
    } catch { return new Response('Diese Modulansicht ist nicht verfügbar. Bitte den Modulstatus prüfen.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': "default-src 'none'" } }); }
  });
  ipcMain.handle('modules:list', event => { verifySender(event); return moduleHost!.list(); });
  ipcMain.handle('modules:set-enabled', (event, id: unknown, enabled: unknown) => { verifyPanel(event, ['settings']); if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('Ungültige Modulaktion.'); return moduleHost!.setEnabled(id, enabled, uiOperationContext(event)); });
  ipcMain.handle('modules:open-view', (event, id: unknown, viewId: unknown) => { verifySender(event); if (typeof id !== 'string' || typeof viewId !== 'string') throw new Error('Ungültige Modulansicht.'); return moduleHost!.openView(id, viewId); });
  ipcMain.handle('modules:read-view', (event, id: unknown, viewId: unknown) => { const moduleId = verifyModuleFrame(event, id); if (typeof viewId !== 'string' || viewId.length > 100) throw new Error('Ungültige Modulansicht.'); return moduleHost!.readView(moduleId, viewId); });
  ipcMain.handle('modules:invoke', (event, id: unknown, tool: unknown, args: unknown) => { const moduleId = verifyModuleFrame(event, id); if (typeof tool !== 'string' || tool.length > 128) throw new Error('Ungültige Modulfunktion.'); return moduleHost!.invoke(moduleId, tool, args, uiOperationContext(event), true); });
}

if (hasInstanceLock) app.on('second-instance', () => {
  if (dock && !dock.isDestroyed()) { if (dock.isMinimized()) dock.restore(); dock.show(); dock.focus(); }
});

if (hasInstanceLock) app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(appIconPath);
  await initializeStore();
  const loaded = loadState() ?? initialState();
  currentState = normalizeSessions({ ...loaded, settings: normalizeSettings(loaded.settings), agentSettings: normalizeAgentSettings(loaded.agentSettings), ...(loaded.ai ? { ai: normalizeAiConfig(loaded.ai) } : {}) });
  for (const item of currentState.sessions) if (item.messages.some(m => m.status === 'streaming')) currentState = updateSessionMessages(currentState, item.id, messages => messages.map(m => m.status === 'streaming' ? { ...m, status: 'cancelled' } : m));
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ipcMain.handle('workspace:load', event => { verifySender(event); return currentState; });
  ipcMain.handle('workspace:action', (event, action: unknown) => { verifySender(event); return dispatchAction(action); });
  ipcMain.handle('window:control', (event, action: unknown) => {
    verifySender(event);
    const kind = [...panels].find(([, win]) => win.webContents === event.sender)?.[0];
    const external = [...moduleWindows.values()].find(item => item.window.webContents === event.sender);
    if (external && ['minimize', 'toggleMaximize', 'close'].includes(String(action))) return controlNativeWindow(external.window, action as 'minimize' | 'toggleMaximize' | 'close');
    if (!kind || !['minimize', 'toggleMaximize', 'close'].includes(String(action))) throw new Error('Ungültige Fensteraktion.');
    return controlPanel(kind, action as 'minimize' | 'toggleMaximize' | 'close');
  });
  ipcMain.handle('workspace:quit', (event) => { verifySender(event); return confirmQuit(uiOperationContext(event)); });
  ipcMain.handle('settings:update', (event, input: unknown) => { verifySender(event); return changeSettings(input, uiOperationContext(event)); });
  ipcMain.on('ai:settings:status', (event, status: unknown) => {
    const settings = panels.get('settings');
    if (!settings || settings.isDestroyed() || event.sender !== settings.webContents || event.senderFrame !== event.sender.mainFrame) return;
    if (status === 'clean' || status === 'dirty' || status === 'busy') aiSettingsStatus = status;
  });
  ipcMain.handle('agent:settings:open', event => { verifySender(event); return openSettingsCategory('agent'); });
  ipcMain.handle('agent:settings:get', event => { verifySender(event); return normalizeAgentSettings(currentState.agentSettings); });
  ipcMain.handle('agent:settings:save', async (event, input: unknown) => { verifyPanel(event, ['settings']); const agentSettings = agentSettingsSchema.parse(input); await saveState({ ...currentState, agentSettings }); commit({ ...currentState, agentSettings }); });
  ipcMain.on('agent:settings:status', (event, status: unknown) => { const settings = panels.get('settings'); if (settings && !settings.isDestroyed() && event.sender === settings.webContents && event.senderFrame === event.sender.mainFrame && ['clean', 'dirty', 'busy'].includes(String(status))) agentSettingsStatus = status as 'clean' | 'dirty' | 'busy'; });
  ipcMain.on('mcp:settings:status', (event, status: unknown) => { const settings = panels.get('settings'); if (settings && !settings.isDestroyed() && event.sender === settings.webContents && event.senderFrame === event.sender.mainFrame && ['clean', 'dirty', 'busy'].includes(String(status))) mcpSettingsStatus = status as 'clean' | 'dirty' | 'busy'; });
  ipcMain.handle('ai:settings:get', (event) => { verifySender(event); return readAiSettings(uiOperationContext(event)); });
  ipcMain.handle('ai:settings:save', (event, input: unknown) => { verifySender(event); return saveAiSettings(input, uiOperationContext(event)); });
  ipcMain.handle('ai:models:list', async event => { verifySender(event); const config = currentState.ai ?? defaultAiConfig; return listModels(config, await getKey(config.baseUrl)); });
  ipcMain.handle('ai:key:clear', async event => { verifySender(event); await deleteKey((currentState.ai ?? defaultAiConfig).baseUrl); });
  ipcMain.handle('chat:session:create', event => { verifySender(event); return newWorkspaceChat(); });
  ipcMain.handle('chat:session:select', (event, id: unknown) => { verifySender(event); if (typeof id !== 'string') throw new Error('Ungültiger Chat.'); selectWorkspaceChat(id); });
  ipcMain.handle('chat:session:rename', (event, id: unknown, title: unknown) => { verifySender(event); if (typeof id !== 'string' || typeof title !== 'string') throw new Error('Ungültiger Titel.'); renameWorkspaceChat(id, title); });
  ipcMain.handle('chat:session:fork', (event, id: unknown, replacementText: unknown) => { verifySender(event); if (typeof id !== 'string' || (replacementText !== undefined && typeof replacementText !== 'string')) throw new Error('Ungültige Nachricht.'); return forkWorkspaceChat(id, replacementText); });
  ipcMain.handle('chat:session:reference', async (event, id: unknown) => { verifySender(event); if (typeof id !== 'string') throw new Error('Ungültiger Chat.'); return referenceWorkspaceChat(id); });
  ipcMain.handle('chat:open-external-link', async (event, input: unknown) => {
    verifyPanel(event, ['chat']);
    const url = getExternalChatUrl(input);
    if (!url) throw new Error('Dieser Link kann nicht geöffnet werden. Erlaubt sind HTTP-, HTTPS- und E-Mail-Links.');
    try { await shell.openExternal(url); }
    catch { throw new Error('Der Link konnte nicht geöffnet werden. Prüfe die Standard-App für diesen Linktyp.'); }
  });
  ipcMain.handle('chat:mail-reference', (event, id: unknown) => { verifyPanel(event, ['chat']); return emailReferenceSummary(id); });
  ipcMain.handle('chat:module-reference', (event, input: unknown) => { verifyPanel(event, ['chat']); return moduleReferenceSummary(input, { ...uiOperationContext(event), sessionId: currentState.activeSessionId }); });
  ipcMain.handle('chat:send', (event, text: unknown, emailRef: unknown, options: unknown) => { verifyPanel(event, ['chat']); return sendChat(text, emailRef, options); });
  ipcMain.handle('chat:cancel', event => { verifySender(event); activeStream?.controller.abort(); });
  ipcMain.handle('files:list', async (event, requested?: string): Promise<FileListing> => { verifySender(event); if (requested !== undefined && typeof requested !== 'string') throw new Error('Ungültiger Dateipfad.'); const result = await requireFilesModule().list({ path: requested, limit: 100 }, uiOperationContext(event)); return { path: result.path, entries: result.entries }; });
  ipcMain.handle('files:choose', (event) => { verifySender(event); return chooseLocalFile(uiOperationContext(event)); });
  registerWorkspaceCapabilities();
  await initializeModules();
  await openDock();
  for (const kind of currentState.windows.filter(w => !w.minimized && (!panelModules[w.kind] || moduleHost?.isReady(panelModules[w.kind]!))).map(w => w.kind)) await openPanel(kind);
});
app.on('before-quit', event => {
  if (readyToQuit || !currentState) return;
  event.preventDefault();
  if (quitting) return;
  if (mailModule?.getSendingCount()) { dialog.showErrorBox('Versand läuft', 'Bitte warte, bis der laufende Versand abgeschlossen ist, bevor du OpenVibeDesk beendest.'); return; }
  if (!confirmSettingsClose()) return;
  allowSettingsUnload = aiSettingsStatus === 'dirty' || agentSettingsStatus === 'dirty' || mcpSettingsStatus === 'dirty' || mailModule?.getSettingsStatus() === 'dirty';
  quitting = true;
  if (activeStream) { activeStream.controller.abort(); activeStream.flush(); const { sessionId, assistantId } = activeStream; currentState = updateSessionMessages(currentState, sessionId, messages => messages.map(m => m.id === assistantId && m.status === 'streaming' ? { ...m, status: 'cancelled' } : m)); }
  if (saveTimer) clearTimeout(saveTimer);
  void saveState(currentState).catch(error => {
    console.error('Workspace save failed', error);
    dialog.showErrorBox('OpenVibeDesk', 'Der aktuelle Zustand konnte vor dem Beenden nicht gespeichert werden.');
  }).finally(async () => { try { await mcpModule?.deactivate(); } catch { /* Other windows still shut down even if a transport is already gone. */ } moduleHost?.dispose(); readyToQuit = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());

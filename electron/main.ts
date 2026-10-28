import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyUiAction, initialState, uiActionSchema } from '../shared/actions';
import { initializeStore, loadState, saveState } from './store';
import { settingsPatchSchema, normalizeSettings } from '../shared/settings';
import { normalizeSessions, createSession, selectSession, renameSession, forkSession, updateSessionMessages, snapshotSessionReference } from '../shared/sessions';
import { defaultAiConfig, normalizeAiConfig, parseAiInput, chatOptionsSchema, getKey, setKey, deleteKey, listModels, makeMessages } from './ai';
import { streamCompletion } from './stream';
import type { ChatMessage, FileListing, Folder, SelectedFile, WindowKind, WorkspaceState } from '../shared/model';

app.enableSandbox();
if (app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'ai-workspace'));
let currentState: WorkspaceState;
let dock: BrowserWindow | null = null;
const panels = new Map<WindowKind, BrowserWindow>();
let saveTimer: NodeJS.Timeout | undefined;
let quitting = false;
let readyToQuit = false;
let chatBusy = false;
let activeStream: { controller: AbortController; flush(): void; sessionId: string; assistantId: string } | undefined;

function verifySender(event: Electron.IpcMainInvokeEvent): void {
  const known = [dock, ...panels.values()].some(win => win && !win.isDestroyed() && event.sender === win.webContents);
  if (!known || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender');
}
function broadcast(): void { for (const win of [dock, ...panels.values()]) if (win && !win.isDestroyed()) win.webContents.send('workspace:changed', currentState); }
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
function panelTitle(kind: WindowKind): string { return { mail: 'Mail', chat: 'Assistant', draft: 'Draft', files: 'Files', settings: 'Einstellungen', sessions: 'Chats' }[kind]; }

async function openPanel(kind: WindowKind): Promise<void> {
  const existing = panels.get(kind);
  if (existing && !existing.isDestroyed()) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); return; }
  const saved = currentState.windows.find(w => w.kind === kind);
  const sizes: Record<WindowKind, [number, number]> = { mail: [760, 560], chat: [570, 610], draft: [640, 530], files: [580, 470], settings: [650, 540], sessions: [560, 520] };
  const [width, height] = sizes[kind];
  const area = screen.getPrimaryDisplay().workArea;
  const x = saved ? Math.max(area.x, Math.min(saved.x, area.x + area.width - 180)) : area.x + 100 + panels.size * 70;
  const y = saved ? Math.max(area.y, Math.min(saved.y, area.y + area.height - 100)) : area.y + 80 + panels.size * 60;
  const win = new BrowserWindow({ x, y, width: Math.max(saved?.width ?? width, 450), height: Math.max(saved?.height ?? height, 360),
    minWidth: 450, minHeight: 360, title: `OpenVibeDesk · ${panelTitle(kind)}`, frame: false, backgroundColor: '#ffffff', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  panels.set(kind, win);
  setupWindow(win);
  const rememberBounds = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    const bounds = win.getBounds();
    commit({ ...currentState, windows: currentState.windows.map(w => w.kind === kind ? { ...w, ...bounds } : w) });
  };
  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);
  win.on('closed', () => { panels.delete(kind); if (!quitting) commit({ ...currentState, windows: currentState.windows.map(w => w.kind === kind ? { ...w, minimized: true } : w) }); });
  await win.loadFile(path.join(__dirname, '../../dist/index.html'), { query: { view: kind } });
}

async function openDock(): Promise<void> {
  const area = screen.getPrimaryDisplay().workArea;
  dock = new BrowserWindow({ x: area.x + 12, y: Math.round(area.y + (area.height - 486) / 2),
    width: 78, height: 486, minWidth: 78, minHeight: 486, frame: false, transparent: true, resizable: false,
    movable: true, alwaysOnTop: currentState.settings.dockAlwaysOnTop, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  setupWindow(dock);
  dock.on('closed', () => { dock = null; app.quit(); });
  await dock.loadFile(path.join(__dirname, '../../dist/index.html'), { query: { view: 'dock' } });
}

async function listFiles(requested?: string): Promise<FileListing> {
  const root = await fs.realpath(app.getPath('documents'));
  const resolved = await fs.realpath(requested ?? root);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Directory is outside Documents');
  const entries = await Promise.all((await fs.readdir(resolved, { withFileTypes: true })).map(async item => {
    const fullPath = path.join(resolved, item.name); const stat = await fs.stat(fullPath).catch(() => null);
    return { name: item.name, path: fullPath, isDirectory: item.isDirectory(), size: stat?.size ?? 0 };
  }));
  return { path: resolved, entries: entries.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name)) };
}

async function dispatchAction(raw: unknown): Promise<void> {
  const action = uiActionSchema.parse(raw);
  commit(applyUiAction(currentState, action).state);
  if (action.type === 'open_window' || action.type === 'create_draft' || action.type === 'read_email' || action.type === 'open_file_manager') {
    const kind = action.type === 'open_window' ? action.kind : action.type === 'create_draft' ? 'draft' : action.type === 'read_email' ? 'mail' : 'files';
    await openPanel(kind);
  } else if (action.type === 'focus_window') {
    const kind = currentState.windows.find(w => w.id === action.windowId)?.kind;
    if (kind) await openPanel(kind);
  } else if (action.type === 'request_user_input') panels.get('chat')?.webContents.send('workspace:input-request', action.prompt);
}

async function sendChat(text: unknown, emailRef: unknown, rawOptions: unknown): Promise<void> {
  if (typeof text !== 'string' || !text.trim() || text.length > 20_000) throw new Error('Invalid message');
  if (emailRef !== undefined && (typeof emailRef !== 'string' || !currentState.mails.some(m => m.id === emailRef))) throw new Error('Invalid email reference');
  if (chatBusy) throw new Error('Bitte warte auf die laufende Antwort.');
  const config = currentState.ai;
  const options = chatOptionsSchema.parse(rawOptions);
  if (!config || !(options.tier === 'smart' ? config.smartModel : config.simpleModel)) throw new Error('Bitte zuerst ein Modell für diese Auswahl in den KI-Einstellungen speichern.');
  const sessionId = currentState.activeSessionId;
  if (options.sessionId && options.sessionId !== sessionId) throw new Error('Der aktive Chat wurde gewechselt. Bitte erneut versuchen.');
  const chatSession = currentState.sessions.find(s => s.id === sessionId);
  if (!chatSession) throw new Error('Chat nicht gefunden.');
  const sessionRef = options.sessionRefId ? snapshotSessionReference(currentState, options.sessionRefId, sessionId) : undefined;
  const email = currentState.mails.find(m => m.id === emailRef);
  const message = text.trim();
  const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: message, emailRef: email?.id, sessionRef, timestamp: new Date().toISOString() };
  const assistant: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: '', status: 'streaming', timestamp: new Date().toISOString() };
  const history = chatSession.messages.slice(chatSession.historyStart).filter(m => m.status !== 'streaming' && m.status !== 'failed' && (m.role !== 'assistant' || m.text.trim()));
  chatBusy = true;
  const controller = new AbortController();
  let buffered = '', flushTimer: NodeJS.Timeout | undefined, lastCheckpoint = Date.now();
  const updateAssistant = (patch: Partial<ChatMessage>) => commit(updateSessionMessages(currentState, sessionId, messages => messages.map(m => m.id === assistant.id ? { ...m, ...patch } : m)));
  const flush = () => { if (flushTimer) clearTimeout(flushTimer); flushTimer = undefined; if (buffered) { const text = buffered; buffered = ''; commit(updateSessionMessages(currentState, sessionId, messages => messages.map(m => m.id === assistant.id ? { ...m, text: m.text + text } : m))); if (Date.now() - lastCheckpoint >= 2000) { lastCheckpoint = Date.now(); void saveState(currentState).catch(error => console.error('Workspace save failed', error)); } } };
  activeStream = { controller, flush, sessionId, assistantId: assistant.id };
  commit(updateSessionMessages(currentState, sessionId, messages => [...messages, user, assistant]));
  try {
    const key = await getKey(config.baseUrl);
    if (controller.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    await streamCompletion(config, key, makeMessages(history, currentState.mails, user), options, controller.signal, delta => { buffered += delta; if (!flushTimer) flushTimer = setTimeout(flush, 50); });
    flush(); updateAssistant({ status: 'completed' });
  } catch (error) {
    flush();
    const cancelled = controller.signal.aborted;
    updateAssistant({ status: cancelled ? 'cancelled' : 'failed', ...(!cancelled ? { error: error instanceof Error ? error.message : 'Die Antwort wurde unterbrochen.' } : {}) });
  } finally { activeStream = undefined; chatBusy = false; }
}

app.whenReady().then(async () => {
  await initializeStore();
  const loaded = loadState() ?? initialState();
  currentState = normalizeSessions({ ...loaded, settings: normalizeSettings(loaded.settings), ...(loaded.ai ? { ai: normalizeAiConfig(loaded.ai) } : {}) });
  for (const item of currentState.sessions) if (item.messages.some(m => m.status === 'streaming')) currentState = updateSessionMessages(currentState, item.id, messages => messages.map(m => m.status === 'streaming' ? { ...m, status: 'cancelled' } : m));
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ipcMain.handle('workspace:load', event => { verifySender(event); return currentState; });
  ipcMain.handle('workspace:action', (event, action: unknown) => { verifySender(event); return dispatchAction(action); });
  ipcMain.handle('window:control', (event, action: unknown) => {
    verifySender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || ![...panels.values()].includes(win)) throw new Error('Only panel windows can use window controls');
    if (action === 'minimize') win.minimize();
    else if (action === 'toggleMaximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
    else if (action === 'close') setImmediate(() => { if (!win.isDestroyed()) win.close(); });
    else throw new Error('Invalid window control');
  });
  ipcMain.handle('workspace:quit', async event => {
    verifySender(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) return;
    const result = await dialog.showMessageBox(owner, {
      type: 'question', title: 'OpenVibeDesk beenden?',
      message: 'OpenVibeDesk beenden?',
      detail: 'Alle Workspace-Fenster werden geschlossen. Dein aktueller Zustand wird gespeichert.',
      buttons: ['Abbrechen', 'Beenden'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (result.response === 1) app.quit();
  });
  ipcMain.handle('settings:update', async (event, input: unknown) => {
    verifySender(event);
    const patch = settingsPatchSchema.parse(input);
    const settings = { ...currentState.settings, ...patch };
    commit({ ...currentState, settings });
    dock?.setAlwaysOnTop(settings.dockAlwaysOnTop);
    await saveState(currentState);
  });
  ipcMain.handle('ai:settings:get', async event => {
    verifySender(event);
    const config = currentState.ai ?? defaultAiConfig;
    return { baseUrl: config.baseUrl, smartModel: config.smartModel, simpleModel: config.simpleModel, smartThinking: config.smartThinking, simpleThinking: config.simpleThinking, hasApiKey: !!(await getKey(config.baseUrl)), configured: !!currentState.ai };
  });
  ipcMain.handle('ai:settings:save', async (event, input: unknown) => {
    verifySender(event);
    let values: ReturnType<typeof parseAiInput>;
    try { values = parseAiInput(input); } catch (error) { if (error instanceof Error && error.message.startsWith('Bitte ')) throw error; throw new Error('Bitte gültige KI-Einstellungen eingeben.'); }
    if (values.apiKey) await setKey(values.baseUrl, values.apiKey);
    const ai = { baseUrl: values.baseUrl, smartModel: values.smartModel, simpleModel: values.simpleModel, smartThinking: values.smartThinking, simpleThinking: values.simpleThinking, historyStart: currentState.ai?.historyStart ?? currentState.chat.length };
    commit({ ...currentState, ai, provider: values.smartModel });
    await saveState(currentState);
  });
  ipcMain.handle('ai:models:list', async event => { verifySender(event); const config = currentState.ai ?? defaultAiConfig; return listModels(config, await getKey(config.baseUrl)); });
  ipcMain.handle('ai:key:clear', async event => { verifySender(event); await deleteKey((currentState.ai ?? defaultAiConfig).baseUrl); });
  ipcMain.handle('workspace:folder', (event, folder: Folder) => { verifySender(event); if (!['Inbox', 'Sent', 'Drafts', 'Archive'].includes(folder)) throw new Error('Invalid folder'); commit({ ...currentState, folder }); });
  ipcMain.handle('workspace:active-draft', (event, id: string) => { verifySender(event); if (!currentState.drafts.some(d => d.id === id)) throw new Error('Draft not found'); commit({ ...currentState, activeDraftId: id }); return openPanel('draft'); });
  ipcMain.handle('chat:session:create', event => { verifySender(event); const result = createSession(currentState); commit(result.state); return result.session.id; });
  ipcMain.handle('chat:session:select', (event, id: unknown) => { verifySender(event); if (typeof id !== 'string') throw new Error('Ungültiger Chat.'); commit(selectSession(currentState, id)); });
  ipcMain.handle('chat:session:rename', (event, id: unknown, title: unknown) => { verifySender(event); if (typeof id !== 'string' || typeof title !== 'string') throw new Error('Ungültiger Titel.'); commit(renameSession(currentState, id, title)); });
  ipcMain.handle('chat:session:fork', (event, id: unknown, replacementText: unknown) => {
    verifySender(event);
    if (chatBusy) throw new Error('Bitte warte, bis die laufende Antwort beendet ist.');
    if (typeof id !== 'string' || (replacementText !== undefined && typeof replacementText !== 'string')) throw new Error('Ungültige Nachricht.');
    const result = forkSession(currentState, id, replacementText);
    commit(result.state);
    return result.result;
  });
  ipcMain.handle('chat:session:reference', async (event, id: unknown) => { verifySender(event); if (typeof id !== 'string') throw new Error('Ungültiger Chat.'); snapshotSessionReference(currentState, id); await openPanel('chat'); panels.get('chat')?.webContents.send('chat:reference-session', id); });
  ipcMain.handle('chat:send', (event, text: unknown, emailRef: unknown, options: unknown) => { verifySender(event); return sendChat(text, emailRef, options); });
  ipcMain.handle('chat:cancel', event => { verifySender(event); activeStream?.controller.abort(); });
  ipcMain.handle('files:list', (event, requested?: string) => { verifySender(event); if (requested !== undefined && typeof requested !== 'string') throw new Error('Invalid path'); return listFiles(requested); });
  ipcMain.handle('files:choose', async event => {
    verifySender(event);
    const owner = BrowserWindow.fromWebContents(event.sender)!;
    const result = await dialog.showOpenDialog(owner, { properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const selected = result.filePaths[0]; const stat = await fs.stat(selected);
    return { path: selected, name: path.basename(selected), size: stat.size } satisfies SelectedFile;
  });
  await openDock();
  for (const kind of currentState.windows.filter(w => !w.minimized).map(w => w.kind)) await openPanel(kind);
});
app.on('before-quit', event => {
  if (readyToQuit || !currentState) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  if (activeStream) { activeStream.controller.abort(); activeStream.flush(); const { sessionId, assistantId } = activeStream; currentState = updateSessionMessages(currentState, sessionId, messages => messages.map(m => m.id === assistantId && m.status === 'streaming' ? { ...m, status: 'cancelled' } : m)); }
  if (saveTimer) clearTimeout(saveTimer);
  void saveState(currentState).catch(error => {
    console.error('Workspace save failed', error);
    dialog.showErrorBox('OpenVibeDesk', 'Der aktuelle Zustand konnte vor dem Beenden nicht gespeichert werden.');
  }).finally(() => { readyToQuit = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());

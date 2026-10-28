import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceApi } from '../shared/model';

const pendingReferences: string[] = [];
let referenceListener: ((id: string) => void) | undefined;
ipcRenderer.on('chat:reference-session', (_event, id: string) => { if (referenceListener) referenceListener(id); else pendingReferences.push(id); });

const api: WorkspaceApi = {
  loadState: () => ipcRenderer.invoke('workspace:load'),
  onStateChanged: callback => { const listener = (_event: Electron.IpcRendererEvent, state: import('../shared/model').WorkspaceState) => callback(state); ipcRenderer.on('workspace:changed', listener); return () => ipcRenderer.removeListener('workspace:changed', listener); },
  dispatchAction: action => ipcRenderer.invoke('workspace:action', action),
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch),
  getAiSettings: () => ipcRenderer.invoke('ai:settings:get'),
  saveAiSettings: input => ipcRenderer.invoke('ai:settings:save', input),
  listAiModels: () => ipcRenderer.invoke('ai:models:list'),
  clearAiKey: () => ipcRenderer.invoke('ai:key:clear'),
  controlWindow: action => ipcRenderer.invoke('window:control', action),
  quit: () => ipcRenderer.invoke('workspace:quit'),
  setFolder: folder => ipcRenderer.invoke('workspace:folder', folder),
  setActiveDraft: id => ipcRenderer.invoke('workspace:active-draft', id),
  createChatSession: () => ipcRenderer.invoke('chat:session:create'),
  selectChatSession: id => ipcRenderer.invoke('chat:session:select', id),
  renameChatSession: (id, title) => ipcRenderer.invoke('chat:session:rename', id, title),
  forkChat: (id, replacementText) => ipcRenderer.invoke('chat:session:fork', id, replacementText),
  referenceChatSession: id => ipcRenderer.invoke('chat:session:reference', id),
  onSessionReference: callback => { referenceListener = callback; for (const id of pendingReferences.splice(0)) callback(id); return () => { if (referenceListener === callback) referenceListener = undefined; }; },
  sendChat: (text, emailRef, options) => ipcRenderer.invoke('chat:send', text, emailRef, options),
  cancelChat: () => ipcRenderer.invoke('chat:cancel'),
  listFiles: path => ipcRenderer.invoke('files:list', path),
  chooseFile: () => ipcRenderer.invoke('files:choose')
};
contextBridge.exposeInMainWorld('workspace', api);

import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceApi } from '../shared/model';

const pendingReferences: string[] = [];
let prepareMcpServer: ((request: import('../shared/mcp').McpPrepareRequest) => void) | undefined;
const pendingMcpPreparations: import('../shared/mcp').McpPrepareRequest[] = [];
ipcRenderer.on('mcp:prepare-server', (_event, request: import('../shared/mcp').McpPrepareRequest) => { if (prepareMcpServer) prepareMcpServer(request); else { pendingMcpPreparations.push(request); if (pendingMcpPreparations.length > 20) pendingMcpPreparations.shift(); } });
const pendingModuleReferences: import('../shared/references').ModuleReferenceSummary[] = [];
let moduleReferenceListener: ((reference: import('../shared/references').ModuleReferenceSummary) => void) | undefined;
ipcRenderer.on('chat:reference-module', (_event, reference: import('../shared/references').ModuleReferenceSummary) => { if (moduleReferenceListener) moduleReferenceListener(reference); else { pendingModuleReferences.push(reference); if (pendingModuleReferences.length > 20) pendingModuleReferences.shift(); } });
let referenceListener: ((id: string) => void) | undefined;
ipcRenderer.on('chat:reference-session', (_event, id: string) => { if (referenceListener) referenceListener(id); else pendingReferences.push(id); });
const pendingForkDrafts: import('../shared/model').ForkChatResult[] = [];
let forkDraftListener: ((draft: import('../shared/model').ForkChatResult) => void) | undefined;
ipcRenderer.on('chat:fork-draft', (_event, draft: import('../shared/model').ForkChatResult) => { if (forkDraftListener) forkDraftListener(draft); else { pendingForkDrafts.push(draft); if (pendingForkDrafts.length > 20) pendingForkDrafts.shift(); } });
let chatModelListener: ((tier: import('../shared/model').ModelTier) => void) | undefined;
let pendingChatModel: import('../shared/model').ModelTier | undefined;
ipcRenderer.on('chat:use-model', (_event, tier: import('../shared/model').ModelTier) => { if (chatModelListener) chatModelListener(tier); else pendingChatModel = tier; });
const pendingChatCommits = new Set<string>();
let chatCommitListener: ((requestId: string) => void) | undefined;
ipcRenderer.on('chat:request-committed', (_event, requestId: string) => { if (chatCommitListener) chatCommitListener(requestId); else pendingChatCommits.add(requestId); });
let showMailSettings: (() => void) | undefined;
let pendingMailSettings = false;
ipcRenderer.on('settings:show-mail', () => { if (showMailSettings) showMailSettings(); else pendingMailSettings = true; });
let navigateSettings: ((request: import('../shared/model').SettingsNavigation) => void) | undefined;
let pendingSettingsNavigation: import('../shared/model').SettingsNavigation | undefined;
ipcRenderer.on('settings:navigate', (_event, request: import('../shared/model').SettingsNavigation) => { if (navigateSettings) navigateSettings(request); else pendingSettingsNavigation = request; });
let prepareSettings: ((request: import('../shared/model').SettingsPreparation) => void) | undefined;
const pendingSettingsPreparations: import('../shared/model').SettingsPreparation[] = [];
ipcRenderer.on('settings:prepare', (_event, request: import('../shared/model').SettingsPreparation) => { if (prepareSettings) prepareSettings(request); else { pendingSettingsPreparations.push(request); if (pendingSettingsPreparations.length > 20) pendingSettingsPreparations.shift(); } });
let showExampleMail: (() => void) | undefined;
let pendingExampleMail = false;
ipcRenderer.on('mail:show-example', () => { if (showExampleMail) showExampleMail(); else pendingExampleMail = true; });
type RealMailTarget = import('../shared/model').MailNavigationTarget;
let showRealMail: ((target: RealMailTarget) => void) | undefined;
let pendingRealMail: RealMailTarget | undefined;
ipcRenderer.on('mail:show-real', (_event, target: RealMailTarget) => { if (showRealMail) showRealMail(target); else pendingRealMail = target; });
let mailFilterListener: ((filter: import('../shared/model').MailViewFilter) => void) | undefined;
let pendingMailFilter: import('../shared/model').MailViewFilter | undefined;
ipcRenderer.on('mail:filter', (_event, filter: import('../shared/model').MailViewFilter) => { if (mailFilterListener) mailFilterListener(filter); else pendingMailFilter = { ...pendingMailFilter, ...filter }; });
type FilesTarget = string | import('../shared/files').FileNavigationTarget | undefined;
let showFiles: ((target: FilesTarget) => void) | undefined;
let pendingFilesTarget: { target: FilesTarget } | undefined;
ipcRenderer.on('files:show-folder', (_event, target: FilesTarget) => { if (showFiles) showFiles(target); else pendingFilesTarget = { target }; });

let showMailSearch: ((results: import('../shared/mail').MailSearchResults) => void) | undefined;
let pendingMailSearch: import('../shared/mail').MailSearchResults | undefined;
ipcRenderer.on('mail:search-results', (_event, results: import('../shared/mail').MailSearchResults) => { if (showMailSearch) showMailSearch(results); else pendingMailSearch = results; });

let showMailQuery: ((event: { result: import('../shared/mail-query').MailQueryResult; request: import('../shared/mail-query').MailQueryRequest }) => void) | undefined;
let pendingMailQuery: { result: import('../shared/mail-query').MailQueryResult; request: import('../shared/mail-query').MailQueryRequest } | undefined;
ipcRenderer.on('mail:query-results', (_event, payload) => { if (showMailQuery) showMailQuery(payload); else pendingMailQuery = payload; });

const api: WorkspaceApi = {
  mcpListServers: () => ipcRenderer.invoke('mcp:servers:list'),
  mcpSaveServer: input => ipcRenderer.invoke('mcp:servers:save', input),
  mcpRemoveServer: id => ipcRenderer.invoke('mcp:servers:remove', id),
  mcpConnectServer: id => ipcRenderer.invoke('mcp:servers:connect', id),
  mcpDisconnectServer: id => ipcRenderer.invoke('mcp:servers:disconnect', id),
  mcpListTools: query => ipcRenderer.invoke('mcp:tools:list', query),
  mcpSetToolPermissions: input => ipcRenderer.invoke('mcp:tools:permissions', input),
  mcpAudit: query => ipcRenderer.invoke('mcp:audit', query),
  mcpCallTool: input => ipcRenderer.invoke('mcp:tools:call', input),
  onMcpChanged: callback => { const listener = () => callback(); ipcRenderer.on('mcp:changed', listener); return () => ipcRenderer.removeListener('mcp:changed', listener); },
  onPrepareMcpServer: callback => { prepareMcpServer = callback; for (const request of pendingMcpPreparations.splice(0)) callback(request); return () => { if (prepareMcpServer === callback) prepareMcpServer = undefined; }; },
  setMcpSettingsStatus: status => ipcRenderer.send('mcp:settings:status', status),
  filesList: request => ipcRenderer.invoke('files:list-page', request),
  filesRead: request => ipcRenderer.invoke('files:read', request),
  filesOpen: request => ipcRenderer.invoke('files:open', request),
  filesChoose: kind => ipcRenderer.invoke('files:choose-entry', kind),
  filesReference: id => ipcRenderer.invoke('files:reference', id),
  getModuleReference: reference => ipcRenderer.invoke('chat:module-reference', reference),
  onModuleReference: callback => { moduleReferenceListener = callback; for (const reference of pendingModuleReferences.splice(0)) callback(reference); return () => { if (moduleReferenceListener === callback) moduleReferenceListener = undefined; }; },
  queryMail: request => ipcRenderer.invoke('mail:query', request),
  countMail: request => ipcRenderer.invoke('mail:count', request),
  onMailQueryResults: callback => { showMailQuery = callback; if (pendingMailQuery) { const event = pendingMailQuery; pendingMailQuery = undefined; callback(event); } return () => { if (showMailQuery === callback) showMailQuery = undefined; }; },
  openExternalLink: url => ipcRenderer.invoke('chat:open-external-link', url),
  openAgentSettings: () => ipcRenderer.invoke('agent:settings:open'),
  getAgentSettings: () => ipcRenderer.invoke('agent:settings:get'),
  saveAgentSettings: input => ipcRenderer.invoke('agent:settings:save', input),
  setAgentSettingsStatus: status => ipcRenderer.send('agent:settings:status', status),
  listModules: () => ipcRenderer.invoke('modules:list'),
  onModulesChanged: callback => { const listener = () => callback(); ipcRenderer.on('modules:changed', listener); return () => ipcRenderer.removeListener('modules:changed', listener); },
  setModuleEnabled: (id, enabled) => ipcRenderer.invoke('modules:set-enabled', id, enabled),
  readModuleView: (moduleId, viewId) => ipcRenderer.invoke('modules:read-view', moduleId, viewId),
  invokeModuleTool: (moduleId, tool, args) => ipcRenderer.invoke('modules:invoke', moduleId, tool, args),
  openModuleView: (moduleId, viewId) => ipcRenderer.invoke('modules:open-view', moduleId, viewId),
  loadState: () => ipcRenderer.invoke('workspace:load'),
  onStateChanged: callback => { const listener = (_event: Electron.IpcRendererEvent, state: import('../shared/model').WorkspaceState) => callback(state); ipcRenderer.on('workspace:changed', listener); return () => ipcRenderer.removeListener('workspace:changed', listener); },
  dispatchAction: action => ipcRenderer.invoke('workspace:action', action),
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch),
  getAiSettings: () => ipcRenderer.invoke('ai:settings:get'),
  saveAiSettings: input => ipcRenderer.invoke('ai:settings:save', input),
  setAiSettingsStatus: status => ipcRenderer.send('ai:settings:status', status),
  setMailSettingsStatus: status => ipcRenderer.send('mail:settings:status', status),
  listSmtpSettings: () => ipcRenderer.invoke('smtp:settings:list'),
  testSmtpSettings: input => ipcRenderer.invoke('smtp:settings:test', input),
  saveSmtpSettings: input => ipcRenderer.invoke('smtp:settings:save', input),
  sendDraft: id => ipcRenderer.invoke('smtp:draft:send', id),
  listMailAccounts: () => ipcRenderer.invoke('mail:accounts:list'),
  onMailAccountsChanged: callback => { const listener = () => callback(); ipcRenderer.on('mail:accounts:changed', listener); return () => ipcRenderer.removeListener('mail:accounts:changed', listener); },
  testMailAccount: input => ipcRenderer.invoke('mail:accounts:test', input),
  saveMailAccount: input => ipcRenderer.invoke('mail:accounts:save', input),
  removeMailAccount: id => ipcRenderer.invoke('mail:accounts:remove', id),
  reportMailView: view => ipcRenderer.send('mail:view-context', view),
  searchMail: request => ipcRenderer.invoke('mail:search', request),
  onMailSearchResults: callback => { showMailSearch = callback; if (pendingMailSearch) { const results = pendingMailSearch; pendingMailSearch = undefined; callback(results); } return () => { if (showMailSearch === callback) showMailSearch = undefined; }; },
  listMailFolders: accountId => ipcRenderer.invoke('mail:folders:list', accountId),
  listMailMessages: (accountId, folder, cursor) => ipcRenderer.invoke('mail:messages:list', accountId, folder, cursor),
  getCachedMail: (accountId, folder, messageId) => ipcRenderer.invoke('mail:message:cached', accountId, folder, messageId),
  onMailMessageChanged: callback => { const listener = (_event: Electron.IpcRendererEvent, message: import('../shared/mail').ImapMessage) => callback(message); ipcRenderer.on('mail:message-changed', listener); return () => ipcRenderer.removeListener('mail:message-changed', listener); },
  loadMailBody: messageId => ipcRenderer.invoke('mail:message:body', messageId),
  createMailDraft: (accountId, messageId) => ipcRenderer.invoke('mail:draft:create', accountId, messageId),
  downloadMailAttachment: (messageId, index) => ipcRenderer.invoke('mail:attachment:download', messageId, index),
  setMailRead: (messageId, read) => ipcRenderer.invoke('mail:message:set-read', messageId, read),
  openMailSettings: () => ipcRenderer.invoke('mail:open-settings'),
  onShowMailSettings: callback => { showMailSettings = callback; if (pendingMailSettings) { pendingMailSettings = false; callback(); } return () => { if (showMailSettings === callback) showMailSettings = undefined; }; },
  onNavigateSettings: callback => { navigateSettings = callback; if (pendingSettingsNavigation) { const request = pendingSettingsNavigation; pendingSettingsNavigation = undefined; callback(request); } return () => { if (navigateSettings === callback) navigateSettings = undefined; }; },
  onPrepareSettings: callback => { prepareSettings = callback; for (const request of pendingSettingsPreparations.splice(0)) callback(request); return () => { if (prepareSettings === callback) prepareSettings = undefined; }; },
  onShowExampleMail: callback => { showExampleMail = callback; if (pendingExampleMail) { pendingExampleMail = false; callback(); } return () => { if (showExampleMail === callback) showExampleMail = undefined; }; },
  onMailViewFilter: callback => { mailFilterListener = callback; if (pendingMailFilter) { const filter = pendingMailFilter; pendingMailFilter = undefined; callback(filter); } return () => { if (mailFilterListener === callback) mailFilterListener = undefined; }; },
  onShowRealMail: callback => { showRealMail = callback; if (pendingRealMail) { const target = pendingRealMail; pendingRealMail = undefined; callback(target); } return () => { if (showRealMail === callback) showRealMail = undefined; }; },
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
  onChatModel: callback => { chatModelListener = callback; if (pendingChatModel) { const tier = pendingChatModel; pendingChatModel = undefined; callback(tier); } return () => { if (chatModelListener === callback) chatModelListener = undefined; }; },
  onForkDraft: callback => { forkDraftListener = callback; for (const draft of pendingForkDrafts.splice(0)) callback(draft); return () => { if (forkDraftListener === callback) forkDraftListener = undefined; }; },
  onChatRequestCommitted: callback => { chatCommitListener = callback; for (const id of pendingChatCommits) callback(id); pendingChatCommits.clear(); return () => { if (chatCommitListener === callback) chatCommitListener = undefined; }; },
  getMailReference: id => ipcRenderer.invoke('chat:mail-reference', id),
  sendChat: (text, emailRef, options) => ipcRenderer.invoke('chat:send', text, emailRef, options),
  cancelChat: () => ipcRenderer.invoke('chat:cancel'),
  onShowFiles: callback => { showFiles = callback; if (pendingFilesTarget) { const { target } = pendingFilesTarget; pendingFilesTarget = undefined; callback(target); } return () => { if (showFiles === callback) showFiles = undefined; }; },
  listFiles: path => ipcRenderer.invoke('files:list', path),
  chooseFile: () => ipcRenderer.invoke('files:choose')
};
contextBridge.exposeInMainWorld('workspace', api);

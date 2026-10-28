export type WindowKind = 'mail' | 'chat' | 'draft' | 'files' | 'settings' | 'sessions';
export interface Settings { textSize: 'standard' | 'large'; dockAlwaysOnTop: boolean; }
export type Thinking = 'off' | 'low' | 'medium' | 'high';
export type ModelTier = 'smart' | 'simple';
export interface ChatOptions { tier: ModelTier; sessionRefId?: string; sessionId?: string; }
export interface AiConfig { baseUrl: string; smartModel: string; simpleModel: string; smartThinking: Thinking; simpleThinking: Thinking; historyStart: number; }
export interface AiSettings { baseUrl: string; smartModel: string; simpleModel: string; smartThinking: Thinking; simpleThinking: Thinking; hasApiKey: boolean; configured: boolean; }
export interface AiSettingsInput { baseUrl: string; smartModel: string; simpleModel: string; smartThinking: Thinking; simpleThinking: Thinking; apiKey?: string; }
export type Folder = 'Inbox' | 'Sent' | 'Drafts' | 'Archive';
export interface WorkspaceWindow { id: string; kind: WindowKind; title: string; x: number; y: number; width: number; height: number; z: number; minimized: boolean; }
export interface Mail { id: string; folder: Folder; threadId: string; from: string; to: string; subject: string; date: string; bodyText: string; bodyHtml?: string; attachments: { name: string; size: number }[]; read: boolean; }
export interface Draft { id: string; replyTo?: string; to: string; subject: string; body: string; attachments: { path: string; name: string; size: number }[]; updatedAt: string; }
export interface SessionReference { id: string; title: string; excerpt: string; }
export interface ForkChatResult { sessionId: string; text: string; emailRef?: string; sessionRefId?: string; }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; emailRef?: string; sessionRef?: SessionReference; timestamp: string; status?: 'streaming' | 'completed' | 'cancelled' | 'failed'; error?: string; }
export interface ChatSession { id: string; title: string; createdAt: string; updatedAt: string; historyStart: number; messages: ChatMessage[]; }
export interface WorkspaceState { version: 1; windows: WorkspaceWindow[]; selectedMailId?: string; folder: Folder; mails: Mail[]; drafts: Draft[]; activeDraftId?: string; chat: ChatMessage[]; sessions: ChatSession[]; activeSessionId: string; provider: string; settings: Settings; ai?: AiConfig; }
export interface FileEntry { name: string; path: string; isDirectory: boolean; size: number; }
export interface FileListing { path: string; entries: FileEntry[]; }
export interface SelectedFile { path: string; name: string; size: number; }
export type WindowControl = 'minimize' | 'toggleMaximize' | 'close';
export interface WorkspaceApi { loadState(): Promise<WorkspaceState | null>; onStateChanged(callback: (state: WorkspaceState) => void): () => void; dispatchAction(action: import('./actions').UiAction): Promise<void>; updateSettings(patch: Partial<Settings>): Promise<void>; getAiSettings(): Promise<AiSettings>; saveAiSettings(input: AiSettingsInput): Promise<void>; listAiModels(): Promise<string[]>; clearAiKey(): Promise<void>; controlWindow(action: WindowControl): Promise<void>; quit(): Promise<void>; setFolder(folder: Folder): Promise<void>; setActiveDraft(id: string): Promise<void>; createChatSession(): Promise<string>; selectChatSession(id: string): Promise<void>; renameChatSession(id: string, title: string): Promise<void>; referenceChatSession(id: string): Promise<void>; forkChat(messageId: string, replacementText?: string): Promise<ForkChatResult>; onSessionReference(callback: (id: string) => void): () => void; sendChat(text: string, emailRef: string | undefined, options: ChatOptions): Promise<void>; cancelChat(): Promise<void>; listFiles(path?: string): Promise<FileListing>; chooseFile(): Promise<SelectedFile | null>; }

import { useEffect, useRef, useState } from 'react';
import { Bot, FilePlus2, Folder, FolderClock, Mail, Power, Settings as SettingsIcon, Monitor, PanelsTopLeft, ShieldCheck } from 'lucide-react';
import { DraftView, FilesView, MailView } from './App';
import { ChatView } from './ChatView';
import { SessionsView } from './SessionsView';
import { WindowChrome } from './WindowChrome';
import { AiSettings } from './AiSettings';
import type { Settings, WorkspaceState } from '../shared/model';
import type { UiAction } from '../shared/actions';

type View = 'dock' | 'mail' | 'chat' | 'draft' | 'files' | 'settings' | 'sessions';
const view = (new URLSearchParams(window.location.search).get('view') ?? 'dock') as View;

export function NativeApp() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>(() => { try { const value: unknown = JSON.parse(localStorage.getItem('openvibedesk.chatDrafts') ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}; } catch { return {}; } });
  const [pendingEmail, setPendingEmail] = useState<string>();
  const [sessionRef, setSessionRef] = useState<string>();
  const [forkContext, setForkContext] = useState<{ sessionId: string; emailRef?: string; sessionRefId?: string }>();
  const [error, setError] = useState('');
  const [chatError, setChatError] = useState('');
  const [sending, setSending] = useState(false);
  const [tier, setTier] = useState<'smart' | 'simple'>('smart');
  const previousSession = useRef<string | undefined>(undefined);
  const sessionId = state?.activeSessionId;
  const prompt = sessionId && typeof chatDrafts[sessionId] === 'string' ? chatDrafts[sessionId] : '';
  const setPrompt = (value: string) => { if (sessionId) setChatDrafts(current => ({ ...current, [sessionId]: value })); };
  useEffect(() => { try { localStorage.setItem('openvibedesk.chatDrafts', JSON.stringify(chatDrafts)); } catch { /* Keep the current in-memory draft if storage is unavailable. */ } }, [chatDrafts]);
  useEffect(() => {
    const unsubscribe = window.workspace.onStateChanged(setState);
    window.workspace.loadState().then(setState).catch(err => setError(String(err)));
    return unsubscribe;
  }, []);
  useEffect(() => view === 'chat' ? window.workspace.onSessionReference(id => setSessionRef(id)) : undefined, []);
  useEffect(() => { const id = state?.activeSessionId; if (previousSession.current && id !== previousSession.current) { setSessionRef(undefined); setPendingEmail(undefined); setChatError(''); } if (id) previousSession.current = id; }, [state?.activeSessionId]);
  useEffect(() => { if (forkContext && state?.activeSessionId === forkContext.sessionId) { setPendingEmail(forkContext.emailRef); setSessionRef(forkContext.sessionRefId); setForkContext(undefined); } }, [forkContext, state?.activeSessionId]);
  async function action(value: UiAction) { try { await window.workspace.dispatchAction(value); setError(''); } catch (err) { setError(String(err)); } }
  async function updateSettings(patch: Partial<Settings>) {
    setState(current => current && ({ ...current, settings: { ...current.settings, ...patch } }));
    try { await window.workspace.updateSettings(patch); setError(''); }
    catch (err) { setError(String(err)); const saved = await window.workspace.loadState(); if (saved) setState(saved); }
  }
  async function sendChat() {
    const text = prompt.trim(); if (!text || sending) return;
    setSending(true); setChatError('');
    const email = pendingEmail, reference = sessionRef;
    setPrompt(''); setPendingEmail(undefined); setSessionRef(undefined);
    try { await window.workspace.sendChat(text, email, { tier, ...(reference ? { sessionRefId: reference } : {}) }); }
    catch (err) { setPrompt(text); setPendingEmail(email); setSessionRef(reference); setChatError(String(err)); }
    finally { setSending(false); }
  }
  async function createChat() { try { await window.workspace.createChatSession(); setSessionRef(undefined); await action({ type: 'open_window', kind: 'chat' }); } catch (err) { setError(String(err)); } }
  async function openChat(id: string) { try { await window.workspace.selectChatSession(id); await action({ type: 'open_window', kind: 'chat' }); } catch (err) { setError(String(err)); } }
  async function forkMessage(id: string, retry: boolean) {
    if (sending) return;
    setSending(true); setChatError('');
    let fork: Awaited<ReturnType<typeof window.workspace.forkChat>> | undefined;
    try {
      fork = await window.workspace.forkChat(id);
      if (retry) await window.workspace.sendChat(fork.text, fork.emailRef, { tier, sessionId: fork.sessionId, ...(fork.sessionRefId ? { sessionRefId: fork.sessionRefId } : {}) });
      else { setChatDrafts(current => ({ ...current, [fork!.sessionId]: fork!.text })); setForkContext(fork); }
    } catch (err) {
      if (fork) { setChatDrafts(current => ({ ...current, [fork!.sessionId]: fork!.text })); setForkContext(fork); }
      setChatError(String(err));
    } finally { setSending(false); }
  }
  if (view === 'dock') return <div className="dock-native"><div className="dock-grip" title="Dock verschieben">⋮⋮</div><button title="Mail" aria-label="Mail" onClick={() => void action({ type: 'open_window', kind: 'mail' })}><Mail /></button><button title="Assistant" aria-label="Assistant" onClick={() => void action({ type: 'open_window', kind: 'chat' })}><Bot /></button><button title="Chats" aria-label="Chats" onClick={() => void action({ type: 'open_window', kind: 'sessions' })}><FolderClock /></button><button title="Files" aria-label="Files" onClick={() => void action({ type: 'open_file_manager' })}><Folder /></button><span className="dock-native-divider" /><button title="New draft" aria-label="New draft" onClick={() => void action({ type: 'create_draft' })}><FilePlus2 /></button><button title="Einstellungen" aria-label="Einstellungen" onClick={() => void action({ type: 'open_window', kind: 'settings' })}><SettingsIcon /></button><button title="App beenden" aria-label="App beenden" onClick={() => void window.workspace.quit()}><Power /></button></div>;
  if (!state) return <div className="native-loading">Loading workspace…</div>;
  const mail = state.mails.find(m => m.id === state.selectedMailId);
  const draft = state.drafts.find(d => d.id === state.activeDraftId);
  return <div className={`native-panel native-${view} ${state.settings.textSize === 'large' ? 'large-text' : ''}`}>
    <WindowChrome title={{ mail: 'Mail', chat: 'Assistant', draft: 'Entwurf', files: 'Dateien', settings: 'Einstellungen', sessions: 'Chats', dock: '' }[view]} />
    <div className="native-view-body">
    {view === 'mail' && <MailView state={state} selected={mail} onFolder={folder => void window.workspace.setFolder(folder).catch(err => setError(String(err)))} onSelect={emailId => void action({ type: 'read_email', emailId })} onOpenDraft={draftId => void window.workspace.setActiveDraft(draftId).catch(err => setError(String(err)))} onReply={() => mail && void action({ type: 'create_draft', replyTo: mail.id })} onNew={() => void action({ type: 'create_draft' })} />}
    {view === 'chat' && <ChatView state={state} prompt={prompt} setPrompt={setPrompt} emailRef={pendingEmail} setEmailRef={setPendingEmail} sessionRef={sessionRef} setSessionRef={setSessionRef} onSend={() => void sendChat()} onStop={() => void window.workspace.cancelChat()} onNew={() => void createChat()} onSessions={() => void action({ type: 'open_window', kind: 'sessions' })} onForkEdit={id => void forkMessage(id, false)} onForkRetry={id => void forkMessage(id, true)} sending={sending || state.sessions.some(s => s.messages.some(m => m.status === 'streaming'))} error={chatError} tier={tier} setTier={setTier} thinking={(tier === 'smart' ? state.ai?.smartThinking : state.ai?.simpleThinking) ?? 'off'} />}
    {view === 'sessions' && <SessionsView state={state} onCreate={() => void createChat()} onOpen={id => void openChat(id)} onRename={(id, title) => void window.workspace.renameChatSession(id, title).catch(err => setError(String(err)))} onReference={id => void window.workspace.referenceChatSession(id).catch(err => setError(String(err)))} />}
    {view === 'draft' && <DraftView draft={draft} onUpdate={patch => draft && void action({ type: 'update_draft', draftId: draft.id, patch })} onAttach={async () => { try { const file = await window.workspace.chooseFile(); if (file && draft) await action({ type: 'attach_file', draftId: draft.id, file }); } catch (err) { setError(String(err)); } }} />}
    {view === 'files' && <FilesView draft={draft} onAttach={file => draft && void action({ type: 'attach_file', draftId: draft.id, file })} />}
    {view === 'settings' && <div className="settings-page"><div className="settings-head"><span className="settings-icon"><SettingsIcon size={21} /></span><div><div className="settings-eyebrow">OPENVIBEDESK</div><h1>Einstellungen</h1><p>Gestalte deinen Arbeitsbereich.</p></div></div><div className="settings-body"><div className="settings-section-label">KI & VERBINDUNG</div><AiSettings /><div className="settings-section-label">DEIN WORKSPACE</div><section className="settings-card"><div className="settings-card-heading"><Monitor size={19} /><div><h2>Darstellung</h2><p>Lesbarkeit in deinen Fenstern</p></div></div><div className="setting-row"><div><label htmlFor="text-size">Textgröße</label><p>Größerer Text für Mail, Chat und Entwürfe.</p></div><select id="text-size" value={state.settings.textSize} onChange={event => void updateSettings({ textSize: event.target.value as 'standard' | 'large' })}><option value="standard">Standard</option><option value="large">Größer</option></select></div></section><section className="settings-card"><div className="settings-card-heading"><PanelsTopLeft size={19} /><div><h2>Dock & Fenster</h2><p>So bleibt dein Workspace erreichbar</p></div></div><div className="setting-row"><div><label htmlFor="dock-top">Dock im Vordergrund</label><p>Das Dock über anderen Fenstern anzeigen.</p></div><input id="dock-top" className="setting-toggle" type="checkbox" checked={state.settings.dockAlwaysOnTop} onChange={event => void updateSettings({ dockAlwaysOnTop: event.target.checked })} /></div></section><div className="settings-note"><ShieldCheck size={17} /><span>Deine Einstellungen werden lokal gespeichert und sofort angewendet.</span></div></div></div>}
    </div>
    {error && <div className="native-error" onClick={() => setError('')}>{error}</div>}
  </div>;
}

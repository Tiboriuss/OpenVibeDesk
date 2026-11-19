import { useEffect, useRef, useState } from 'react';
import { LocaleProvider, uiText, useUiLocale } from './locale';
import { resolveUiLocale } from '../shared/locale';
import { X } from 'lucide-react';
import { OvdBar } from './OvdBar';
import { ChatView } from './ChatView';
import { SessionsView } from './SessionsView';
import { WindowChrome } from './WindowChrome';
import { useWorkspaceSaveFeedback, WorkspaceSaveNotice } from './WorkspaceSaveNotice';
import { SettingsView } from './SettingsView';
import { moduleViews, useWorkspaceModules, workspaceNavigation } from './module-registry';
import type { RendererWorkspaceState } from '../shared/model';
import { MAX_COMPOSER_TEXT } from '../shared/chat-composer';
import { useChatComposer } from './useChatComposer';
import type { UiAction } from '../shared/actions';
import { MAX_MODULE_REFERENCES, moduleReferenceInput, moduleReferenceKey, moduleReferenceSummarySchema, type ModuleReferenceInput } from '../shared/references';
import { useModuleAttention } from './ModuleAttentionDot';

type View = 'dock' | 'mail' | 'chat' | 'draft' | 'files' | 'settings' | 'sessions' | 'module';
const query = new URLSearchParams(window.location.search);
const view = (query.get('view') ?? 'dock') as View;
const moduleId = query.get('moduleId');
const moduleViewId = query.get('viewId');

export function NativeApp() {
  const [state, setState] = useState<RendererWorkspaceState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let receivedUpdate = false;
    const unsubscribe = window.workspace.onStateChanged(value => { receivedUpdate = true; setState(value); });
    window.workspace.loadState().then(value => { if (!receivedUpdate) setState(value); }).catch(err => { if (!receivedUpdate) setError(String(err)); });
    return () => { receivedUpdate = true; unsubscribe(); };
  }, []);
  const locale = state?.locale ?? resolveUiLocale('system', navigator.languages);
  return <LocaleProvider locale={locale}><NativePanel state={state} error={error} setError={setError} /></LocaleProvider>;
}

function NativePanel({ state, error, setError }: { state: RendererWorkspaceState | null; error: string; setError: (value: string) => void }) {
  const locale = useUiLocale();
  const copy = uiText[locale];
  const saveFeedback = useWorkspaceSaveFeedback();
  const moduleState = useWorkspaceModules();
  const moduleAttention = useModuleAttention(view === 'dock');
  const contributedViews = moduleViews(moduleState.modules);
  const contributedView = view === 'module' ? contributedViews.find(item => item.moduleId === moduleId && item.id === moduleViewId) : contributedViews.find(item => item.moduleId === (view === 'files' ? 'ovd-files' : 'ovd-mail') && item.id === view);
  const ModuleComponent = contributedView?.Component;
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const emailRequestVersion = useRef(0);
  const referenceRequests = useRef(new Map<string, symbol>());
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [chatError, setChatError] = useState('');
  const [sending, setSending] = useState(false);
  const [tier, setTier] = useState<'smart' | 'simple'>('smart');
  const previousSession = useRef<string | undefined>(undefined);
  const sessionId = state?.activeSessionId;
  const activeSessionId = useRef(sessionId);
  activeSessionId.current = sessionId;
  const composer = useChatComposer(view === 'chat' ? sessionId : undefined);
  const awaitingAcceptance = useRef<{ id: string; sessionId: string } | undefined>(undefined);
  const [preparingSession, setPreparingSession] = useState<string>();
  const locked = !composer.snapshot || preparingSession === sessionId;
  const pendingEmail = composer.snapshot?.content.emailSummary;
  const pendingReferences = composer.snapshot?.content.references ?? [];
  const sessionRef = composer.snapshot?.content.sessionRefId;
  const prompt = composer.snapshot?.content.text ?? '';
  const editable = (id?: string): id is string => !!id && !!composer.current(id) && awaitingAcceptance.current?.sessionId !== id;
  function setPrompt(text: string) {
    if (!editable(sessionId)) return;
    if (text.length > MAX_COMPOSER_TEXT && text.length >= prompt.length) { setChatError('Der Entwurf ist zu lang. Bitte kürze den Text.'); return; }
    composer.edit(sessionId, { text }, composer.snapshot);
  }
  function setSessionRef(value?: string) {
    if (editable(sessionId)) composer.edit(sessionId, { sessionRefId: value });
  }

  useEffect(() => view === 'chat' ? window.workspace.onChatRequestCommitted(id => {
    if (awaitingAcceptance.current?.id === id) {
      awaitingAcceptance.current = undefined;
      setPreparingSession(undefined);
    }
  }) : undefined, []);
  useEffect(() => view === 'chat' ? window.workspace.onChatModel(tier => setTier(tier)) : undefined, []);
  useEffect(() => {
    if (previousSession.current && previousSession.current !== sessionId) {
      emailRequestVersion.current++; setEmailLoading(false); setEmailError(''); cancelReferenceRequests(); setChatError('');
    }
    previousSession.current = sessionId;
  }, [sessionId]);

  function cancelReferenceRequests() { referenceRequests.current.clear(); setReferencesLoading(false); setReferenceError(''); }
  function removeModuleReference(reference: ModuleReferenceInput) {
    const key = moduleReferenceKey(reference);
    referenceRequests.current.delete(key); setReferencesLoading(referenceRequests.current.size > 0); setReferenceError('');
    const target = activeSessionId.current;
    if (editable(target)) composer.edit(target, { references: (composer.current(target)?.content.references ?? []).filter(item => moduleReferenceKey(item) !== key) });
  }
  async function referenceModuleResource(reference: ModuleReferenceInput) {
    const target = activeSessionId.current;
    if (!editable(target)) return;
    const key = moduleReferenceKey(reference), current = composer.current(target)?.content.references ?? [];
    if (current.some(item => moduleReferenceKey(item) === key) || referenceRequests.current.has(key)) return;
    if (current.length + referenceRequests.current.size >= MAX_MODULE_REFERENCES) { setReferenceError(`Du kannst höchstens ${MAX_MODULE_REFERENCES} Modulreferenzen gleichzeitig hinzufügen.`); return; }
    const token = Symbol(); referenceRequests.current.set(key, token); setReferencesLoading(true); setReferenceError('');
    try {
      const summary = moduleReferenceSummarySchema.parse(await window.workspace.getModuleReference(moduleReferenceInput(reference)));
      if (moduleReferenceKey(summary) !== key) throw new Error('Die Referenz gehört nicht zur ausgewählten Ressource.');
      if (referenceRequests.current.get(key) === token && activeSessionId.current === target && editable(target)) {
        const selected = composer.current(target)?.content.references ?? [];
        if (!selected.some(item => moduleReferenceKey(item) === key)) {
          if (selected.length >= MAX_MODULE_REFERENCES) throw new Error(`Du kannst höchstens ${MAX_MODULE_REFERENCES} Modulreferenzen gleichzeitig hinzufügen.`);
          composer.edit(target, { references: [...selected, summary] });
        }
      }
    } catch (err) {
      if (referenceRequests.current.get(key) === token && activeSessionId.current === target) setReferenceError(err instanceof Error ? err.message : 'Die Referenz konnte nicht geladen werden.');
    } finally {
      if (referenceRequests.current.get(key) === token) { referenceRequests.current.delete(key); setReferencesLoading(referenceRequests.current.size > 0); }
    }
  }
  function removeEmail() {
    emailRequestVersion.current++; setEmailLoading(false); setEmailError('');
    if (editable(sessionId)) composer.edit(sessionId, { emailSummary: undefined });
  }
  async function referenceEmail(id: string) {
    const version = ++emailRequestVersion.current, targetSession = activeSessionId.current;
    if (!editable(targetSession)) return;
    setEmailLoading(true); setEmailError('');
    try {
      const reference = await window.workspace.getMailReference(id);
      if (version === emailRequestVersion.current && activeSessionId.current === targetSession) composer.edit(targetSession, { emailSummary: reference });
    } catch (err) {
      if (version === emailRequestVersion.current && activeSessionId.current === targetSession) setEmailError(err instanceof Error ? err.message : 'Die Mail konnte nicht als Kontext angehängt werden.');
    } finally { if (version === emailRequestVersion.current) setEmailLoading(false); }
  }
  async function action(value: UiAction) { try { await window.workspace.dispatchAction(value); setError(''); } catch (err) { setError(String(err)); } }
  async function sendChat() {
    if (!sessionId || locked || sending || awaitingAcceptance.current || emailLoading || referencesLoading || !prompt.trim() || composer.issue) return;
    if (prompt.trim().length > 20_000) { setChatError('Eine Nachricht darf höchstens 20.000 Zeichen enthalten. Dein Entwurf bleibt erhalten.'); return; }
    const targetSession = sessionId, requestId = crypto.randomUUID();
    awaitingAcceptance.current = { id: requestId, sessionId: targetSession };
    setPreparingSession(targetSession); setSending(true); setChatError('');
    try {
      const { content, revision } = await composer.settle(targetSession);
      // Send only the selection shown at the user's click. The host verifies
      // this revision again after reference resolution, at durable acceptance.
      if (revision !== composer.snapshot?.revision) throw new Error('Der Entwurf wurde inzwischen geändert. Bitte prüfe ihn vor dem Senden.');
      await window.workspace.sendChat(content.text.trim(), content.emailSummary?.id, {
        tier, sessionId: targetSession, clientRequestId: requestId, composerRevision: revision,
        sessionRefId: content.sessionRefId, references: content.references?.map(moduleReferenceInput)
      });
    } catch (err) {
      if (activeSessionId.current === targetSession) setChatError(err instanceof Error ? err.message : String(err));
    } finally {
      awaitingAcceptance.current = undefined; setPreparingSession(undefined); setSending(false);
    }
  }
  async function createChat() { try { await window.workspace.createChatSession(); await action({ type: 'open_window', kind: 'chat' }); } catch (err) { setError(String(err)); } }
  async function openChat(id: string) { try { await window.workspace.selectChatSession(id); await action({ type: 'open_window', kind: 'chat' }); } catch (err) { setError(String(err)); } }
  async function forkMessage(id: string) {
    if (sending) return;
    setSending(true); setChatError('');
    try { await window.workspace.forkChat(id); }
    catch (err) { setChatError(String(err)); }
    finally { setSending(false); }
  }
  async function reformulateMessage(id: string) {
    if (sending || !sessionId) return;
    setSending(true); setChatError('');
    try { await window.workspace.reformulateChat(id, { tier, sessionId }); }
    catch (err) { setChatError(err instanceof Error ? err.message : String(err)); }
    finally { setSending(false); }
  }
  async function continueMessage(id: string) {
    if (sending || !sessionId) return;
    setSending(true); setChatError('');
    try { await window.workspace.continueChat(id, { tier, sessionId }); }
    catch (err) { setChatError(err instanceof Error ? err.message : String(err)); }
    finally { setSending(false); }
  }
  if (view === 'dock') {
    const dockItems = workspaceNavigation(moduleState.modules, state?.settings.navigationOrder, locale);
    return <OvdBar settings={state?.settings} entries={dockItems} attention={moduleAttention} error={error || moduleState.error} saveIssue={saveFeedback.issue?.message} onShowSaveIssue={() => action({ type: 'open_window', kind: 'chat' })} onError={setError} onNavigate={async (item, notices) => {
      const seen = notices.map(notice => notice.id);
      if (item.action) await window.workspace.dispatchAction(item.action);
      else if (item.view) await window.workspace.openModuleView(item.moduleId, item.view);
      if (seen.length) await window.workspace.acknowledgeModuleAttention(item.moduleId, seen);
      setError('');
    }} />;
  }
  if (!state) return <div className="native-loading" role={error ? "alert" : "status"}>{error || copy.loading}</div>;
  const title = contributedView?.title ?? ({ mail: 'Mail', chat: 'Assistant', draft: copy.draft, files: copy.files, settings: copy.settings, sessions: 'Chats', dock: '', module: copy.module }[view] ?? 'OpenVibeDesk');
  return <div className={`native-panel native-${view} ${state.settings.textSize === 'large' ? 'large-text' : ''}`}>
    <WindowChrome title={title} />
    <WorkspaceSaveNotice {...saveFeedback} />
    <div className="native-view-body">
    {ModuleComponent && <ModuleComponent title={contributedView.title} state={state} onAction={action} onError={setError} />}
    {['mail', 'draft', 'files', 'module'].includes(view) && !ModuleComponent && <div className="module-host-status" role="status">{moduleState.loading ? copy.moduleLoading : moduleState.error || copy.moduleUnavailable}</div>}
    {view === 'chat' && composer.unresolved && composer.unresolved !== sessionId && <div className="workspace-save-notice" role="status">
      <span>{copy.unsavedOther}</span>
      <button type="button" onClick={() => void openChat(composer.unresolved!)}>{copy.openDraft}</button>
    </div>}
    {view === 'chat' && <ChatView state={state} prompt={prompt} setPrompt={setPrompt} references={pendingReferences} referencesLoading={referencesLoading} referenceError={referenceError} onModuleReferenceDrop={reference => void referenceModuleResource(reference)} onRemoveModuleReference={removeModuleReference} onCancelModuleReferences={cancelReferenceRequests} emailReference={pendingEmail} emailLoading={emailLoading} emailError={emailError} onEmailDrop={id => void referenceEmail(id)} onRemoveEmail={removeEmail} sessionRef={sessionRef} setSessionRef={setSessionRef} composerLocked={locked} composerIssue={composer.issue} savedComposer={composer.host?.content} onResolveComposer={keep => { if (sessionId) void composer.resolve(sessionId, keep); }} onSend={() => void sendChat()} onStop={() => void window.workspace.cancelChat()} onAgentSettings={() => void window.workspace.openAgentSettings().catch(reason => setError(String(reason)))} onNew={() => void createChat()} onSessions={() => void action({ type: 'open_window', kind: 'sessions' })} onForkEdit={id => void forkMessage(id)} onReformulate={id => void reformulateMessage(id)} onContinue={id => void continueMessage(id)} sending={sending || !!state.presentation?.streamingSessionId} error={chatError} tier={tier} setTier={setTier} thinking={(tier === 'smart' ? state.ai?.smartThinking : state.ai?.simpleThinking) ?? 'off'} />}
    {view === 'sessions' && <SessionsView state={state} onCreate={() => void createChat()} onOpen={id => void openChat(id)} onRename={(id, title) => window.workspace.renameChatSession(id, title)} onReference={id => void window.workspace.referenceChatSession(id).catch(err => setError(String(err)))} />}
    {view === 'settings' && <SettingsView settings={state.settings} onUpdate={patch => window.workspace.updateSettings(patch)} />}
    </div>
    {error && <div className="native-error" role="alert"><span>{error}</span><button type="button" aria-label={copy.dismissError} title={copy.close} onClick={() => setError('')}><X size={15}/></button></div>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import { Power } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { ChatView } from './ChatView';
import { SessionsView } from './SessionsView';
import { WindowChrome } from './WindowChrome';
import { SettingsView } from './SettingsView';
import { moduleIcon, moduleViews, useWorkspaceModules, workspaceNavigation } from './module-registry';
import type { EmailReferenceSummary, ForkChatResult, Settings, WorkspaceState } from '../shared/model';
import type { UiAction } from '../shared/actions';
import { MAX_MODULE_REFERENCES, moduleReferenceInput, moduleReferenceKey, moduleReferenceSummary, moduleReferenceSummarySchema, type ModuleReferenceInput, type ModuleReferenceSummary } from '../shared/references';

type View = 'dock' | 'mail' | 'chat' | 'draft' | 'files' | 'settings' | 'sessions' | 'module';
const query = new URLSearchParams(window.location.search);
const view = (query.get('view') ?? 'dock') as View;
const moduleId = query.get('moduleId');
const moduleViewId = query.get('viewId');

type InFlightDraft = { clientRequestId: string; sessionId: string; text: string; emailSummary?: EmailReferenceSummary; sessionRefId?: string; references?: ModuleReferenceSummary[] };
function referenceSummaries(value: unknown): ModuleReferenceSummary[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, MAX_MODULE_REFERENCES).flatMap(item => { const parsed = moduleReferenceSummarySchema.safeParse(item); if (!parsed.success || seen.has(moduleReferenceKey(parsed.data))) return []; seen.add(moduleReferenceKey(parsed.data)); return [parsed.data]; });
}
function mergeReferences(first: ModuleReferenceSummary[], second: ModuleReferenceSummary[]): ModuleReferenceSummary[] {
  const merged = new Map<string, ModuleReferenceSummary>();
  for (const item of [...first, ...second]) if (!merged.has(moduleReferenceKey(item))) merged.set(moduleReferenceKey(item), item);
  return [...merged.values()].slice(0, MAX_MODULE_REFERENCES);
}
function loadReferenceDrafts(): Record<string, ModuleReferenceSummary[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('openvibedesk.referenceDrafts') ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(-100).map(([id, references]) => [id, referenceSummaries(references)]));
  } catch { return {}; }
}
function mailSummary(value: EmailReferenceSummary): EmailReferenceSummary {
  return { id: value.id, subject: value.subject.slice(0, 1000), from: value.from.slice(0, 500), ...(value.accountName ? { accountName: value.accountName.slice(0, 200) } : {}) };
}
function loadInFlightDrafts(): Record<string, InFlightDraft> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem('openvibedesk.inFlightDrafts') ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).slice(-100).flatMap(([id, value]) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      if (item.clientRequestId !== id || typeof item.sessionId !== 'string' || typeof item.text !== 'string' || item.text.length > 20000) return [];
      const email = item.emailSummary as EmailReferenceSummary | undefined;
      const validEmail = email && typeof email.id === 'string' && typeof email.subject === 'string' && typeof email.from === 'string';
      return [[id, { clientRequestId: id, sessionId: item.sessionId, text: item.text, ...(validEmail ? { emailSummary: mailSummary(email) } : {}), ...(typeof item.sessionRefId === 'string' ? { sessionRefId: item.sessionRefId } : {}), references: referenceSummaries(item.references) }]];
    }));
  } catch { return {}; }
}

function loadMailDrafts(): Record<string, EmailReferenceSummary> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('openvibedesk.mailDrafts') ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).slice(-100).flatMap(([sessionId, raw]) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      if (typeof item.id !== 'string' || !item.id || item.id.length > 128 || typeof item.subject !== 'string' || typeof item.from !== 'string') return [];
      return [[sessionId, { id: item.id, subject: item.subject.slice(0, 1000), from: item.from.slice(0, 500), ...(typeof item.accountName === 'string' ? { accountName: item.accountName.slice(0, 200) } : {}) }]];
    }));
  } catch { return {}; }
}


export function NativeApp() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const moduleState = useWorkspaceModules();
  const contributedViews = moduleViews(moduleState.modules);
  const contributedView = view === 'module' ? contributedViews.find(item => item.moduleId === moduleId && item.id === moduleViewId) : contributedViews.find(item => item.moduleId === (view === 'files' ? 'ovd-files' : 'ovd-mail') && item.id === view);
  const ModuleComponent = contributedView?.Component;
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>(() => { try { const value: unknown = JSON.parse(localStorage.getItem('openvibedesk.chatDrafts') ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, string> : {}; } catch { return {}; } });
  const [mailDrafts, setMailDrafts] = useState<Record<string, EmailReferenceSummary>>(loadMailDrafts);
  const [referenceDrafts, setReferenceDrafts] = useState<Record<string, ModuleReferenceSummary[]>>(loadReferenceDrafts);
  const chatDraftsRef = useRef(chatDrafts), mailDraftsRef = useRef(mailDrafts), referenceDraftsRef = useRef(referenceDrafts);
  chatDraftsRef.current = chatDrafts; mailDraftsRef.current = mailDrafts; referenceDraftsRef.current = referenceDrafts;
  const inFlightDrafts = useRef<Record<string, InFlightDraft>>(loadInFlightDrafts());
  const restoredInFlightDrafts = useRef(new Map<string, InFlightDraft>());
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const emailRequestVersion = useRef(0);
  const referenceRequests = useRef(new Map<string, symbol>());
  const queuedReferenceInputs = useRef<ModuleReferenceInput[]>([]);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [sessionRef, setSessionRef] = useState<string>();
  const [forkContext, setForkContext] = useState<ForkChatResult>();
  const [error, setError] = useState('');
  const [chatError, setChatError] = useState('');
  const [sending, setSending] = useState(false);
  const [tier, setTier] = useState<'smart' | 'simple'>('smart');
  const previousSession = useRef<string | undefined>(undefined);
  const sessionId = state?.activeSessionId;
  const activeSessionId = useRef(sessionId);
  activeSessionId.current = sessionId;
  const pendingEmail = sessionId ? mailDrafts[sessionId] : undefined;
  const pendingReferences = sessionId ? referenceDrafts[sessionId] ?? [] : [];
  const prompt = sessionId && typeof chatDrafts[sessionId] === 'string' ? chatDrafts[sessionId] : '';
  const setPrompt = (value: string) => { if (sessionId) setChatDrafts(current => ({ ...current, [sessionId]: value })); };
  useEffect(() => { try { localStorage.setItem('openvibedesk.chatDrafts', JSON.stringify(chatDrafts)); } catch { /* Keep the current in-memory draft if storage is unavailable. */ } }, [chatDrafts]);
  useEffect(() => { try { localStorage.setItem('openvibedesk.mailDrafts', JSON.stringify(mailDrafts)); } catch { /* Keep the reference metadata in memory when storage is unavailable. */ } }, [mailDrafts]);
  useEffect(() => { try { localStorage.setItem('openvibedesk.referenceDrafts', JSON.stringify(referenceDrafts)); } catch { /* Keep reference selections in memory. */ } }, [referenceDrafts]);
  useEffect(() => {
    const unsubscribe = window.workspace.onStateChanged(setState);
    window.workspace.loadState().then(value => {
      if (view === 'chat' && value) {
        const committed = new Set(value.sessions.flatMap(session => session.messages.map(message => message.clientRequestId).filter(Boolean)));
        for (const draft of Object.values(inFlightDrafts.current)) {
          if (committed.has(draft.clientRequestId)) clearInFlightDraft(draft.clientRequestId);
          else restoreInFlightDraft(draft);
        }
      }
      setState(value);
    }).catch(err => setError(String(err)));
    return unsubscribe;
  }, []);
  useEffect(() => view === 'chat' ? window.workspace.onChatRequestCommitted(acknowledgeInFlightDraft) : undefined, []);
  useEffect(() => view === 'chat' ? window.workspace.onSessionReference(id => setSessionRef(id)) : undefined, []);
  useEffect(() => view === 'chat' ? window.workspace.onModuleReference(reference => { void referenceModuleResource(moduleReferenceInput(reference)); }) : undefined, []);
  useEffect(() => view === 'chat' ? window.workspace.onChatModel(tier => setTier(tier)) : undefined, []);
  useEffect(() => view === 'chat' ? window.workspace.onForkDraft(result => {
    setChatDrafts(current => ({ ...current, [result.sessionId]: result.text }));
    setForkContext(result);
  }) : undefined, []);
  useEffect(() => { const id = state?.activeSessionId; if (previousSession.current && id !== previousSession.current) { setSessionRef(undefined); emailRequestVersion.current++; setEmailLoading(false); setEmailError(''); cancelReferenceRequests(); setChatError(''); } if (id) { previousSession.current = id; const queued = queuedReferenceInputs.current; queuedReferenceInputs.current = []; for (const reference of queued) void referenceModuleResource(reference); } }, [state?.activeSessionId]);
  useEffect(() => {
    if (!forkContext || state?.activeSessionId !== forkContext.sessionId) return;
    removeEmail();
    if (forkContext.emailReference) setPendingEmail(forkContext.emailReference);
    else if (forkContext.emailRef) void referenceEmail(forkContext.emailRef);
    setPendingReferences((forkContext.references ?? []).map(moduleReferenceSummary), forkContext.sessionId);
    setSessionRef(forkContext.sessionRefId); setForkContext(undefined);
  }, [forkContext, state?.activeSessionId]);
  function setPendingEmail(value: EmailReferenceSummary | undefined, targetSession = activeSessionId.current) {
    if (!targetSession) return;
    setMailDrafts(current => { const next = { ...current }; if (value) next[targetSession] = mailSummary(value); else delete next[targetSession]; return next; });
  }
  function setPendingReferences(references: ModuleReferenceSummary[], targetSession = activeSessionId.current) {
    if (!targetSession) return;
    const next = { ...referenceDraftsRef.current };
    if (references.length) next[targetSession] = references; else delete next[targetSession];
    referenceDraftsRef.current = next; setReferenceDrafts(next);
  }
  function cancelReferenceRequests() { referenceRequests.current.clear(); setReferencesLoading(false); setReferenceError(''); }
  function removeModuleReference(reference: ModuleReferenceInput) {
    const key = moduleReferenceKey(reference);
    referenceRequests.current.delete(key); setReferencesLoading(referenceRequests.current.size > 0); setReferenceError('');
    const target = activeSessionId.current;
    if (target) setPendingReferences((referenceDraftsRef.current[target] ?? []).filter(item => moduleReferenceKey(item) !== key), target);
  }
  async function referenceModuleResource(reference: ModuleReferenceInput) {
    const target = activeSessionId.current;
    if (!target) { queuedReferenceInputs.current = [...queuedReferenceInputs.current, reference].slice(-MAX_MODULE_REFERENCES); return; }
    const key = moduleReferenceKey(reference), current = referenceDraftsRef.current[target] ?? [];
    if (current.some(item => moduleReferenceKey(item) === key) || referenceRequests.current.has(key)) return;
    if (current.length + referenceRequests.current.size >= MAX_MODULE_REFERENCES) { setReferenceError(`Du kannst höchstens ${MAX_MODULE_REFERENCES} Modulreferenzen gleichzeitig hinzufügen.`); return; }
    const token = Symbol(); referenceRequests.current.set(key, token); setReferencesLoading(true); setReferenceError('');
    try {
      const summary = moduleReferenceSummarySchema.parse(await window.workspace.getModuleReference(moduleReferenceInput(reference)));
      if (moduleReferenceKey(summary) !== key) throw new Error('Die Referenz gehört nicht zur ausgewählten Ressource.');
      if (referenceRequests.current.get(key) === token && activeSessionId.current === target) setPendingReferences(mergeReferences(referenceDraftsRef.current[target] ?? [], [summary]), target);
    } catch (err) {
      if (referenceRequests.current.get(key) === token && activeSessionId.current === target) setReferenceError(err instanceof Error ? err.message : 'Die Referenz konnte nicht geladen werden.');
    } finally {
      if (referenceRequests.current.get(key) === token) { referenceRequests.current.delete(key); setReferencesLoading(referenceRequests.current.size > 0); }
    }
  }
  function saveInFlightDraft(draft: InFlightDraft) {
    const next = { ...inFlightDrafts.current, [draft.clientRequestId]: draft };
    localStorage.setItem('openvibedesk.inFlightDrafts', JSON.stringify(next));
    inFlightDrafts.current = next;
  }
  function clearInFlightDraft(id: string) {
    if (!inFlightDrafts.current[id]) return;
    const next = { ...inFlightDrafts.current }; delete next[id];
    try { localStorage.setItem('openvibedesk.inFlightDrafts', JSON.stringify(next)); inFlightDrafts.current = next; } catch { /* Reconcile with saved request IDs on the next start. */ }
  }
  function acknowledgeInFlightDraft(id: string) {
    const restored = restoredInFlightDrafts.current.get(id);
    restoredInFlightDrafts.current.delete(id);
    if (restored) {
      const existing = chatDraftsRef.current[restored.sessionId] ?? '';
      const remainder = existing === restored.text ? '' : existing.startsWith(restored.text + '\n\n') ? existing.slice(restored.text.length + 2) : undefined;
      if (remainder !== undefined) {
        const texts = { ...chatDraftsRef.current, [restored.sessionId]: remainder };
        const mails = { ...mailDraftsRef.current };
        const references = { ...referenceDraftsRef.current };
        const restoredKeys = new Set((restored.references ?? []).map(moduleReferenceKey));
        references[restored.sessionId] = (references[restored.sessionId] ?? []).filter(reference => !restoredKeys.has(moduleReferenceKey(reference)));
        if (mails[restored.sessionId]?.id === restored.emailSummary?.id) delete mails[restored.sessionId];
        chatDraftsRef.current = texts; mailDraftsRef.current = mails; referenceDraftsRef.current = references;
        setChatDrafts(texts); setMailDrafts(mails); setReferenceDrafts(references);
        try {
          localStorage.setItem('openvibedesk.chatDrafts', JSON.stringify(texts));
          localStorage.setItem('openvibedesk.mailDrafts', JSON.stringify(mails));
          localStorage.setItem('openvibedesk.referenceDrafts', JSON.stringify(references));
        } catch { /* The committed message remains available in the chat. */ }
      }
    }
    clearInFlightDraft(id);
  }
  function restoreInFlightDraft(draft: InFlightDraft) {
    restoredInFlightDrafts.current.set(draft.clientRequestId, draft);
    const existing = chatDraftsRef.current[draft.sessionId] ?? '';
    const text = existing === draft.text || existing.startsWith(draft.text + '\n\n') ? existing : existing.trim() ? `${draft.text}\n\n${existing}` : draft.text;
    const texts = { ...chatDraftsRef.current, [draft.sessionId]: text };
    const mails = { ...mailDraftsRef.current };
    const references = { ...referenceDraftsRef.current, [draft.sessionId]: mergeReferences(draft.references ?? [], referenceDraftsRef.current[draft.sessionId] ?? []) };
    if (draft.emailSummary && !mails[draft.sessionId]) mails[draft.sessionId] = mailSummary(draft.emailSummary);
    chatDraftsRef.current = texts; mailDraftsRef.current = mails; referenceDraftsRef.current = references;
    setChatDrafts(texts); setMailDrafts(mails); setReferenceDrafts(references);
    try {
      localStorage.setItem('openvibedesk.chatDrafts', JSON.stringify(texts));
      localStorage.setItem('openvibedesk.mailDrafts', JSON.stringify(mails));
      localStorage.setItem('openvibedesk.referenceDrafts', JSON.stringify(references));
      clearInFlightDraft(draft.clientRequestId);
    } catch { /* Keep the recovery entry until the draft can be saved. */ }
  }
  function removeEmail() { emailRequestVersion.current++; setPendingEmail(undefined); setEmailLoading(false); setEmailError(''); }
  async function referenceEmail(id: string) {
    const version = ++emailRequestVersion.current, targetSession = activeSessionId.current;
    setEmailLoading(true); setEmailError('');
    try {
      const reference = await window.workspace.getMailReference(id);
      if (version === emailRequestVersion.current && activeSessionId.current === targetSession) setPendingEmail(reference);
    } catch (err) {
      if (version === emailRequestVersion.current && activeSessionId.current === targetSession) setEmailError(err instanceof Error ? err.message : 'Die Mail konnte nicht als Kontext angehängt werden.');
    } finally { if (version === emailRequestVersion.current) setEmailLoading(false); }
  }
  async function action(value: UiAction) { try { await window.workspace.dispatchAction(value); setError(''); } catch (err) { setError(String(err)); } }
  async function updateSettings(patch: Partial<Settings>) {
    setState(current => current && ({ ...current, settings: { ...current.settings, ...patch } }));
    try { await window.workspace.updateSettings(patch); setError(''); }
    catch (err) { setError(String(err)); const saved = await window.workspace.loadState(); if (saved) setState(saved); }
  }
  async function sendChat() {
    const text = prompt.trim(), targetSession = sessionId; if (!text || sending || emailLoading || referencesLoading || !targetSession) return;
    const email = pendingEmail, reference = sessionRef;
    const references = pendingReferences;
    const draft: InFlightDraft = { clientRequestId: crypto.randomUUID(), sessionId: targetSession, text, ...(email ? { emailSummary: mailSummary(email) } : {}), ...(reference ? { sessionRefId: reference } : {}), ...(references.length ? { references } : {}) };
    try { saveInFlightDraft(draft); }
    catch { setChatError('Die Nachricht konnte vor dem Senden nicht lokal gesichert werden. Dein Entwurf bleibt erhalten.'); return; }
    setSending(true); setChatError('');
    setPrompt(''); removeEmail(); setSessionRef(undefined); cancelReferenceRequests(); setPendingReferences([], targetSession);
    try { await window.workspace.sendChat(text, email?.id, { tier, sessionId: targetSession, clientRequestId: draft.clientRequestId, ...(reference ? { sessionRefId: reference } : {}), ...(references.length ? { references: references.map(moduleReferenceInput) } : {}) }); clearInFlightDraft(draft.clientRequestId); }
    catch (err) {
      restoreInFlightDraft(draft);
      if (activeSessionId.current === targetSession) { setSessionRef(reference); setChatError(err instanceof Error ? err.message : String(err)); }
    } finally { setSending(false); }
  }
  async function createChat() { try { await window.workspace.createChatSession(); setSessionRef(undefined); await action({ type: 'open_window', kind: 'chat' }); } catch (err) { setError(String(err)); } }
  async function openChat(id: string) { try { await window.workspace.selectChatSession(id); await action({ type: 'open_window', kind: 'chat' }); } catch (err) { setError(String(err)); } }
  async function forkMessage(id: string, retry: boolean) {
    if (sending) return;
    setSending(true); setChatError('');
    let fork: Awaited<ReturnType<typeof window.workspace.forkChat>> | undefined;
    try {
      fork = await window.workspace.forkChat(id);
      if (retry) await window.workspace.sendChat(fork.text, fork.emailRef, { tier, sessionId: fork.sessionId, ...(fork.sessionRefId ? { sessionRefId: fork.sessionRefId } : {}), ...(fork.references?.length ? { references: fork.references.map(moduleReferenceInput) } : {}) });
      else { setChatDrafts(current => ({ ...current, [fork!.sessionId]: fork!.text })); setForkContext(fork); }
    } catch (err) {
      if (fork) { setChatDrafts(current => ({ ...current, [fork!.sessionId]: fork!.text })); setForkContext(fork); }
      setChatError(String(err));
    } finally { setSending(false); }
  }
  if (view === 'dock') {
    const dockItems = workspaceNavigation(moduleState.modules, state?.settings.navigationOrder);
    return <div className="dock-native"><div className="dock-grip" title="Dock verschieben">⋮⋮</div>{dockItems.map(item => {
      const Icon = moduleIcon(item.icon);
      return <button key={item.id} title={item.title} aria-label={item.title} onClick={() => { if (item.action) void action(item.action); else if (item.view) void window.workspace.openModuleView(item.moduleId, item.view).catch(reason => setError(String(reason))); }}>{item.id === 'assistant' ? <BrandMark inverse size={30} /> : <Icon />}</button>;
    })}<span className="dock-native-divider" /><button title="App beenden" aria-label="App beenden" onClick={() => void window.workspace.quit()}><Power /></button>{(error || moduleState.error) && <span className="dock-module-error" role="alert" title={error || moduleState.error}>!</span>}</div>;
  }
  if (!state) return <div className="native-loading">Loading workspace…</div>;
  const title = contributedView?.title ?? ({ mail: 'Mail', chat: 'Assistant', draft: 'Entwurf', files: 'Dateien', settings: 'Einstellungen', sessions: 'Chats', dock: '', module: 'Modul' }[view] ?? 'OpenVibeDesk');
  return <div className={`native-panel native-${view} ${state.settings.textSize === 'large' ? 'large-text' : ''}`}>
    <WindowChrome title={title} />
    <div className="native-view-body">
    {ModuleComponent && <ModuleComponent state={state} onAction={action} onError={setError} />}
    {['mail', 'draft', 'files', 'module'].includes(view) && !ModuleComponent && <div className="module-host-status" role="status">{moduleState.loading ? 'Modul wird geladen …' : moduleState.error || 'Dieses Modul ist nicht verfügbar. Prüfe seinen Status in den Einstellungen unter Module.'}</div>}
    {view === 'chat' && <ChatView state={state} prompt={prompt} setPrompt={setPrompt} references={pendingReferences} referencesLoading={referencesLoading} referenceError={referenceError} onModuleReferenceDrop={reference => void referenceModuleResource(reference)} onRemoveModuleReference={removeModuleReference} onCancelModuleReferences={cancelReferenceRequests} emailReference={pendingEmail} emailLoading={emailLoading} emailError={emailError} onEmailDrop={id => void referenceEmail(id)} onRemoveEmail={removeEmail} sessionRef={sessionRef} setSessionRef={setSessionRef} onSend={() => void sendChat()} onStop={() => void window.workspace.cancelChat()} onAgentSettings={() => void window.workspace.openAgentSettings().catch(reason => setError(String(reason)))} onNew={() => void createChat()} onSessions={() => void action({ type: 'open_window', kind: 'sessions' })} onForkEdit={id => void forkMessage(id, false)} onForkRetry={id => void forkMessage(id, true)} sending={sending || state.sessions.some(s => s.messages.some(m => m.status === 'streaming'))} error={chatError} tier={tier} setTier={setTier} thinking={(tier === 'smart' ? state.ai?.smartThinking : state.ai?.simpleThinking) ?? 'off'} />}
    {view === 'sessions' && <SessionsView state={state} onCreate={() => void createChat()} onOpen={id => void openChat(id)} onRename={(id, title) => void window.workspace.renameChatSession(id, title).catch(err => setError(String(err)))} onReference={id => void window.workspace.referenceChatSession(id).catch(err => setError(String(err)))} />}
    {view === 'settings' && <SettingsView settings={state.settings} onUpdate={patch => void updateSettings(patch)} />}
    </div>
    {error && <div className="native-error" onClick={() => setError('')}>{error}</div>}
  </div>;
}

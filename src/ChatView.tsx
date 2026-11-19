import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Bot, BookOpen, Brain, Check, ChevronRight, CircleAlert, CircleHelp, Copy, FolderClock, Link2, Mail, Pencil, Play, Plus, RefreshCw, Square, X } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';
import { SpeechInput, SpeechPreview, type SpeechPreviewState } from './SpeechInput';
import type { ChatMessage, EmailReferenceSummary, RendererWorkspaceState } from '../shared/model';
import type { OperationRunSummary } from '../shared/operations';
import type { ChatGptStatus } from '../shared/chatgpt';
import { deriveMemoryPresentation, normalizeMemoryRecallSnapshot, type MemoryRecallSnapshot } from '../shared/module-memory';
import { SESSION_DRAG_PREFIX, SESSION_DRAG_TYPE } from './SessionsView';
import { MAIL_DRAG_TYPE, readMailDrag } from './mail-reference';
import { MODULE_REFERENCE_DRAG_TYPE, moduleReferenceKey, readModuleReferenceDrag, type ModuleReferenceInput, type ModuleReferenceSummary } from '../shared/references';
import { messagePresentation, composerRecoveryText } from './chat-locale';
import { assistantText } from './assistant-copy';
import { useUiLocale } from './locale';
import './modern-chat.css';

type Tier = 'smart' | 'simple';
type Thinking = 'off' | 'low' | 'medium' | 'high';
const toolLabelKeys = {
  find_modules: 'findModules', get_module_tools: 'loadTools', read_tool_result: 'readResult', search_emails: 'searchEmails',
  read_email: 'readEmail', open_email: 'openEmail', create_reply_draft: 'replyDraft',
  get_workspace_capabilities: 'checkWorkspace', execute_workspace_action: 'controlWorkspace'
} as const;

function activityLabel(event: NonNullable<ChatMessage['toolEvents']>[number], labels: typeof assistantText.en) {
  const key = Object.hasOwn(toolLabelKeys, event.name) ? toolLabelKeys[event.name as keyof typeof toolLabelKeys] : undefined;
  return key ? labels[key] : event.label || labels.action;
}

function toolDetail(value?: string): string {
  const detail = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer […]').replace(/\b(api[-_ ]?key|password|passwort|secret|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[…]').replace(/\s+/g, ' ').trim();
  return detail.length > 240 ? `${detail.slice(0, 237)}…` : detail;
}
function ToolActivity({ events, children }: { events: NonNullable<ChatMessage['toolEvents']>; children?: ReactNode }) {
  const locale = useUiLocale();
  const labels = assistantText[locale];
  const failed = events.filter(event => event.status === 'failed').length;
  const cancelled = events.filter(event => event.status === 'cancelled').length;
  const uncertain = events.filter(event => event.status === 'uncertain').length;
  const label = events.length === 1 ? activityLabel(events[0], labels) : `${events.length.toLocaleString(locale)} ${labels.actions}`;
  const summary = [failed ? `${failed.toLocaleString(locale)} ${labels.failed}` : '', uncertain ? `${uncertain.toLocaleString(locale)} ${labels.unclear}` : '', cancelled ? `${cancelled.toLocaleString(locale)} ${labels.cancelled}` : ''].filter(Boolean).join(' · ') || labels.done;
  const statusLabel = { completed: labels.done, failed: labels.failed, cancelled: labels.cancelled, uncertain: labels.uncertainOutcome };
  return <details className={`tool-events${failed ? ' has-failures' : ''}${uncertain ? ' has-uncertain' : ''}${cancelled ? ' has-cancelled' : ''}`}>
    <summary><ChevronRight size={13} aria-hidden="true"/>{failed ? <CircleAlert size={13} aria-hidden="true"/> : uncertain ? <CircleHelp size={13} aria-hidden="true"/> : cancelled ? <Square size={12} aria-hidden="true"/> : <Check size={13} aria-hidden="true"/>}<span>{label}</span><small>{summary}</small></summary>
    <div className="tool-event-list" aria-label={labels.actions}>{events.map((event, index) => {
      const detail = event.status !== 'completed' ? toolDetail(event.detail) : '';
      return <div key={index} className={event.status}>{event.status === 'failed' ? <CircleAlert size={12} aria-hidden="true"/> : event.status === 'uncertain' ? <CircleHelp size={12} aria-hidden="true"/> : event.status === 'cancelled' ? <Square size={11} aria-hidden="true"/> : <Check size={12} aria-hidden="true"/>}<span className="tool-event-description"><span>{activityLabel(event, labels)}</span>{detail && <span className="tool-event-detail">{detail}</span>}</span><small>{statusLabel[event.status]}</small></div>;
    })}</div>
    {children}
  </details>;
}

function MemoryContext({ snapshot: rawSnapshot }: { snapshot: MemoryRecallSnapshot }) {
  const locale = useUiLocale();
  const labels = assistantText[locale];
  const [linkError, setLinkError] = useState('');
  const snapshot = normalizeMemoryRecallSnapshot(rawSnapshot);
  if (!snapshot) return null;
  const { visible, providers, memories, truncated } = deriveMemoryPresentation(snapshot);
  if (!visible) return null;
  const failures = providers.filter(provider => provider.status === 'failed').length;
  const summary = [memories.length ? `${memories.length.toLocaleString(locale)} ${memories.length === 1 ? labels.memoryOne : labels.memoryMany}` : !failures && !truncated ? labels.noMemories : '', failures ? `${failures.toLocaleString(locale)} ${failures === 1 ? labels.lookupFailedOne : labels.lookupFailedMany}` : '', truncated ? labels.limited : ''].filter(Boolean).join(' · ');
  async function openSource(uri: string) {
    setLinkError('');
    try { await window.workspace.openExternalLink(uri); }
    catch { setLinkError(labels.sourceFailed); }
  }
  return <details className={`tool-events memory-context${failures ? ' has-failures' : ''}`}>
    <summary><ChevronRight size={13} aria-hidden="true"/><Brain size={13} aria-hidden="true"/><span>{labels.memory}</span><small>{summary}</small></summary>
    <div className="memory-context-content">
      <p className="memory-context-note">{labels.snapshot} · {new Date(snapshot.retrievedAt).toLocaleString(locale)}</p>
      {providers.map(provider => <div className="memory-provider" key={provider.moduleId}><strong>{provider.title}</strong><span>{provider.status === 'failed' ? provider.detail || labels.retrievalFailed : `${provider.count.toLocaleString(locale)} ${labels.included}${provider.status === 'truncated' ? ' · ' + labels.limitedSelection : ''}`}</span></div>)}
      {memories.map(memory => <div className="memory-entry" key={`${memory.moduleId}:${memory.id}`}>
        <div className="memory-source"><strong>{memory.moduleTitle}</strong>{memory.source.uri ? <a href={memory.source.uri} title={memory.source.uri} target="_blank" rel="noopener noreferrer" onClick={event => { event.preventDefault(); void openSource(memory.source.uri!); }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); void openSource(memory.source.uri!); } }}>{memory.source.title}</a> : <span>{memory.source.title}</span>}</div>
        <p>{memory.text}</p>
        {memory.source.reference && <small>{labels.reference}: {memory.moduleId} · {memory.source.reference.type} · {memory.source.reference.id}</small>}
        {memory.updatedAt && <small>{labels.updated}: {new Date(memory.updatedAt).toLocaleString(locale)}</small>}
        {memory.expiresAt && <small>{labels.validUntil}: {new Date(memory.expiresAt).toLocaleString(locale)}</small>}
      </div>)}
      {truncated && <p className="memory-context-note">{labels.memoryLimit}</p>}
      {linkError && <p className="memory-context-error" role="alert">{linkError}</p>}
    </div>
  </details>;
}

function AgentLimitNotice({ limit, onOpen }: { limit?: ChatMessage['agentRunLimit']; onOpen(): void }) {
  const locale = useUiLocale();
  const labels = assistantText[locale];
  const number = (n: number) => n.toLocaleString(locale);
  const explanation = limit?.reason === 'context_budget' ? labels.contextLimitHelp : limit?.reason === 'tool_rounds' ? `${number(limit.limit)} ${limit.limit === 1 ? labels.round : labels.rounds}` : limit?.reason === 'tool_calls' ? `${number(limit.limit)} ${limit.limit === 1 ? labels.call : labels.calls}` : limit?.reason === 'timeout' ? `${number(limit.limit)} s` : labels.defaultLimit;
  const next = limit?.nextToolType === 'discovery' ? labels.discoveryPending : limit?.nextToolType === 'action' ? labels.actionPending : limit?.nextToolType === 'mixed' ? labels.mixedPending : '';
  return <div className="message-limit-status" role="status"><strong><CircleAlert size={14} aria-hidden="true"/>{limit?.reason === 'context_budget' ? labels.contextLimit : labels.agentLimit}</strong><p>{explanation}{next ? ` ${next}` : ''}</p>{limit?.context && <small>{limit.context.estimatedInputTokens.toLocaleString(locale)} {labels.estimatedInput} · {labels.budget} {limit.context.inputTokenBudget.toLocaleString(locale)} · {labels.outputReserve} {limit.context.outputTokenReserve.toLocaleString(locale)}</small>}{limit && limit.toolCalls > 0 && <small>{number(limit.toolRounds)} {limit.toolRounds === 1 ? labels.round : labels.rounds} · {number(limit.toolCalls)} {limit.toolCalls === 1 ? labels.call : labels.calls} · {number(limit.discoveryCalls)} {labels.discovery} · {number(limit.actionCalls)} {labels.actionCalls} · {number(Math.max(0, Math.round(limit.elapsedMs / 1000)))} s</small>}<button type="button" onClick={onOpen}>{labels.agentSettings}</button></div>;
}

function OperationStatus({ message, sessionId, sending }: { message: ChatMessage; sessionId: string; sending: boolean }) {
  const locale = useUiLocale();
  const labels = assistantText[locale];
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<OperationRunSummary | null>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true); setError('');
    void window.workspace.getChatRun(message.id, sessionId).then(value => { if (current) setSummary(value); }, reason => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, message.id, message.operationRunId, message.status, message.toolEvents?.length, sessionId, revision]);
  async function reconcile(actionId: string) {
    if (checking || sending) return;
    setChecking(actionId); setError('');
    try { await window.workspace.reconcileChatAction(actionId); setRevision(value => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setChecking(undefined); }
  }
  const actions = summary?.actions ?? [];
  const uncertain = actions.filter(action => action.status === 'uncertain' || action.effect === 'unknown').length;
  const failed = actions.filter(action => action.status === 'failed').length;
  const completed = actions.filter(action => action.status === 'completed').length;
  const stateLabel = uncertain ? `${uncertain.toLocaleString(locale)} ${labels.unclear}` : failed ? `${failed.toLocaleString(locale)} ${labels.failed}` : actions.length && completed === actions.length ? labels.done : actions.length ? labels.pending : '';
  const statusLabels = { prepared: labels.prepared, running: labels.running, completed: labels.done, failed: labels.failed, cancelled: labels.cancelled, uncertain: labels.uncertainOutcome };
  const effectLabels = { none: labels.noEffect, applied: labels.applied, unknown: labels.unknownEffect };
  return <details className="tool-events operation-journal" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={13} aria-hidden="true"/><span>{labels.taskStatus}</span>{summary && <small>{actions.length.toLocaleString(locale)} {actions.length === 1 ? labels.step : labels.steps}{stateLabel ? ` · ${stateLabel}` : ''}</small>}</summary>
    {open && <div className="operation-journal-content" aria-busy={loading || !!checking}>
      {loading && <small role="status">{labels.loadingTask}</small>}
      {!loading && summary === null && <p>{labels.noJournal}</p>}
      {!loading && summary && !actions.length && <p>{labels.noActionsLogged}</p>}
      {summary && actions.map(action => <div key={action.id} className={`operation-action ${action.status}`}>
        <div className="operation-action-heading"><span>{toolDetail(action.label) || labels.action}</span><small>{statusLabels[action.status]}</small></div>
        <small className={action.effect === 'unknown' ? 'operation-effect-unknown' : ''}>{effectLabels[action.effect]}</small>
        {action.detail && <small className="operation-action-detail">{toolDetail(action.detail)}</small>}
        {(action.status === 'uncertain' || action.effect === 'unknown') && <button type="button" disabled={sending || loading || !!checking} onClick={() => void reconcile(action.id)} title={labels.checkStatusHint} aria-label={`${labels.checkStatus}: ${toolDetail(action.label) || labels.action}`}>{checking === action.id ? labels.checking : labels.checkStatus}</button>}
      </div>)}
      {uncertain > 0 && <p className="operation-journal-note">{labels.uncertainHelp}</p>}
      {error && <p className="operation-journal-error" role="alert">{error}</p>}
      <button type="button" className="operation-journal-refresh" disabled={loading || !!checking} onClick={() => setRevision(value => value + 1)}>{labels.refresh}</button>
    </div>}
  </details>;
}

function canContinue(message: ChatMessage): boolean {
  return !!message.operationRunId && !message.reformulationOf && message.status !== 'streaming' && (message.status === 'cancelled' || message.status === 'failed' || message.status === 'limited' || message.evidence?.status === 'cancelled' || message.evidence?.status === 'failed' || message.evidence?.status === 'limited' || !!message.toolEvents?.some(event => event.status === 'uncertain'));
}

function hasOperationDetails(message: ChatMessage): boolean {
  return !!message.operationRunId && !message.reformulationOf && (canContinue(message) || message.evidence?.toolsUsed === true || !!message.toolEvents?.some(event => !['find_modules', 'get_module_tools'].includes(event.name)));
}

export function ChatView({ state, prompt, setPrompt, emailReference, emailLoading, emailError, onEmailDrop, onRemoveEmail, references, referencesLoading, referenceError, onModuleReferenceDrop, onRemoveModuleReference, onCancelModuleReferences, sessionRef, setSessionRef, composerLocked, composerIssue, savedComposer, onResolveComposer, sending, error, tier, setTier, thinking, onSend, onStop, onNew, onSessions, onForkEdit, onReformulate, onContinue, onAgentSettings }: {
  state: RendererWorkspaceState; prompt: string; setPrompt(value: string): void; emailReference?: EmailReferenceSummary; emailLoading: boolean; emailError?: string; onEmailDrop(id: string): void; onRemoveEmail(): void;
  references: ModuleReferenceSummary[]; referencesLoading: boolean; referenceError?: string; onModuleReferenceDrop(reference: ModuleReferenceInput): void; onRemoveModuleReference(reference: ModuleReferenceInput): void; onCancelModuleReferences(): void;
  composerLocked: boolean; composerIssue?: 'load' | 'write' | 'conflict' | 'legacy'; savedComposer?: import('../shared/chat-composer').ChatComposerContent; onResolveComposer(keep: boolean): void;
  sessionRef?: string; setSessionRef(value?: string): void; sending: boolean; error?: string; tier: Tier; setTier(value: Tier): void; thinking: Thinking;
  onSend(): void; onStop(): void; onNew(): void; onSessions(): void; onForkEdit(messageId: string): void; onReformulate(messageId: string): void; onContinue(messageId: string): void; onAgentSettings(): void;
}) {
  const locale = useUiLocale();
  const recovery = composerRecoveryText[locale];
  const labels = assistantText[locale];
  const list = useRef<HTMLDivElement>(null), thread = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), stick = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [copied, setCopied] = useState<string>();
  const [copyError, setCopyError] = useState('');
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [chatGptStatus, setChatGptStatus] = useState<ChatGptStatus | null>(null);
  const [usageError, setUsageError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [speechBusy, setSpeechBusy] = useState(false);
  const [speechPreview, setSpeechPreview] = useState<SpeechPreviewState>({ status: 'idle', mode: 'live', text: '', elapsed: 0 });
  const speechAnchor = useRef<{ position: number; text: string } | undefined>(undefined);
  const currentPrompt = useRef(prompt); currentPrompt.current = prompt;
  // Keep the dictation insertion point beside the user's edits, without
  // replacing a selection or allowing partial transcripts to rewrite the draft.
  function adjustSpeechAnchor(next: string) {
    const anchor = speechAnchor.current;
    if (!anchor || anchor.text === next) return;
    const previous = anchor.text;
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
    let oldEnd = previous.length, newEnd = next.length;
    while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
    if (anchor.position >= start) anchor.position = anchor.position > oldEnd ? anchor.position + next.length - previous.length : newEnd;
    anchor.text = next;
  }
  function startDictation() { speechAnchor.current = { position: input.current?.selectionStart ?? currentPrompt.current.length, text: currentPrompt.current }; }
  function insertDictation(text: string) {
    const draft = currentPrompt.current;
    adjustSpeechAnchor(draft);
    const position = Math.min(draft.length, speechAnchor.current?.position ?? input.current?.selectionStart ?? draft.length);
    const before = draft.slice(0, position), after = draft.slice(position);
    const insertion = `${before && !/\s$/.test(before) ? ' ' : ''}${text}${after && !/^\s/.test(after) ? ' ' : ''}`;
    const next = `${before}${insertion}${after}`;
    speechAnchor.current = undefined;
    currentPrompt.current = next; setPrompt(next);
    requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.setSelectionRange(position + insertion.length, position + insertion.length); });
  }
  const historyAnchor = useRef<{ sessionId: string; start: number; top: number; height: number } | undefined>(undefined);
  async function loadEarlier() {
    if (historyLoading || !list.current) return;
    historyAnchor.current = { sessionId: state.activeSessionId, start: state.presentation?.chatStart ?? 0, top: list.current.scrollTop, height: list.current.scrollHeight };
    stick.current = false; setHistoryLoading(true); setHistoryError('');
    try { await window.workspace.loadEarlierChat(); }
    catch (reason) { historyAnchor.current = undefined; setHistoryError(String(reason)); }
    finally { setHistoryLoading(false); }
  }
  useEffect(() => {
    if (state.ai?.provider !== 'chatgpt') { setChatGptStatus(null); return; }
    let current = true;
    void window.workspace.getChatGptStatus().then(status => { if (current) setChatGptStatus(status); }).catch(() => {});
    const stop = window.workspace.onChatGptStatus(status => { if (current) setChatGptStatus(status); });
    return () => { current = false; stop(); };
  }, [state.ai?.provider]);
  async function manageChatGptUsage() {
    setUsageError('');
    try { await window.workspace.openChatGptUsage(); }
    catch { setUsageError(labels.usageFailed); }
  }
  const dragDepth = useRef(0);
  const active = state.sessions.find(session => session.id === state.activeSessionId);
  const linked = state.sessions.find(session => session.id === sessionRef && session.id !== state.activeSessionId);
  const mail = emailReference;
  const messages = state.chat.filter((message, index) => message.id !== 'welcome' && index + (state.presentation?.chatStart ?? 0) >= (active?.historyStart ?? 0));
  const model = tier === 'smart' ? state.ai?.smartModel : state.ai?.simpleModel;
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : (locale === 'de' ? 'Strg+' : 'Ctrl+');

  function scrollToLatest() {
    stick.current = true; setAwayFromBottom(false);
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }
  function resizeInput() {
    const element = input.current;
    if (!element) return;
    const maximum = Math.min(160, Math.max(96, window.innerHeight * .3));
    element.style.height = 'auto';
    const height = Math.min(element.scrollHeight, maximum);
    element.style.height = `${Math.max(32, height)}px`;
    element.style.overflowY = element.scrollHeight > height ? 'auto' : 'hidden';
  }
  useLayoutEffect(resizeInput, [prompt, state.activeSessionId, state.settings.textSize]);
  useEffect(() => {
    const element = input.current;
    let width = element?.clientWidth;
    const observer = new ResizeObserver(() => { if (element && element.clientWidth !== width) { width = element.clientWidth; resizeInput(); } });
    if (element) observer.observe(element);
    window.addEventListener('resize', resizeInput);
    return () => { observer.disconnect(); window.removeEventListener('resize', resizeInput); };
  }, []);
  useLayoutEffect(() => {
    const anchor = historyAnchor.current;
    if (anchor && anchor.sessionId === state.activeSessionId && (state.presentation?.chatStart ?? 0) < anchor.start && list.current) {
      list.current.scrollTop = anchor.top + list.current.scrollHeight - anchor.height;
      historyAnchor.current = undefined;
    } else if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [state.chat, sending]);
  useLayoutEffect(() => { historyAnchor.current = undefined; setHistoryError(''); scrollToLatest(); dragDepth.current = 0; setDragging(false); setCopied(undefined); setCopyError(''); input.current?.focus({ preventScroll: true }); }, [state.activeSessionId]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      const element = list.current;
      if (!element) return;
      if (stick.current) element.scrollTop = element.scrollHeight;
      const near = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
      if (near) stick.current = true;
      setAwayFromBottom(!near);
    });
    if (list.current) observer.observe(list.current);
    if (thread.current) observer.observe(thread.current);
    return () => { observer.disconnect(); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const command = (event.ctrlKey || event.metaKey) && !event.altKey;
      if (command && event.key.toLowerCase() === 'n') { event.preventDefault(); if (!event.repeat) onNew(); }
      else if (command && event.key.toLowerCase() === 'l') { event.preventDefault(); input.current?.focus(); }
      else if (command && event.key.toLowerCase() === 'f') { event.preventDefault(); onSessions(); }
      else if (event.key === 'Escape' && dragDepth.current > 0) { dragDepth.current = 0; setDragging(false); }
      else if (event.key === 'Escape' && sending) { event.preventDefault(); onStop(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [onNew, onSessions, onStop, sending]);

  const isReferenceDrag = (data: DataTransfer) => [MAIL_DRAG_TYPE, SESSION_DRAG_TYPE, MODULE_REFERENCE_DRAG_TYPE].some(type => data.types.includes(type));
  // Native drag stores can hide text until drop. Keep the legacy prefix fallback
  // eligible without advertising every ordinary text drag as a reference.
  const acceptsDrop = (data: DataTransfer) => isReferenceDrag(data) || data.types.includes('text/plain');
  function drop(event: React.DragEvent) {
    dragDepth.current = 0; setDragging(false);
    if (composerLocked) { event.preventDefault(); return; }
    const text = event.dataTransfer.getData('text/plain');
    const id = event.dataTransfer.getData(SESSION_DRAG_TYPE) || (text.startsWith(SESSION_DRAG_PREFIX) ? text.slice(SESSION_DRAG_PREFIX.length) : '');
    if (id && state.sessions.some(session => session.id === id && session.id !== state.activeSessionId)) { event.preventDefault(); setSessionRef(id); input.current?.focus(); return; }
    const moduleReference = readModuleReferenceDrag(event.dataTransfer);
    if (moduleReference) { event.preventDefault(); onModuleReferenceDrop(moduleReference); input.current?.focus(); return; }
    const mailId = readMailDrag(event.dataTransfer);
    if (mailId) { event.preventDefault(); onEmailDrop(mailId); input.current?.focus(); }
  }
  async function copy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value); setCopied(id); setCopyError('');
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(undefined), 1800);
    } catch { setCopyError(labels.copyFailed); }
  }
  function hasPreviousUser(id: string): boolean { const index = state.chat.findIndex(message => message.id === id); return index >= 0 && (!!state.presentation?.chatHasEarlierUser || state.chat.slice(Math.max(0, (active?.historyStart ?? 0) - (state.presentation?.chatStart ?? 0)), index).some(message => message.role === 'user')); }
  function send() { if (!composerLocked && !composerIssue && !sending && !speechBusy && !emailLoading && !referencesLoading && prompt.trim()) { scrollToLatest(); onSend(); } }

  return <div className={`modern-chat${dragging ? ' is-dragging' : ''}`} onDragEnter={event => { if (!composerLocked && isReferenceDrag(event.dataTransfer)) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDragOver={event => { if (!composerLocked && acceptsDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={drop}>
    <div className="modern-chat-head"><div className="assistant-avatar"><Bot size={17}/></div><div className="modern-chat-title"><strong title={active?.title}>{active?.title ?? labels.newChat}</strong><small title={model}>{model || labels.modelSetup}</small></div><button type="button" title={`${labels.newChat} (${shortcut}N)`} aria-label={labels.newChat} onClick={onNew}><Plus size={18}/></button><button type="button" title={`${labels.manageChats} (${shortcut}F)`} aria-label={labels.manageChats} onClick={onSessions}><FolderClock size={18}/></button></div>
    <div className="sr-only" aria-live="polite">{state.chat.at(-1)?.status === 'completed' ? labels.completedReply : state.chat.at(-1)?.status === 'failed' ? labels.interruptedReply : state.chat.at(-1)?.status === 'cancelled' ? labels.stoppedReply : state.chat.at(-1)?.status === 'limited' ? labels.limitReached : ''}{copied ? ' ' + labels.textCopied : ''}</div>
    <div className="message-log-area">
      <div ref={list} className="modern-messages" role="log" aria-label={labels.history} aria-live="off" onScroll={event => { const element = event.currentTarget; const near = element.scrollHeight - element.scrollTop - element.clientHeight < 64; stick.current = near; setAwayFromBottom(!near); }}>
        <div ref={thread} className="message-thread">
          {(state.presentation?.chatStart ?? 0) > (active?.historyStart ?? 0) && <button type="button" className="chat-load-earlier" aria-disabled={historyLoading} onClick={() => void loadEarlier()}>{historyLoading ? labels.loading : labels.loadEarlier}</button>}
          {historyError && <p className="chat-error" role="alert">{historyError}</p>}
          {messages.map((message, index) => <article key={message.id} className={`modern-message ${message.role}${index === messages.length - 1 ? ' is-latest' : ''}`} {...messagePresentation(locale, message)} aria-busy={message.status === 'streaming'}>
          {message.role === 'assistant' && <div className="message-avatar" aria-hidden="true"><Bot size={15}/></div>}
          <div className="message-content">
            <div className="modern-message-body">
              {message.emailRef && <span className="message-ref" title={message.emailReference?.subject}><Mail size={12} aria-hidden="true"/><span>{message.emailReference?.subject || state.mails.find(mail => mail.id === message.emailRef)?.subject || labels.referencedEmail}</span></span>}
              {message.sessionRef && <span className="message-ref" title={message.sessionRef.title}><Link2 size={12} aria-hidden="true"/><span>{message.sessionRef.title}</span></span>}
              {message.references?.map(reference => <span key={moduleReferenceKey(reference)} className="message-ref" title={reference.description || reference.title}>{reference.usage === 'instructions' ? <BookOpen size={12} aria-hidden="true"/> : <Link2 size={12} aria-hidden="true"/>}<span>{reference.usage === 'instructions' ? labels.instruction + ': ' : ''}{reference.title}</span></span>)}
              {message.role === 'assistant' && message.memory && <MemoryContext snapshot={message.memory}/>}
              {!!message.toolEvents?.length && <ToolActivity events={message.toolEvents}>{hasOperationDetails(message) && <OperationStatus message={message} sessionId={state.activeSessionId} sending={sending}/>}</ToolActivity>}
              {!message.toolEvents?.length && hasOperationDetails(message) && <OperationStatus message={message} sessionId={state.activeSessionId} sending={sending}/>}
              {message.reformulationOf && <small className="message-status" title={labels.reformulationHint}>{message.status === 'completed' ? labels.reformulated : labels.reformulation} · {labels.noActions}</small>}
              {message.continuationOf && <small className="message-status" title={labels.continuationHint}>{labels.continuedTask}</small>}
              <ChatMarkdown text={message.text} messageId={message.id} copied={copied} onCopy={copy}/>
              {message.status === 'streaming' && <small className="message-status streaming" role="status"><span aria-hidden="true"/>{message.reformulationOf ? labels.rephrasing : labels.responding}</small>}
              {message.status === 'cancelled' && <small className="message-status">{labels.stopped}</small>}
              {message.status === 'failed' && <small className="message-status failed">{message.error || labels.interrupted}</small>}
              {state.ai?.provider === 'chatgpt' && message.error?.includes('subscription_sharing_usage_limit_exceeded') && <button type="button" className="chatgpt-usage-action" onClick={() => void manageChatGptUsage()}>{labels.manageUsage}</button>}
              {message.error && message.status !== 'failed' && message.status !== 'streaming' && <small className="message-status failed" role="status">{message.error}</small>}
              {message.status === 'limited' && <AgentLimitNotice limit={message.agentRunLimit} onOpen={onAgentSettings}/>}
            </div>
            {message.role === 'user' && <div className="message-actions" role="group" aria-label={labels.messageActions}><button type="button" title={labels.copyMessage} aria-label={labels.copyMessage} onClick={() => void copy(message.id, message.text)}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button><button type="button" title={labels.editNewHint} aria-label={labels.editNew} disabled={sending} onClick={() => onForkEdit(message.id)}><Pencil size={14}/></button></div>}
            {message.role === 'assistant' && message.status !== 'streaming' && (message.text || hasPreviousUser(message.id)) && <div className="message-actions" role="group" aria-label={labels.answerActions}>{message.text && <button type="button" title={labels.copyAnswer} aria-label={labels.copyAnswer} onClick={() => void copy(message.id, message.text)}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button>}{hasPreviousUser(message.id) && <button type="button" title={message.evidence ? labels.rephraseHint : labels.missingEvidence} aria-label={labels.rephrase} disabled={sending} onClick={() => onReformulate(message.id)}><RefreshCw size={14}/></button>}{canContinue(message) && <button type="button" title={labels.continueHint} aria-label={labels.continueTask} disabled={sending} onClick={() => onContinue(message.id)}><Play size={14}/></button>}</div>}
          </div>
        </article>)}
        {!messages.length && <div className="chat-empty"><div className="chat-empty-icon"><Bot size={22}/></div><strong>{labels.greeting}</strong></div>}</div>
      </div>
      {awayFromBottom && <button type="button" className="jump-to-latest" onClick={scrollToLatest} title={labels.jumpLatest} aria-label={labels.jumpLatest}><ArrowDown size={14} aria-hidden="true"/>{labels.latest}</button>}
    </div>
    <div className="modern-composer-area">
      {(mail || linked || references.length > 0) && <div className="context-list">{mail && <span className="context-chip" title={[mail.from, mail.accountName].filter(Boolean).join(' · ')}><Mail size={14}/><span>{mail.subject || labels.noSubject}</span><button type="button" disabled={composerLocked} aria-label={labels.removeEmail} onClick={onRemoveEmail}><X size={13}/></button></span>}{linked && <span className="context-chip"><Link2 size={14}/><span>{linked.title}</span><button type="button" disabled={composerLocked} aria-label={labels.removeChat} onClick={() => setSessionRef(undefined)}><X size={13}/></button></span>}{references.map(reference => <span key={moduleReferenceKey(reference)} className="context-chip" title={reference.description || reference.title}>{reference.usage === 'instructions' ? <BookOpen size={14} aria-hidden="true"/> : <Link2 size={14} aria-hidden="true"/>}<span>{reference.usage === 'instructions' ? labels.instruction + ': ' : ''}{reference.title}</span><button type="button" disabled={composerLocked} aria-label={`${labels.removeReference}: ${reference.title}`} onClick={() => onRemoveModuleReference(reference)}><X size={13}/></button></span>)}</div>}
      {dragging && <div className="reference-drop-target" role="status"><Link2 size={16} aria-hidden="true"/>{labels.dropReference}</div>}
      {emailLoading && <div className="chat-notice" role="status">{labels.loadingEmail} <button type="button" onClick={onRemoveEmail}>{labels.cancel}</button></div>}
      {emailError && <div className="chat-error" role="alert">{emailError}</div>}
      {referencesLoading && <div className="chat-notice" role="status">{labels.loadingRefs} <button type="button" onClick={onCancelModuleReferences}>{labels.cancel}</button></div>}
      {referenceError && <div className="chat-error" role="alert">{referenceError}</div>}
      {sending && state.presentation?.streamingSessionId !== state.activeSessionId && <div className="chat-notice">{!!state.presentation?.streamingSessionId ? labels.otherResponse : labels.preparing}</div>}
      {composerIssue && <div className="chat-error composer-recovery">
        <span role="alert">{recovery[composerIssue]}</span>
        {(composerIssue === 'conflict' || composerIssue === 'legacy') && savedComposer && <details>
          <summary>{recovery.view}</summary>
          <pre>{savedComposer.text || recovery.noText}</pre>
          {[savedComposer.emailSummary?.subject, state.sessions.find(item => item.id === savedComposer.sessionRefId)?.title, ...(savedComposer.references ?? []).map(item => item.title)].filter(Boolean).join(' · ')}
        </details>}
        <div><button type="button" onClick={() => onResolveComposer(true)}>{composerIssue === 'load' ? recovery.reload : composerIssue === 'write' ? recovery.retrySave : recovery.keepInput}</button>
        {composerIssue !== 'load' && <button type="button" onClick={() => onResolveComposer(false)}>{recovery.useSaved}</button>}</div>
      </div>}
      {(error || copyError || usageError) && <div className="chat-error" role="alert">{error || copyError || usageError}</div>}
      {state.ai?.provider === 'chatgpt' && chatGptStatus?.authenticated && chatGptStatus.planAccess && <div className="chatgpt-plan-status"><span>{labels.planUse}</span><button type="button" onClick={() => void manageChatGptUsage()}>{labels.manageUsage}</button></div>}
      <div className="modern-composer">
        <SpeechPreview value={speechPreview}/>
        <textarea ref={input} readOnly={composerLocked} rows={1} aria-label={labels.message} aria-describedby="composer-help" value={prompt} onChange={event => { adjustSpeechAnchor(event.target.value); setPrompt(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} placeholder={labels.placeholder}/>
        <div className="composer-actions"><label className="tier-select"><span className="sr-only">{labels.chooseModel}</span><select aria-label={labels.chooseModel} value={tier} disabled={sending} onChange={event => setTier(event.target.value as Tier)}><option value="smart">{labels.smart}{state.ai?.smartModel ? '' : ' · ' + labels.unconfigured}</option><option value="simple">{labels.simple}{state.ai?.simpleModel ? '' : ' · ' + labels.unconfigured}</option></select></label><span className="thinking-label" title={`${labels.reasoning}: ${labels[thinking]}`}><Brain size={13} aria-hidden="true"/><span>{labels.reasoning}: {labels[thinking]}</span></span>{state.ai?.confirmationMode === 'never' && <span className="confirmation-mode-badge" title={labels.neverHint}>{labels.never}</span>}<span className="composer-buttons"><SpeechInput key={`${state.activeSessionId}:${state.ai?.provider ?? ""}`} scope={`${state.activeSessionId}:${state.ai?.provider ?? ""}`} disabled={sending || composerLocked} onStart={startDictation} onTranscript={insertDictation} onBusyChange={setSpeechBusy} onPreview={setSpeechPreview}/><button type="button" className="chat-icon-button" disabled={composerLocked} title={labels.referenceChat} aria-label={labels.referenceChat} onClick={onSessions}><Link2 size={17}/></button>{sending ? <button type="button" className="send-button" title={labels.stopKey} aria-label={labels.stop} onClick={onStop}><Square size={14} fill="currentColor"/></button> : <button type="button" className="send-button" title={labels.sendKey} aria-label={labels.send} disabled={composerLocked || !!composerIssue || speechBusy || emailLoading || referencesLoading || !prompt.trim()} onClick={send}><ArrowUp size={17}/></button>}</span></div>
      </div>
      <p id="composer-help" className="sr-only">{labels.composerHelp}</p>
    </div>
  </div>;
}

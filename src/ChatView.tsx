import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bot, BookOpen, Check, ChevronRight, CircleAlert, CircleHelp, Copy, FolderClock, Link2, Mail, Pencil, Play, Plus, RefreshCw, Square, X } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';
import type { ChatMessage, EmailReferenceSummary, WorkspaceState } from '../shared/model';
import type { OperationRunSummary } from '../shared/operations';
import { SESSION_DRAG_PREFIX, SESSION_DRAG_TYPE } from './SessionsView';
import { MAIL_DRAG_TYPE, readMailDrag } from './mail-reference';
import { MODULE_REFERENCE_DRAG_TYPE, moduleReferenceKey, readModuleReferenceDrag, type ModuleReferenceInput, type ModuleReferenceSummary } from '../shared/references';
import './modern-chat.css';

type Tier = 'smart' | 'simple';
type Thinking = 'off' | 'low' | 'medium' | 'high';
const legacyToolLabels: Record<string, string> = { search_emails: 'E-Mails durchsuchen', read_email: 'E-Mail-Inhalt abrufen', open_email: 'E-Mail öffnen', create_reply_draft: 'Antwortentwurf vorbereiten', get_workspace_capabilities: 'Workspace-Funktionen prüfen', execute_workspace_action: 'Workspace steuern' };

function toolDetail(value?: string): string {
  const detail = (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [entfernt]').replace(/\b(api[-_ ]?key|password|passwort|secret|token|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[entfernt]').replace(/\s+/g, ' ').trim();
  return detail.length > 240 ? `${detail.slice(0, 237)}…` : detail;
}
function ToolActivity({ events }: { events: NonNullable<ChatMessage['toolEvents']> }) {
  const failed = events.filter(event => event.status === 'failed').length;
  const cancelled = events.filter(event => event.status === 'cancelled').length;
  const uncertain = events.filter(event => event.status === 'uncertain').length;
  const label = events.length === 1 ? events[0].label ?? legacyToolLabels[events[0].name] ?? 'Workspace-Aktion' : `${events.length} Workspace-Aktionen`;
  const summary = [failed ? `${failed} fehlgeschlagen` : '', uncertain ? `${uncertain} unklar` : '', cancelled ? `${cancelled} abgebrochen` : ''].filter(Boolean).join(' · ') || 'erledigt';
  const statusLabel = { completed: 'erledigt', failed: 'fehlgeschlagen', cancelled: 'abgebrochen', uncertain: 'Ausgang unklar' };
  return <details className={`tool-events${failed ? ' has-failures' : ''}${uncertain ? ' has-uncertain' : ''}${cancelled ? ' has-cancelled' : ''}`}>
    <summary><ChevronRight size={13} aria-hidden="true"/>{failed ? <CircleAlert size={13} aria-hidden="true"/> : uncertain ? <CircleHelp size={13} aria-hidden="true"/> : cancelled ? <Square size={12} aria-hidden="true"/> : <Check size={13} aria-hidden="true"/>}<span>{label}</span><small>{summary}</small></summary>
    <div className="tool-event-list" aria-label="Workspace-Aktionen">{events.map((event, index) => {
      const detail = event.status !== 'completed' ? toolDetail(event.detail) : '';
      return <div key={index} className={event.status}>{event.status === 'failed' ? <CircleAlert size={12} aria-hidden="true"/> : event.status === 'uncertain' ? <CircleHelp size={12} aria-hidden="true"/> : event.status === 'cancelled' ? <Square size={11} aria-hidden="true"/> : <Check size={12} aria-hidden="true"/>}<span className="tool-event-description"><span>{event.label ?? legacyToolLabels[event.name] ?? 'Workspace-Aktion'}</span>{detail && <span className="tool-event-detail">{detail}</span>}</span><small>{statusLabel[event.status]}</small></div>;
    })}</div>
  </details>;
}

function AgentLimitNotice({ limit, onOpen }: { limit?: ChatMessage['agentRunLimit']; onOpen(): void }) {
  const explanation = limit?.reason === 'tool_rounds' ? `Für diesen Auftrag sind maximal ${limit.limit} Werkzeugrunden eingestellt.` : limit?.reason === 'tool_calls' ? `Für diesen Auftrag sind maximal ${limit.limit} Werkzeugaufrufe eingestellt.` : limit?.reason === 'timeout' ? `Das Zeitlimit von ${limit.limit} Sekunden wurde erreicht.` : 'Die eingestellte Grenze für diesen Auftrag wurde erreicht.';
  const next = limit?.nextToolType === 'discovery' ? 'Weitere Werkzeugsuche stand aus.' : limit?.nextToolType === 'action' ? 'Ein weiterer Fachaufruf stand aus.' : limit?.nextToolType === 'mixed' ? 'Weitere Such- und Aktionsschritte standen aus.' : '';
  return <div className="message-limit-status" role="status"><strong><CircleAlert size={14} aria-hidden="true"/>Agent-Limit erreicht</strong><p>{explanation}{next ? ` ${next}` : ''}</p>{limit && <small>{limit.toolRounds} Runden · {limit.toolCalls} Aufrufe · {limit.discoveryCalls} Werkzeugsuche · {limit.actionCalls} Fachaufrufe · {Math.max(0, Math.round(limit.elapsedMs / 1000))} s</small>}<button type="button" onClick={onOpen}>Agent-Einstellungen</button></div>;
}

function OperationStatus({ message, sessionId, sending }: { message: ChatMessage; sessionId: string; sending: boolean }) {
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
  const stateLabel = uncertain ? `${uncertain} unklar` : failed ? `${failed} fehlgeschlagen` : actions.length && completed === actions.length ? 'erledigt' : actions.length ? 'offen' : '';
  const statusLabels = { prepared: 'vorbereitet', running: 'läuft', completed: 'erledigt', failed: 'fehlgeschlagen', cancelled: 'abgebrochen', uncertain: 'Ausgang unklar' };
  const effectLabels = { none: 'keine Änderung ausgeführt', applied: 'Änderung bestätigt', unknown: 'Änderung unklar' };
  return <details className="tool-events operation-journal" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={13} aria-hidden="true"/><span>Auftragsstatus</span>{summary && <small>{actions.length} {actions.length === 1 ? 'Schritt' : 'Schritte'}{stateLabel ? ` · ${stateLabel}` : ''}</small>}</summary>
    {open && <div className="operation-journal-content" aria-busy={loading || !!checking}>
      {loading && <small role="status">Auftragsstatus wird geladen …</small>}
      {!loading && summary === null && <p>Für diesen Auftrag ist kein gespeichertes Aktionsprotokoll verfügbar.</p>}
      {!loading && summary && !actions.length && <p>Noch keine Fachaktionen protokolliert.</p>}
      {summary && actions.map(action => <div key={action.id} className={`operation-action ${action.status}`}>
        <div className="operation-action-heading"><span>{toolDetail(action.label) || 'Workspace-Aktion'}</span><small>{statusLabels[action.status]}</small></div>
        <small className={action.effect === 'unknown' ? 'operation-effect-unknown' : ''}>{effectLabels[action.effect]}</small>
        {action.detail && <small className="operation-action-detail">{toolDetail(action.detail)}</small>}
        {(action.status === 'uncertain' || action.effect === 'unknown') && <button type="button" disabled={sending || loading || !!checking} onClick={() => void reconcile(action.id)} title="Nur den tatsächlichen Status prüfen; die ursprüngliche Aktion wird nicht erneut ausgeführt" aria-label={`Status prüfen: ${toolDetail(action.label) || 'Workspace-Aktion'}`}>{checking === action.id ? 'Status wird geprüft …' : 'Status prüfen'}</button>}
      </div>)}
      {uncertain > 0 && <p className="operation-journal-note">Unklare Änderungen bleiben gesperrt, bis das zuständige Modul ihren Status klären kann. Die Statusprüfung wiederholt keine Aktion.</p>}
      {error && <p className="operation-journal-error" role="alert">{error}</p>}
      <button type="button" className="operation-journal-refresh" disabled={loading || !!checking} onClick={() => setRevision(value => value + 1)}>Statusübersicht aktualisieren</button>
    </div>}
  </details>;
}

function canContinue(message: ChatMessage): boolean {
  return !!message.operationRunId && !message.reformulationOf && message.status !== 'streaming' && (message.status === 'cancelled' || message.status === 'failed' || message.status === 'limited' || message.evidence?.status === 'cancelled' || message.evidence?.status === 'failed' || message.evidence?.status === 'limited' || !!message.toolEvents?.some(event => event.status === 'uncertain'));
}

export function ChatView({ state, prompt, setPrompt, emailReference, emailLoading, emailError, onEmailDrop, onRemoveEmail, references, referencesLoading, referenceError, onModuleReferenceDrop, onRemoveModuleReference, onCancelModuleReferences, sessionRef, setSessionRef, sending, error, tier, setTier, thinking, onSend, onStop, onNew, onSessions, onForkEdit, onReformulate, onContinue, onAgentSettings }: {
  state: WorkspaceState; prompt: string; setPrompt(value: string): void; emailReference?: EmailReferenceSummary; emailLoading: boolean; emailError?: string; onEmailDrop(id: string): void; onRemoveEmail(): void;
  references: ModuleReferenceSummary[]; referencesLoading: boolean; referenceError?: string; onModuleReferenceDrop(reference: ModuleReferenceInput): void; onRemoveModuleReference(reference: ModuleReferenceInput): void; onCancelModuleReferences(): void;
  sessionRef?: string; setSessionRef(value?: string): void; sending: boolean; error?: string; tier: Tier; setTier(value: Tier): void; thinking: Thinking;
  onSend(): void; onStop(): void; onNew(): void; onSessions(): void; onForkEdit(messageId: string): void; onReformulate(messageId: string): void; onContinue(messageId: string): void; onAgentSettings(): void;
}) {
  const list = useRef<HTMLDivElement>(null), thread = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), stick = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [copied, setCopied] = useState<string>();
  const [copyError, setCopyError] = useState('');
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const active = state.sessions.find(session => session.id === state.activeSessionId);
  const linked = state.sessions.find(session => session.id === sessionRef && session.id !== state.activeSessionId);
  const mail = emailReference;
  const messages = state.chat.filter((message, index) => message.id !== 'welcome' && index >= (active?.historyStart ?? 0));
  const model = tier === 'smart' ? state.ai?.smartModel : state.ai?.simpleModel;
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg+';

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
  useLayoutEffect(() => { if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [state.chat, sending]);
  useLayoutEffect(() => { scrollToLatest(); dragDepth.current = 0; setDragging(false); setCopied(undefined); setCopyError(''); input.current?.focus({ preventScroll: true }); }, [state.activeSessionId]);
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
    } catch { setCopyError('Kopieren war nicht möglich. Du kannst den Text markieren und selbst kopieren.'); }
  }
  function hasPreviousUser(id: string): boolean { const index = state.chat.findIndex(message => message.id === id); return index > 0 && state.chat.slice(active?.historyStart ?? 0, index).some(message => message.role === 'user'); }
  function send() { if (!sending && !emailLoading && !referencesLoading && prompt.trim()) { scrollToLatest(); onSend(); } }

  return <div className={`modern-chat${dragging ? ' is-dragging' : ''}`} onDragEnter={event => { if (isReferenceDrag(event.dataTransfer)) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } }} onDragOver={event => { if (acceptsDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={drop}>
    <div className="modern-chat-head"><div className="assistant-avatar"><Bot size={17}/></div><div className="modern-chat-title"><strong title={active?.title}>{active?.title ?? 'Neuer Chat'}</strong><small title={model}>{model || 'Modell in den Einstellungen auswählen'}</small></div><button type="button" title={`Neuer Chat (${shortcut}N)`} aria-label="Neuer Chat" onClick={onNew}><Plus size={18}/></button><button type="button" title={`Chats verwalten (${shortcut}F)`} aria-label="Chats verwalten" onClick={onSessions}><FolderClock size={18}/></button></div>
    <div className="sr-only" aria-live="polite">{active?.messages.at(-1)?.status === 'completed' ? 'Antwort vollständig.' : active?.messages.at(-1)?.status === 'failed' ? 'Antwort unterbrochen.' : active?.messages.at(-1)?.status === 'cancelled' ? 'Antwort gestoppt.' : active?.messages.at(-1)?.status === 'limited' ? 'Agent-Limit erreicht.' : ''}{copied ? ' Text kopiert.' : ''}</div>
    <div className="message-log-area">
      <div ref={list} className="modern-messages" role="log" aria-label="Chatverlauf" aria-live="off" onScroll={event => { const element = event.currentTarget; const near = element.scrollHeight - element.scrollTop - element.clientHeight < 64; stick.current = near; setAwayFromBottom(!near); }}>
        <div ref={thread} className="message-thread">{messages.map((message, index) => <article key={message.id} className={`modern-message ${message.role}${index === messages.length - 1 ? ' is-latest' : ''}`} aria-label={message.role === 'user' ? 'Deine Nachricht' : 'Antwort des Assistenten'} aria-busy={message.status === 'streaming'}>
          {message.role === 'assistant' && <div className="message-avatar" aria-hidden="true"><Bot size={15}/></div>}
          <div className="message-content">
            <div className="modern-message-body">
              {message.emailRef && <span className="message-ref" title={message.emailReference?.subject}><Mail size={12} aria-hidden="true"/><span>{message.emailReference?.subject || state.mails.find(mail => mail.id === message.emailRef)?.subject || 'Referenzierte E-Mail'}</span></span>}
              {message.sessionRef && <span className="message-ref" title={message.sessionRef.title}><Link2 size={12} aria-hidden="true"/><span>{message.sessionRef.title}</span></span>}
              {message.references?.map(reference => <span key={moduleReferenceKey(reference)} className="message-ref" title={reference.description || reference.title}>{reference.usage === 'instructions' ? <BookOpen size={12} aria-hidden="true"/> : <Link2 size={12} aria-hidden="true"/>}<span>{reference.usage === 'instructions' ? 'Anweisung: ' : ''}{reference.title}</span></span>)}
              {!!message.toolEvents?.length && <ToolActivity events={message.toolEvents}/>}
              {message.operationRunId && !message.reformulationOf && <OperationStatus message={message} sessionId={state.activeSessionId} sending={sending}/>}
              {message.reformulationOf && <small className="message-status" title="Verwendet ausschließlich gespeicherte Ergebnisse und Momentaufnahmen. Es werden keine Werkzeuge ausgeführt.">{message.status === 'completed' ? 'Neu formuliert' : 'Neuformulierung'} · keine Aktionen</small>}
              {message.continuationOf && <small className="message-status" title="Setzt den gespeicherten Auftrag fort. Erledigte Aktionen werden nicht wiederholt; unklare Änderungen bleiben bis zur Klärung gesperrt.">Fortsetzung des Auftrags</small>}
              <ChatMarkdown text={message.text || (message.status === 'streaming' ? 'Antwort wird vorbereitet …' : '')} messageId={message.id} copied={copied} onCopy={copy}/>
              {message.status === 'streaming' && <small className="message-status streaming" role="status"><span aria-hidden="true"/>{message.reformulationOf ? 'Antwort wird neu formuliert …' : 'Antwort wird erstellt …'}</small>}
              {message.status === 'cancelled' && <small className="message-status">Gestoppt</small>}
              {message.status === 'failed' && <small className="message-status failed">{message.error || 'Antwort unterbrochen'}</small>}
              {message.error && message.status !== 'failed' && message.status !== 'streaming' && <small className="message-status failed" role="status">{message.error}</small>}
              {message.status === 'limited' && <AgentLimitNotice limit={message.agentRunLimit} onOpen={onAgentSettings}/>}
            </div>
            {message.role === 'user' && <div className="message-actions" role="group" aria-label="Nachrichtenaktionen"><button type="button" title="Nachricht kopieren" aria-label="Nachricht kopieren" onClick={() => void copy(message.id, message.text)}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button><button type="button" title="Auftrag in einem neuen Chat bearbeiten; erst Senden startet eine neue Ausführung" aria-label="Auftrag als neuen Chat bearbeiten" disabled={sending} onClick={() => onForkEdit(message.id)}><Pencil size={14}/></button></div>}
            {message.role === 'assistant' && message.status !== 'streaming' && (message.text || hasPreviousUser(message.id)) && <div className="message-actions" role="group" aria-label="Antwortaktionen">{message.text && <button type="button" title="Antwort kopieren" aria-label="Antwort kopieren" onClick={() => void copy(message.id, message.text)}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button>}{hasPreviousUser(message.id) && <button type="button" title={message.evidence ? 'Antwort aus gespeicherten Ergebnissen neu formulieren, ohne Aktionen auszuführen' : 'Neu formulieren benötigt gespeicherte Ergebnisbelege. Für diese ältere Antwort sind noch keine verfügbar.'} aria-label="Antwort neu formulieren" disabled={sending} onClick={() => onReformulate(message.id)}><RefreshCw size={14}/></button>}{canContinue(message) && <button type="button" title="Gespeicherten Auftrag fortsetzen; erledigte Aktionen werden nicht wiederholt" aria-label="Auftrag fortsetzen" disabled={sending} onClick={() => onContinue(message.id)}><Play size={14}/></button>}</div>}
          </div>
        </article>)}
        {!messages.length && <div className="chat-empty"><div className="chat-empty-icon"><Bot size={22}/></div><strong>Wobei kann ich helfen?</strong><span>Dein Chat wird lokal gespeichert.</span></div>}</div>
      </div>
      {awayFromBottom && <button type="button" className="jump-to-latest" onClick={scrollToLatest} title="Zur neuesten Nachricht" aria-label="Zur neuesten Nachricht"><ArrowDown size={14} aria-hidden="true"/>Neueste Nachricht</button>}
    </div>
    <div className="modern-composer-area">
      {(mail || linked || references.length > 0) && <div className="context-list">{mail && <span className="context-chip" title={[mail.from, mail.accountName].filter(Boolean).join(' · ')}><Mail size={14}/><span>{mail.subject || '(Kein Betreff)'}</span><button type="button" aria-label="E-Mail aus Kontext entfernen" onClick={onRemoveEmail}><X size={13}/></button></span>}{linked && <span className="context-chip"><Link2 size={14}/><span>{linked.title}</span><button type="button" aria-label="Chat aus Kontext entfernen" onClick={() => setSessionRef(undefined)}><X size={13}/></button></span>}{references.map(reference => <span key={moduleReferenceKey(reference)} className="context-chip" title={reference.description || reference.title}>{reference.usage === 'instructions' ? <BookOpen size={14} aria-hidden="true"/> : <Link2 size={14} aria-hidden="true"/>}<span>{reference.usage === 'instructions' ? 'Anweisung: ' : ''}{reference.title}</span><button type="button" aria-label={`Referenz ${reference.title} entfernen`} onClick={() => onRemoveModuleReference(reference)}><X size={13}/></button></span>)}</div>}
      {dragging && <div className="reference-drop-target" role="status"><Link2 size={16} aria-hidden="true"/>Hier ablegen, um eine Referenz hinzuzufügen</div>}
      {emailLoading && <div className="chat-notice" role="status">Mailreferenz wird geladen … <button type="button" onClick={onRemoveEmail}>Abbrechen</button></div>}
      {emailError && <div className="chat-error" role="alert">{emailError}</div>}
      {referencesLoading && <div className="chat-notice" role="status">Referenzen werden geladen … <button type="button" onClick={onCancelModuleReferences}>Abbrechen</button></div>}
      {referenceError && <div className="chat-error" role="alert">{referenceError}</div>}
      {sending && !active?.messages.some(message => message.status === 'streaming') && <div className="chat-notice">{state.sessions.some(session => session.id !== state.activeSessionId && session.messages.some(message => message.status === 'streaming')) ? 'Eine Antwort läuft in einem anderen Chat. Du kannst sie hier stoppen.' : 'Nachricht wird vorbereitet …'}</div>}
      {(error || copyError) && <div className="chat-error" role="alert">{error || copyError}</div>}
      <div className="modern-composer">
        <textarea ref={input} rows={1} aria-label="Nachricht" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} placeholder="Schreibe eine Nachricht …"/>
        <div className="composer-actions"><label className="tier-select"><span className="sr-only">Modell auswählen</span><select aria-label="Modell auswählen" value={tier} disabled={sending} onChange={event => setTier(event.target.value as Tier)}><option value="smart">Intelligent{state.ai?.smartModel ? '' : ' · nicht eingerichtet'}</option><option value="simple">Einfach{state.ai?.simpleModel ? '' : ' · nicht eingerichtet'}</option></select></label><span className="thinking-label" title="In den KI-Einstellungen je Modell festgelegt">Thinking: {{off:'Aus',low:'Niedrig',medium:'Mittel',high:'Hoch'}[thinking]}</span>{state.ai?.confirmationMode === 'never' && <span className="confirmation-mode-badge" title="Der Assistent führt angeforderte Aktionen ohne einzelne Bestätigungsdialoge aus. Bestehende Zugriffsrechte gelten weiter.">Ohne Abfragen</span>}<span className="composer-buttons"><button type="button" className="chat-icon-button" title="Chat als Referenz auswählen" aria-label="Chat als Referenz auswählen" onClick={onSessions}><Link2 size={17}/></button>{sending ? <button type="button" className="send-button" title="Antwort stoppen (Esc)" aria-label="Antwort stoppen" onClick={onStop}><Square size={14} fill="currentColor"/></button> : <button type="button" className="send-button" aria-label="Nachricht senden" disabled={emailLoading || referencesLoading || !prompt.trim()} onClick={send}><ArrowUp size={17}/></button>}</span></div>
      </div>
      <p className="composer-hint">Referenzen hierher ziehen · Enter senden · Umschalt + Enter neue Zeile</p>
    </div>
  </div>;
}

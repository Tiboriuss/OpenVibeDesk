import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bot, Check, ChevronRight, CircleAlert, CircleHelp, Copy, FolderClock, Link2, Mail, Pencil, Plus, RefreshCw, Square, X } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';
import type { ChatMessage, EmailReferenceSummary, WorkspaceState } from '../shared/model';
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

export function ChatView({ state, prompt, setPrompt, emailReference, emailLoading, emailError, onEmailDrop, onRemoveEmail, references, referencesLoading, referenceError, onModuleReferenceDrop, onRemoveModuleReference, onCancelModuleReferences, sessionRef, setSessionRef, sending, error, tier, setTier, thinking, onSend, onStop, onNew, onSessions, onForkEdit, onForkRetry, onAgentSettings }: {
  state: WorkspaceState; prompt: string; setPrompt(value: string): void; emailReference?: EmailReferenceSummary; emailLoading: boolean; emailError?: string; onEmailDrop(id: string): void; onRemoveEmail(): void;
  references: ModuleReferenceSummary[]; referencesLoading: boolean; referenceError?: string; onModuleReferenceDrop(reference: ModuleReferenceInput): void; onRemoveModuleReference(reference: ModuleReferenceInput): void; onCancelModuleReferences(): void;
  sessionRef?: string; setSessionRef(value?: string): void; sending: boolean; error?: string; tier: Tier; setTier(value: Tier): void; thinking: Thinking;
  onSend(): void; onStop(): void; onNew(): void; onSessions(): void; onForkEdit(messageId: string): void; onForkRetry(messageId: string): void; onAgentSettings(): void;
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
              {message.references?.map(reference => <span key={moduleReferenceKey(reference)} className="message-ref" title={reference.description || reference.title}><Link2 size={12} aria-hidden="true"/><span>{reference.title}</span></span>)}
              {!!message.toolEvents?.length && <ToolActivity events={message.toolEvents}/>}
              <ChatMarkdown text={message.text || (message.status === 'streaming' ? 'Antwort wird vorbereitet …' : '')} messageId={message.id} copied={copied} onCopy={copy}/>
              {message.status === 'streaming' && <small className="message-status streaming" role="status"><span aria-hidden="true"/>Antwort wird erstellt …</small>}
              {message.status === 'cancelled' && <small className="message-status">Gestoppt</small>}
              {message.status === 'failed' && <small className="message-status failed">{message.error || 'Antwort unterbrochen'}</small>}
              {message.status === 'limited' && <AgentLimitNotice limit={message.agentRunLimit} onOpen={onAgentSettings}/>}
            </div>
            {message.role === 'user' && <div className="message-actions" role="group" aria-label="Nachrichtenaktionen"><button type="button" title="Nachricht kopieren" aria-label="Nachricht kopieren" onClick={() => void copy(message.id, message.text)}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button><button type="button" title="Als neuen Chat bearbeiten" aria-label="Als neuen Chat bearbeiten" disabled={sending} onClick={() => onForkEdit(message.id)}><Pencil size={14}/></button></div>}
            {message.role === 'assistant' && message.status !== 'streaming' && (message.text || hasPreviousUser(message.id)) && <div className="message-actions" role="group" aria-label="Antwortaktionen">{message.text && <button type="button" title="Antwort kopieren" aria-label="Antwort kopieren" onClick={() => void copy(message.id, message.text)}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button>}{hasPreviousUser(message.id) && <button type="button" title="Antwort in neuem Chat erneut erzeugen" aria-label="Antwort in neuem Chat erneut erzeugen" disabled={sending} onClick={() => onForkRetry(message.id)}><RefreshCw size={14}/></button>}</div>}
          </div>
        </article>)}
        {!messages.length && <div className="chat-empty"><div className="chat-empty-icon"><Bot size={22}/></div><strong>Wobei kann ich helfen?</strong><span>Dein Chat wird lokal gespeichert.</span></div>}</div>
      </div>
      {awayFromBottom && <button type="button" className="jump-to-latest" onClick={scrollToLatest} title="Zur neuesten Nachricht" aria-label="Zur neuesten Nachricht"><ArrowDown size={14} aria-hidden="true"/>Neueste Nachricht</button>}
    </div>
    <div className="modern-composer-area">
      {(mail || linked || references.length > 0) && <div className="context-list">{mail && <span className="context-chip" title={[mail.from, mail.accountName].filter(Boolean).join(' · ')}><Mail size={14}/><span>{mail.subject || '(Kein Betreff)'}</span><button type="button" aria-label="E-Mail aus Kontext entfernen" onClick={onRemoveEmail}><X size={13}/></button></span>}{linked && <span className="context-chip"><Link2 size={14}/><span>{linked.title}</span><button type="button" aria-label="Chat aus Kontext entfernen" onClick={() => setSessionRef(undefined)}><X size={13}/></button></span>}{references.map(reference => <span key={moduleReferenceKey(reference)} className="context-chip" title={reference.description || reference.title}><Link2 size={14} aria-hidden="true"/><span>{reference.title}</span><button type="button" aria-label={`Referenz ${reference.title} entfernen`} onClick={() => onRemoveModuleReference(reference)}><X size={13}/></button></span>)}</div>}
      {dragging && <div className="reference-drop-target" role="status"><Link2 size={16} aria-hidden="true"/>Hier ablegen, um eine Referenz hinzuzufügen</div>}
      {emailLoading && <div className="chat-notice" role="status">Mailreferenz wird geladen … <button type="button" onClick={onRemoveEmail}>Abbrechen</button></div>}
      {emailError && <div className="chat-error" role="alert">{emailError}</div>}
      {referencesLoading && <div className="chat-notice" role="status">Referenzen werden geladen … <button type="button" onClick={onCancelModuleReferences}>Abbrechen</button></div>}
      {referenceError && <div className="chat-error" role="alert">{referenceError}</div>}
      {mail && <p className="reference-content-note">Beim Senden wird der Mailtext an den gewählten KI-Anbieter übermittelt und im Chat lokal gespeichert. Dateiinhalte von Anhängen werden nicht übertragen; Dateinamen können zum Kontext gehören.</p>}
      {references.length > 0 && <p className="reference-content-note">Beim Senden werden Metadaten und verfügbare Textausschnitte der ausgewählten Referenzen an den KI-Anbieter übermittelt und im Chat lokal gespeichert. Weitere Inhalte kann der Assistent bei Bedarf über das jeweilige Modul nachladen.</p>}
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

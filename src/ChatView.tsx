import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, Check, Copy, FolderClock, Link2, Mail, Pencil, Plus, RefreshCw, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceState } from '../shared/model';
import { SESSION_DRAG_PREFIX, SESSION_DRAG_TYPE } from './SessionsView';
import './modern-chat.css';

type Tier = 'smart' | 'simple';
type Thinking = 'off' | 'low' | 'medium' | 'high';
export function ChatView({ state, prompt, setPrompt, emailRef, setEmailRef, sessionRef, setSessionRef, sending, error, tier, setTier, thinking, onSend, onStop, onNew, onSessions, onForkEdit, onForkRetry }: {
  state: WorkspaceState; prompt: string; setPrompt(value:string):void; emailRef?:string; setEmailRef(value?:string):void;
  sessionRef?:string; setSessionRef(value?:string):void; sending:boolean; error?:string; tier:Tier; setTier(value:Tier):void; thinking:Thinking;
  onSend():void; onStop():void; onNew():void; onSessions():void; onForkEdit(messageId:string):void; onForkRetry(messageId:string):void;
}) {
  const list = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null), stick = useRef(true);
  const [copied, setCopied] = useState<string>();
  const active = state.sessions.find(s => s.id === state.activeSessionId);
  const linked = state.sessions.find(s => s.id === sessionRef && s.id !== state.activeSessionId);
  const mail = state.mails.find(m => m.id === emailRef);
  const model = tier === 'smart' ? state.ai?.smartModel : state.ai?.simpleModel;
  useEffect(() => { if (stick.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [state.chat, sending]);
  useEffect(() => { stick.current = true; if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [state.activeSessionId]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); onNew(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); input.current?.focus(); }
      else if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); onSessions(); }
      else if (e.key === 'Escape' && sending) { e.preventDefault(); onStop(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [onNew, onSessions, onStop, sending]);
  function drop(event: React.DragEvent) {
    event.preventDefault();
    const text = event.dataTransfer.getData('text/plain');
    const id = event.dataTransfer.getData(SESSION_DRAG_TYPE) || (text.startsWith(SESSION_DRAG_PREFIX) ? text.slice(SESSION_DRAG_PREFIX.length) : '');
    if (id && state.sessions.some(s => s.id === id && s.id !== state.activeSessionId)) { setSessionRef(id); return; }
    const mailId = event.dataTransfer.getData('application/x-workspace-email-id');
    if (state.mails.some(m => m.id === mailId)) setEmailRef(mailId);
  }
  async function copy(id: string, value: string) { try { await navigator.clipboard.writeText(value); setCopied(id); window.setTimeout(() => setCopied(undefined), 1800); } catch { setCopied(undefined); } }
  function hasPreviousUser(id: string): boolean { const index = state.chat.findIndex(message => message.id === id); return index > 0 && state.chat.slice(active?.historyStart ?? 0, index).some(message => message.role === 'user'); }
  return <div className="modern-chat" onDragOver={e => e.preventDefault()} onDrop={drop}>
    <div className="modern-chat-head"><div className="assistant-avatar"><Bot size={18}/></div><div className="modern-chat-title"><strong>{active?.title ?? 'Neuer Chat'}</strong><small>{model || 'Modell in den Einstellungen auswählen'}</small></div><button title="Neuer Chat (Strg+N)" aria-label="Neuer Chat" onClick={onNew}><Plus size={18}/></button><button title="Chats verwalten (Strg+F)" aria-label="Chats verwalten" onClick={onSessions}><FolderClock size={18}/></button></div>
    <div className="sr-only" aria-live="polite">{active?.messages.at(-1)?.status === 'completed' ? 'Antwort vollständig.' : active?.messages.at(-1)?.status === 'failed' ? 'Antwort unterbrochen.' : active?.messages.at(-1)?.status === 'cancelled' ? 'Antwort gestoppt.' : ''}</div>
    <div ref={list} className="modern-messages" role="log" aria-label="Chatverlauf" aria-live="off" onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {state.chat.filter((m, index) => m.id !== 'welcome' && index >= (active?.historyStart ?? 0)).map(message => <article key={message.id} className={`modern-message ${message.role}`}>
        {message.role === 'assistant' && <div className="message-avatar"><Bot size={15}/></div>}
        <div className="modern-message-body">{message.emailRef && <span className="message-ref"><Mail size={12}/>{state.mails.find(m => m.id === message.emailRef)?.subject ?? 'E-Mail'}</span>}{message.sessionRef && <span className="message-ref"><Link2 size={12}/>{message.sessionRef.title}</span>}
          <div className="message-text">{message.role === 'assistant' ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children }) => <span>{children}</span>, pre: ({ children }) => <div className="code-block"><button title="Code kopieren" aria-label="Code kopieren" onClick={event => void copy(`code-${message.id}`, event.currentTarget.nextElementSibling?.textContent ?? '')}>{copied === `code-${message.id}` ? 'Kopiert' : 'Kopieren'}</button><pre>{children}</pre></div> }}>{message.text || (message.status === 'streaming' ? 'Antwort wird vorbereitet …' : '')}</ReactMarkdown> : message.text}</div>
          {message.status === 'streaming' && <small className="message-status" role="status">Antwort wird erstellt …</small>}{message.status === 'cancelled' && <small className="message-status">Gestoppt</small>}{message.status === 'failed' && <small className="message-status failed">{message.error || 'Antwort unterbrochen'}</small>}
          {message.role === 'user' && <div className="message-actions"><button title="Als neuen Chat bearbeiten" aria-label="Als neuen Chat bearbeiten" disabled={sending} onClick={() => onForkEdit(message.id)}><Pencil size={14}/></button></div>}
          {message.role === 'assistant' && message.status !== 'streaming' && (message.text || hasPreviousUser(message.id)) && <div className="message-actions">{message.text && <button title="Antwort kopieren" aria-label="Antwort kopieren" onClick={() => void copy(message.id, message.text)}>{copied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button>}{hasPreviousUser(message.id) && <button title="Antwort in neuem Chat erneut erzeugen" aria-label="Antwort in neuem Chat erneut erzeugen" disabled={sending} onClick={() => onForkRetry(message.id)}><RefreshCw size={14}/></button>}</div>}
        </div></article>)}
      {!state.chat.some(m => m.id !== 'welcome') && <div className="chat-empty"><div className="chat-empty-icon"><Bot size={22}/></div><strong>Wobei kann ich helfen?</strong><span>Dein Chat wird lokal gespeichert.</span></div>}
    </div>
    <div className="modern-composer-area">{(mail || linked) && <div className="context-list">{mail && <span className="context-chip"><Mail size={14}/>{mail.subject}<button aria-label="E-Mail aus Kontext entfernen" onClick={() => setEmailRef(undefined)}><X size={13}/></button></span>}{linked && <span className="context-chip"><Link2 size={14}/>{linked.title}<button aria-label="Chat aus Kontext entfernen" onClick={() => setSessionRef(undefined)}><X size={13}/></button></span>}</div>}
      {sending && !active?.messages.some(message => message.status === 'streaming') && <div className="chat-notice">Eine Antwort läuft in einem anderen Chat. Du kannst sie hier stoppen.</div>}
      {error && <div className="chat-error" role="alert">{error}</div>}
      <div className="modern-composer"><textarea ref={input} aria-label="Nachricht" value={prompt} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!sending && prompt.trim()) onSend(); } }} placeholder="Schreibe eine Nachricht …"/><div className="composer-actions"><label className="tier-select"><span className="sr-only">Modell auswählen</span><select aria-label="Modell auswählen" value={tier} disabled={sending} onChange={e => setTier(e.target.value as Tier)}><option value="smart">Intelligent{state.ai?.smartModel ? '' : ' · nicht eingerichtet'}</option><option value="simple">Einfach{state.ai?.simpleModel ? '' : ' · nicht eingerichtet'}</option></select></label><span className="thinking-label" title="In den KI-Einstellungen je Modell festgelegt">Thinking: {{off:'Aus',low:'Niedrig',medium:'Mittel',high:'Hoch'}[thinking]}</span><button className="chat-icon-button" title="Chats als Kontext auswählen" aria-label="Chats verwalten" onClick={onSessions}><Link2 size={17}/></button>{sending ? <button className="send-button" title="Antwort stoppen" aria-label="Antwort stoppen" onClick={onStop}><Square size={14} fill="currentColor"/></button> : <button className="send-button" aria-label="Nachricht senden" disabled={!prompt.trim()} onClick={onSend}><ArrowUp size={17}/></button>}</div></div><p className="composer-hint">Enter zum Senden · Umschalt + Enter für eine neue Zeile</p>
    </div>
  </div>;
}

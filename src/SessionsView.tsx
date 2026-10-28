import { useMemo, useState } from 'react';
import { ArrowUpRight, Link2, MessageSquare, Pencil, Plus, Search } from 'lucide-react';
import type { WorkspaceState } from '../shared/model';
import './sessions.css';

export const SESSION_DRAG_TYPE = 'application/x-openvibedesk-session';
export const SESSION_DRAG_PREFIX = 'openvibedesk-session:';

export function SessionsView({ state, onCreate, onOpen, onRename, onReference }: { state: WorkspaceState; onCreate(): void; onOpen(id: string): void; onRename(id: string, title: string): void; onReference(id: string): void }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState('');
  const sessions = useMemo(() => [...state.sessions].filter(s => `${s.title} ${s.messages.map(m => m.text).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)), [state.sessions, query]);
  return <div className="sessions-page"><div className="sessions-heading"><div><small>DEIN WORKSPACE</small><h1>Chats</h1><p>Unterhaltungen öffnen oder als Kontext verwenden.</p></div><button className="sessions-new" onClick={onCreate}><Plus size={16}/> Neuer Chat</button></div>
    <div className="sessions-search"><Search size={17}/><input aria-label="Chats durchsuchen" placeholder="Chats durchsuchen …" value={query} onChange={e => setQuery(e.target.value)} /></div>
    <div className="sessions-list">{sessions.map(session => <article key={session.id} className={`session-card ${session.id === state.activeSessionId ? 'is-current' : ''}`} draggable={session.id !== state.activeSessionId} onDragStart={e => { e.dataTransfer.setData(SESSION_DRAG_TYPE, session.id); e.dataTransfer.setData('text/plain', SESSION_DRAG_PREFIX + session.id); e.dataTransfer.effectAllowed = 'copy'; }}>
      <div className="session-icon"><MessageSquare size={18}/></div><div className="session-main">{editing === session.id ? <form onSubmit={e => { e.preventDefault(); if (title.trim()) { onRename(session.id, title.trim()); setEditing(undefined); } }}><input aria-label="Chat-Titel" value={title} autoFocus onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditing(undefined); }}/><button type="submit">Speichern</button><button type="button" onClick={() => setEditing(undefined)}>Abbrechen</button></form> : <><strong>{session.title}</strong><p>{session.messages.filter(m => m.id !== 'welcome').at(-1)?.text.slice(0, 100) || 'Noch keine Nachrichten'}</p><small>{new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(session.updatedAt))} {session.id === state.activeSessionId ? '· Aktiver Chat' : ''}</small></>}</div>
      <div className="session-actions"><button title="Umbenennen" aria-label={`${session.title} umbenennen`} onClick={() => { setEditing(session.id); setTitle(session.title); }}><Pencil size={15}/></button><button title="Als Referenz verwenden" aria-label={`${session.title} als Referenz verwenden`} disabled={session.id === state.activeSessionId} onClick={() => onReference(session.id)}><Link2 size={15}/></button><button title="Chat öffnen" aria-label={`${session.title} öffnen`} onClick={() => onOpen(session.id)}><ArrowUpRight size={16}/></button></div>
    </article>)}{sessions.length === 0 && <div className="sessions-empty">Keine passenden Chats gefunden.</div>}</div><div className="sessions-foot">Ziehe einen anderen Chat in den Assistant oder nutze das Referenz-Symbol.</div></div>;
}

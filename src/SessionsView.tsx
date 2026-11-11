import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Link2, MessageSquare, Pencil, Plus, Search, X } from 'lucide-react';
import type { ChatSessionPage, RendererWorkspaceState } from '../shared/model';
import './sessions.css';

export const SESSION_DRAG_TYPE = 'application/x-openvibedesk-session';
export const SESSION_DRAG_PREFIX = 'openvibedesk-session:';

export function SessionsView({ state, onCreate, onOpen, onRename, onReference }: { state: RendererWorkspaceState; onCreate(): void; onOpen(id: string): void; onRename(id: string, title: string): Promise<void>; onReference(id: string): void }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const search = useDeferredValue(query.trim().toLocaleLowerCase());
  const [page, setPage] = useState<ChatSessionPage>({ sessions: [], total: 0, offset: 0, revision: '', hasMore: false, complete: true });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const requestVersion = useRef(0);
  useEffect(() => {
    const version = ++requestVersion.current;
    setLoading(true); setLoadError('');
    const timer = setTimeout(() => {
      void window.workspace.listChatSessions({ query: search, limit: 50 }).then(result => {
        if (version === requestVersion.current) setPage(result);
      }, reason => { if (version === requestVersion.current) setLoadError(String(reason)); })
        .finally(() => { if (version === requestVersion.current) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); requestVersion.current++; };
  }, [search, state.presentation?.sessionRevision]);
  async function loadMore() {
    if (loading || page.nextOffset === undefined) return;
    const version = requestVersion.current;
    setLoading(true); setLoadError('');
    try {
      const result = await window.workspace.listChatSessions({ query: search, offset: page.nextOffset, limit: 50, revision: page.revision });
      if (version === requestVersion.current) setPage(current => ({ ...result, sessions: [...current.sessions, ...result.sessions] }));
    } catch (reason) { if (version === requestVersion.current) setLoadError(String(reason)); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }
  const sessions = page.sessions;
  async function rename(id: string) {
    if (!title.trim() || saving) return;
    setSaving(true); setError('');
    try { await onRename(id, title.trim()); setEditing(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  }
  return <div className="sessions-page">
    <div className="sessions-toolbar"><h1 className="sr-only">Chats</h1><div className="sessions-search"><Search size={16} aria-hidden="true"/><input aria-label="Chats durchsuchen" placeholder="Chats durchsuchen …" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}/>{query && <button type="button" aria-label="Suche löschen" title="Suche löschen" onClick={() => setQuery('')}><X size={14}/></button>}</div><button className="sessions-new" title="Neuer Chat" aria-label="Neuer Chat" onClick={onCreate}><Plus size={16}/><span>Neuer Chat</span></button></div>
    <div className="sessions-list" aria-busy={loading}>{sessions.map(session => <article key={session.id} className={`session-card ${session.id === state.activeSessionId ? 'is-current' : ''}`} draggable={session.id !== state.activeSessionId && editing !== session.id} onDragStart={event => { event.dataTransfer.setData(SESSION_DRAG_TYPE, session.id); event.dataTransfer.setData('text/plain', SESSION_DRAG_PREFIX + session.id); event.dataTransfer.effectAllowed = 'copy'; }}>
      <div className="session-icon"><MessageSquare size={17}/></div>
      <div className="session-main">{editing === session.id ? <form onSubmit={event => { event.preventDefault(); void rename(session.id); }}>
        <input aria-label="Chat-Titel" value={title} maxLength={120} disabled={saving} autoFocus onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !saving) setEditing(undefined); }}/>
        <button type="submit" disabled={saving || !title.trim()}>{saving ? 'Speichert …' : 'Speichern'}</button><button type="button" disabled={saving} onClick={() => setEditing(undefined)}>Abbrechen</button>
        {error && <p className="session-rename-error" role="alert">{error}</p>}
      </form> : <><button className="session-open" title={session.title} aria-label={`${session.title} öffnen`} onClick={() => onOpen(session.id)}>{session.title}</button><p>{session.preview || 'Noch keine Nachrichten'}</p><small>{new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(session.updatedAt))}{session.id === state.activeSessionId ? ' · Aktiv' : ''}</small></>}</div>
      <div className="session-actions"><button title="Umbenennen" aria-label={`${session.title} umbenennen`} disabled={saving} onClick={() => { setEditing(session.id); setTitle(session.title); setError(''); }}><Pencil size={15}/></button><button title="Als Referenz verwenden" aria-label={`${session.title} als Referenz verwenden`} disabled={session.id === state.activeSessionId} onClick={() => onReference(session.id)}><Link2 size={15}/></button></div>
    </article>)}{!loading && !loadError && sessions.length === 0 && <div className="sessions-empty">Keine passenden Chats gefunden.</div>}{loadError && <p role="alert">{loadError}</p>}{page.nextOffset !== undefined && <button type="button" className="sessions-new" aria-disabled={loading} onClick={() => void loadMore()}>{loading ? 'Lädt …' : 'Weitere Chats laden'}</button>}</div>
  </div>;
}

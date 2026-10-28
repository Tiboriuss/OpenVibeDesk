import { useEffect, useRef, useState } from 'react';
import { ImapMailView } from './ImapMailView';
import { MailQueryControls } from './MailQueryControls';
import type { ImapFolder, ImapMessage, ImapPageCursor, MailAccountSummary, MailSearchResults } from '../../../shared/mail';
import type { MailCountRequest, MailCountResult, MailQueryRequest, MailQueryResult } from '../../../shared/mail-query';
import type { Draft, MailNavigationTarget } from '../../../shared/model';
import './mail-workspace.css';

type MailOpenRequest = MailNavigationTarget & { refreshVersion: number };

export function MailWorkspace({ drafts }: { drafts: Draft[] }) {
  const [mode, setMode] = useState<'loading' | 'real' | 'drafts'>('loading');
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  const [accountId, setAccountId] = useState('');
  const [folders, setFolders] = useState<ImapFolder[]>([]);
  const [folder, setFolder] = useState('');
  const [messages, setMessages] = useState<ImapMessage[]>([]);
  const [messageId, setMessageId] = useState<string>();
  const [bodyLoading, setBodyLoading] = useState<string>();
  const [searchResults, setSearchResults] = useState<MailSearchResults>();
  const [queryResults, setQueryResults] = useState<MailQueryResult>();
  const [queryRequest, setQueryRequest] = useState<MailQueryRequest>();
  const [countResult, setCountResult] = useState<MailCountResult>();
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryLoadingMore, setQueryLoadingMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [pendingSearchQuery, setPendingSearchQuery] = useState('');
  const searchVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<ImapPageCursor>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const refreshVersion = useRef(0);
  const [foldersLoadedVersion, setFoldersLoadedVersion] = useState(0);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [foldersLoadedFor, setFoldersLoadedFor] = useState('');
  const [messagesLoadedFor, setMessagesLoadedFor] = useState<{ accountId: string; folder: string }>();
  const [pendingOpen, setPendingOpen] = useState<MailOpenRequest>();
  const [focusVersion, setFocusVersion] = useState(0);
  const currentFolder = useRef({ accountId, folder });
  const listVersion = useRef(0);
  const loadMoreBusy = useRef(false);
  const pendingLookup = useRef<string | undefined>(undefined);
  currentFolder.current = { accountId, folder };

  useEffect(() => window.workspace.onMailMessageChanged(message => { setMessages(items => items.map(item => item.id === message.id ? message : item)); setSearchResults(current => current ? { ...current, messages: current.messages.map(item => item.id === message.id ? message : item) } : current); setQueryResults(current => current ? { ...current, messages: current.messages.map(item => item.id === message.id ? message : item) } : current); }), []);
  useEffect(() => window.workspace.onMailSearchResults(results => { searchVersion.current++; setSearchResults(results); setQueryResults(undefined); setQueryRequest(undefined); setCountResult(undefined); setQueryBusy(false); setSearchLoading(false); setMode('real'); setMessageId(undefined); setBodyLoading(undefined); setError(''); setPendingOpen(undefined); }), []);
  useEffect(() => window.workspace.onMailQueryResults(({ result, request }) => { searchVersion.current++; setQueryResults(result); setQueryRequest(request); setCountResult(undefined); setSearchResults(undefined); setQueryBusy(false); setQueryLoadingMore(false); setSearchLoading(false); setMode('real'); setMessageId(undefined); setBodyLoading(undefined); setError(''); setPendingOpen(undefined); }), []);

  useEffect(() => {
    let mounted = true;
    const load = (changed = false) => void window.workspace.listMailAccounts().then(items => {
      if (!mounted) return;
      setAccounts(items);
      setAccountsLoaded(true);
      setAccountId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? '');
      setMode(current => changed && items.length ? 'real' : current === 'loading' ? 'real' : current);
      if (changed) {
        // Updates keep account IDs. Reload the visible mailbox with its new
        // connection details instead of retaining messages from the old config.
        searchVersion.current++;
        setSearchResults(undefined); setQueryResults(undefined); setQueryRequest(undefined); setCountResult(undefined); setQueryBusy(false); setSearchLoading(false);
        setPendingOpen(undefined); setMessageId(undefined); setBodyLoading(undefined);
        setRefresh(++refreshVersion.current);
      }
    }).catch(() => { if (mounted) { setAccountsLoaded(true); setError('Mailkonten konnten nicht geladen werden.'); setMode('real'); setPendingOpen(undefined); } });
    const unsubscribe = window.workspace.onMailAccountsChanged(() => load(true));
    const unsubscribeReal = window.workspace.onShowRealMail(request => {
      const version = request.refresh ? ++refreshVersion.current : refreshVersion.current;
      searchVersion.current++; setSearchResults(undefined); setQueryResults(undefined); setQueryRequest(undefined); setCountResult(undefined); setQueryBusy(false); setSearchLoading(false); setMode('real'); setError(''); setPendingOpen({ ...request, refreshVersion: version }); setAccountId(request.accountId);
      if (!request.messageId) { setMessageId(undefined); setBodyLoading(undefined); }
      if (request.refresh) setRefresh(version);
    });
    load();
    return () => { mounted = false; unsubscribe(); unsubscribeReal(); };
  }, []);

  useEffect(() => {
    if (!accountId) { setFolders([]); setFolder(''); setMessages([]); setFoldersLoadedFor(''); setMessagesLoadedFor(undefined); return; }
    let active = true;
    setLoading(true); setError(''); setFolders([]); setMessages([]); setMessageId(undefined); setBodyLoading(undefined); setFolder(''); setFoldersLoadedFor(''); setMessagesLoadedFor(undefined);
    void window.workspace.listMailFolders(accountId).then(items => {
      if (!active) return;
      setFolders(items);
      setFoldersLoadedFor(accountId); setFoldersLoadedVersion(refresh);
      const first = items.find(item => item.selectable && (item.specialUse?.toLowerCase() === '\\inbox' || item.path.toLowerCase() === 'inbox')) ?? items.find(item => item.selectable);
      setFolder(first?.path ?? '');
      if (!first) setLoading(false);
    }).catch(reason => { if (active) { setError(reason instanceof Error ? reason.message : 'Ordner konnten nicht geladen werden.'); setLoading(false); setPendingOpen(undefined); } });
    return () => { active = false; };
  }, [accountId, refresh]);

  useEffect(() => {
    const version = ++listVersion.current;
    setNextCursor(undefined); setLoadingMore(false); loadMoreBusy.current = false;
    if (!accountId || !folder) return;
    let active = true;
    setLoading(true); setError(''); setMessages([]); setMessageId(undefined); setBodyLoading(undefined); setMessagesLoadedFor(undefined);
    void window.workspace.listMailMessages(accountId, folder).then(page => { if (active && listVersion.current === version) { setMessages(page.messages); setNextCursor(page.nextCursor); setMessagesLoadedFor({ accountId, folder }); setLoading(false); } })
      .catch(reason => { if (active) { setError(reason instanceof Error ? reason.message : 'Nachrichten konnten nicht geladen werden.'); setLoading(false); setPendingOpen(undefined); } });
    return () => { active = false; };
  }, [accountId, folder]);

  const loadMore = async () => {
    if (!nextCursor || loadMoreBusy.current || loading) return;
    const version = listVersion.current;
    loadMoreBusy.current = true; setLoadingMore(true); setError('');
    try {
      const page = await window.workspace.listMailMessages(accountId, folder, nextCursor);
      if (listVersion.current !== version) return;
      setMessages(previous => {
        const byId = new Map(previous.map(message => [message.id, message]));
        for (const message of page.messages) if (!byId.has(message.id)) byId.set(message.id, message);
        return [...byId.values()].sort((a, b) => b.uid - a.uid).slice(-500);
      });
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (listVersion.current === version) setError(reason instanceof Error ? reason.message : 'Ältere Nachrichten konnten nicht geladen werden.');
    } finally {
      if (listVersion.current === version) { loadMoreBusy.current = false; setLoadingMore(false); }
    }
  };

  useEffect(() => {
    const accountAvailable = accounts.some(account => account.id === accountId);
    const folderAvailable = foldersLoadedFor === accountId && folders.some(item => item.path === folder && item.selectable);
    if (mode === 'loading' || !accountAvailable || !folderAvailable) {
      window.workspace.reportMailView(null);
      return;
    }
    const searchSelection = (queryResults?.messages ?? searchResults?.messages)?.find(message => message.id === messageId);
    if (mode === 'real' && searchSelection?.accountId && searchSelection.folder) { window.workspace.reportMailView({ accountId: searchSelection.accountId, folder: searchSelection.folder, messageId: searchSelection.id }); return; }
    const messagesMatch = messagesLoadedFor?.accountId === accountId && messagesLoadedFor.folder === folder;
    const selected = mode === 'real' && messagesMatch && messages.some(message => message.id === messageId) ? messageId : undefined;
    window.workspace.reportMailView({ accountId, folder, ...(selected ? { messageId: selected } : {}) });
  }, [mode, accounts, accountId, folder, folders, foldersLoadedFor, messages, messagesLoadedFor, messageId, searchResults, queryResults]);
  useEffect(() => () => window.workspace.reportMailView(null), []);

  const openSettings = () => void window.workspace.openMailSettings().catch(reason => setError(String(reason)));
  const openDraft = (messageId?: string) => void window.workspace.createMailDraft((queryResults?.messages ?? searchResults?.messages)?.find(message => message.id === messageId)?.accountId ?? accountId, messageId).catch(reason => setError(String(reason)));
  const selectMessage = (id: string) => {
    setMessageId(id);
    const selected = (queryResults?.messages ?? searchResults?.messages ?? messages).find(message => message.id === id);
    if (!selected || selected.bodyLoaded) return;
    const before = { accountId, folder };
    setBodyLoading(id); setError('');
    void window.workspace.loadMailBody(id).then(message => {
      if (currentFolder.current.accountId === before.accountId && currentFolder.current.folder === before.folder) { setMessages(items => items.map(item => item.id === id ? message : item)); setSearchResults(current => current ? { ...current, messages: current.messages.map(item => item.id === id ? message : item) } : current); setQueryResults(current => current ? { ...current, messages: current.messages.map(item => item.id === id ? message : item) } : current); }
    }).catch(reason => { if (currentFolder.current.accountId === before.accountId && currentFolder.current.folder === before.folder) setError(reason instanceof Error ? reason.message : 'Nachricht konnte nicht geladen werden.'); })
      .finally(() => setBodyLoading(current => current === id ? undefined : current));
  };
  useEffect(() => {
    if (!pendingOpen || !accountsLoaded) return;
    if (!accounts.some(account => account.id === pendingOpen.accountId)) { setError('Das Mailkonto ist nicht mehr eingerichtet.'); setPendingOpen(undefined); return; }
    if (accountId !== pendingOpen.accountId || foldersLoadedFor !== accountId || foldersLoadedVersion !== pendingOpen.refreshVersion) return;
    if (!folders.some(item => item.path === pendingOpen.folder && item.selectable)) { setError('Der zugehörige Mailordner ist nicht mehr verfügbar.'); setPendingOpen(undefined); return; }
    if (folder !== pendingOpen.folder) { setFolder(pendingOpen.folder); return; }
    if (messagesLoadedFor?.accountId !== accountId || messagesLoadedFor.folder !== folder) return;
    if (!pendingOpen.messageId) { setMessageId(undefined); setBodyLoading(undefined); setPendingOpen(undefined); return; }
    if (!messages.some(message => message.id === pendingOpen.messageId)) {
      const target = pendingOpen;
      const key = `${target.accountId}\n${target.folder}\n${target.messageId}`;
      if (pendingLookup.current === key) return;
      pendingLookup.current = key;
      void window.workspace.getCachedMail(target.accountId, target.folder, target.messageId!).then(message => {
        if (pendingLookup.current !== key || currentFolder.current.accountId !== target.accountId || currentFolder.current.folder !== target.folder) return;
        setMessages(previous => [...previous.filter(item => item.id !== message.id), message].sort((a, b) => b.uid - a.uid));
      }).catch(reason => {
        if (pendingLookup.current === key && currentFolder.current.accountId === target.accountId && currentFolder.current.folder === target.folder) {
          setError(reason instanceof Error ? reason.message : 'Die Nachricht ist nicht mehr geladen.');
          setPendingOpen(current => current === target ? undefined : current);
        }
      }).finally(() => { if (pendingLookup.current === key) pendingLookup.current = undefined; });
      return;
    }
    selectMessage(pendingOpen.messageId);
    setFocusVersion(value => value + 1);
    setPendingOpen(undefined);
  }, [pendingOpen, accountsLoaded, accounts, accountId, folder, folders, foldersLoadedFor, foldersLoadedVersion, messages, messagesLoadedFor]);
  const clearSearch = () => { searchVersion.current++; setSearchResults(undefined); setQueryResults(undefined); setQueryRequest(undefined); setCountResult(undefined); setQueryBusy(false); setQueryLoadingMore(false); setSearchLoading(false); setMessageId(undefined); setBodyLoading(undefined); setError(''); };
  const searchMail = async (query: string) => {
    if (!query.trim()) { clearSearch(); return; }
    const version = ++searchVersion.current; setPendingSearchQuery(query.trim()); setSearchLoading(true); setQueryResults(undefined); setQueryRequest(undefined); setCountResult(undefined); setQueryBusy(false); setMode('real'); setError(''); setPendingOpen(undefined);
    try { const results = await window.workspace.searchMail({ query: query.trim(), ...(accountId ? { accountId } : {}), limit: 50 }); if (version === searchVersion.current) { setSearchResults(results); setMessageId(undefined); } }
    catch (reason) { if (version === searchVersion.current) setError(reason instanceof Error ? reason.message : 'Die Postfachsuche ist fehlgeschlagen.'); }
    finally { if (version === searchVersion.current) setSearchLoading(false); }
  };
  const queryMail = async (request: MailQueryRequest) => {
    const version = ++searchVersion.current;
    setQueryBusy(true); setQueryLoadingMore(false); setSearchLoading(false); setMode('real'); setError(''); setPendingOpen(undefined);
    try {
      const result = await window.workspace.queryMail(request);
      if (version !== searchVersion.current) return;
      setQueryResults(result); setQueryRequest(request); setCountResult(undefined); setSearchResults(undefined); setMessageId(undefined); setBodyLoading(undefined);
    } finally { if (version === searchVersion.current) setQueryBusy(false); }
  };
  const countMail = async (request: MailCountRequest) => {
    const version = ++searchVersion.current;
    setQueryBusy(true); setQueryLoadingMore(false); setSearchLoading(false); setError('');
    try { const result = await window.workspace.countMail(request); if (version === searchVersion.current) setCountResult(result); }
    finally { if (version === searchVersion.current) setQueryBusy(false); }
  };
  const loadMoreQuery = async () => {
    if (!queryRequest || !queryResults?.nextCursor || queryLoadingMore || queryBusy) return;
    const version = searchVersion.current;
    setQueryLoadingMore(true); setError('');
    try {
      const result = await window.workspace.queryMail({ ...queryRequest, cursor: queryResults.nextCursor });
      if (version !== searchVersion.current) return;
      setQueryResults(previous => previous ? { ...result, messages: [...new Map([...previous.messages, ...result.messages].map(message => [message.id, message])).values()].slice(0, 500) } : result);
    } catch (reason) { if (version === searchVersion.current) setError(reason instanceof Error ? reason.message : 'Weitere Ergebnisse konnten nicht geladen werden.'); }
    finally { if (version === searchVersion.current) setQueryLoadingMore(false); }
  };
  const changeRead = async (message: ImapMessage) => {
    const before = { accountId, folder };
    await window.workspace.setMailRead(message.id, !message.read);
    if (currentFolder.current.accountId === before.accountId && currentFolder.current.folder === before.folder) setMessages(items => items.map(item => item.id === message.id ? { ...item, read: !message.read } : item));
  };
  const draftsView = <section className="local-drafts" aria-label="Lokale Entwürfe"><header><h2>Lokale Entwürfe</h2><p>Entwürfe und ihr Versandstatus werden auf diesem Gerät gespeichert.</p></header>{!drafts.length ? <p className="local-drafts-empty">Noch keine Entwürfe vorhanden.</p> : <div className="local-drafts-list">{[...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(draft => <button type="button" key={draft.id} onClick={() => void window.workspace.setActiveDraft(draft.id).catch(reason => setError(String(reason)))}><span><strong>{draft.subject || '(Kein Betreff)'}</strong><small>{draft.to || 'Kein Empfänger'} · {accounts.find(account => account.id === draft.accountId)?.email || 'Kein Mailkonto'}</small></span><span className={`local-draft-status ${draft.deliveryStatus ?? 'draft'}`}>{draft.deliveryStatus === 'sent' && draft.rejectedRecipients?.length ? 'Teilweise angenommen' : { draft: 'Entwurf', sending: 'Wird gesendet', sent: 'Angenommen', uncertain: 'Versand unklar' }[draft.deliveryStatus ?? 'draft']}</span></button>)}</div>}{error && <p className="imap-error" role="alert">{error}</p>}</section>;

  return <div className="mail-workspace">
    <div className="mail-workspace-content">
      {mode === 'loading' ? <div className="mail-workspace-loading">Mailkonten werden geladen …</div> :
        <ImapMailView accounts={accounts} folders={folders} messages={queryResults?.messages ?? searchResults?.messages ?? messages} selectedAccountId={accountId} selectedFolder={folder} selectedMessageId={messageId}
          dateBasis={queryResults && (queryRequest?.sort ?? queryResults.request?.sort ?? 'received_desc').startsWith('received') ? 'received' : 'sent'}
          queryControls={<MailQueryControls accounts={accounts} folders={folders} accountId={accountId} folder={folder} hidden={mode === 'drafts'} busy={queryBusy || queryLoadingMore} summary={countResult ?? queryResults} onQuery={queryMail} onCount={countMail} onReset={clearSearch}/>}
          searchState={queryResults ? { title: 'Mailabfrage', query: '', description: 'Kombinierte Serverfilter', total: queryResults.count, countExact: queryResults.countExact, complete: queryResults.complete, hasMore: queryResults.hasMore, scope: queryResults.scope, loading: queryBusy } : searchResults ? { query: searchResults.query, total: searchResults.total, hasMore: searchResults.hasMore, scope: searchResults.scope + (searchResults.foldersRemaining ? ` · ${searchResults.foldersRemaining} weitere Ordner nicht durchsucht` : '') + (searchResults.warnings?.length ? ' · Einige Ordner nicht erreichbar' : ''), loading: searchLoading } : searchLoading ? { query: pendingSearchQuery, total: 0, hasMore: false, scope: 'Postfachsuche läuft …', loading: true } : undefined}
          onSearch={query => void searchMail(query)} onClearSearch={clearSearch} focusVersion={focusVersion}
          loading={queryResults ? queryBusy : searchResults ? searchLoading : loading || searchLoading || queryBusy}
          loadingMore={queryResults ? queryLoadingMore : loadingMore}
          hasMore={queryResults ? !!queryResults.nextCursor && queryResults.messages.length < 500 : !searchResults && !!nextCursor}
          onLoadMore={() => void (queryResults ? loadMoreQuery() : loadMore())}
          bodyLoading={bodyLoading === messageId} error={error}
          onAccount={id => { clearSearch(); setPendingOpen(undefined); setMode('real'); setAccountId(id); }}
          onFolder={path => { clearSearch(); setPendingOpen(undefined); setMode('real'); setFolder(path); }}
          onSelect={id => { setPendingOpen(undefined); selectMessage(id); }}
          onRefresh={() => { if (queryResults && queryRequest) { void queryMail({ ...queryRequest, cursor: undefined }).catch(reason => setError(reason instanceof Error ? reason.message : 'Die Abfrage konnte nicht aktualisiert werden.')); return; } if (searchResults) { void searchMail(searchResults.query); return; } setPendingOpen(undefined); refreshVersion.current++; setRefresh(refreshVersion.current); }}
          onSettings={openSettings} onCompose={accountId ? () => openDraft() : undefined} onReply={message => openDraft(message.id)} onToggleRead={changeRead}
          onDownloadAttachment={async (message, index) => { await window.workspace.downloadMailAttachment(message.id, index); }}
          onDrafts={() => { clearSearch(); setPendingOpen(undefined); setMode('drafts'); }} draftCount={drafts.length} draftsSelected={mode === 'drafts'} draftsView={draftsView}/>}
    </div>
  </div>;
}

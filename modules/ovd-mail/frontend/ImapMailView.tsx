import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Archive, ArrowLeft, ChevronDown, Download, FileText, Folder, Inbox, Mail, MailCheck, MailOpen, MoreHorizontal, Paperclip, PenLine, RefreshCw, Reply, Search, Send, Settings, ShieldAlert, Trash2, X } from 'lucide-react';
import type { ImapFolder, ImapMessage, MailAccountSummary } from '../../../shared/mail';
import { HtmlMailBody } from './HtmlMailBody';
import { writeMailDrag } from '../../../src/mail-reference';
import './imap-mail.css';

type Props = {
  accounts: MailAccountSummary[];
  folders: ImapFolder[];
  messages: ImapMessage[];
  dateBasis?: 'received' | 'sent';
  selectedAccountId: string;
  selectedFolder: string;
  selectedMessageId?: string;
  focusVersion?: number;
  loading: boolean;
  loadingMore?: boolean;
  bodyLoading?: boolean;
  error: string;
  hasMore?: boolean;
  onAccount(id: string): void;
  onFolder(path: string): void;
  onSelect(id: string): void;
  onVisibleMessages?(ids: string[]): void;
  onRefresh(): void;
  onLoadMore?(): void;
  onSettings(): void;
  onSearch?(query: string): void;
  searchState?: { query: string; total: number; hasMore: boolean; scope: string; loading?: boolean; title?: string; description?: string; countExact?: boolean; complete?: boolean };
  queryControls?: ReactNode;
  onClearSearch?(): void;
  onCompose?(): void;
  onReply?(message: ImapMessage): void;
  onDownloadAttachment?(message: ImapMessage, attachmentIndex: number): Promise<void> | void;
  onToggleRead?(message: ImapMessage): Promise<void> | void;
  onDisplay?(emailId: string, patch: { format?: 'auto' | 'html' | 'text'; remoteImages?: boolean }): Promise<void>;
  onOpenLink?(emailId: string, url: string): Promise<void>;
  onDrafts(): void;
  draftCount: number;
  draftsSelected?: boolean;
  draftsView?: ReactNode;
};

function formatDate(value: string, detailed = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (!detailed && date.toDateString() === new Date().toDateString()) return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(date);
  return new Intl.DateTimeFormat('de-DE', detailed ? { dateStyle: 'medium', timeStyle: 'short' } : { day: '2-digit', month: 'short' }).format(date);
}
function dateGroup(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Weitere Nachrichten';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(date); day.setHours(0, 0, 0, 0);
  const difference = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (difference === 0) return 'Heute';
  if (difference === 1) return 'Gestern';
  if (difference > 1 && difference < 7) return 'Letzte 7 Tage';
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(date);
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function senderName(value: string): string { return value.replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '').trim() || value || 'Unbekannter Absender'; }
function senderAddress(value: string): string { return value.match(/<([^>]+)>/)?.[1] || value; }
function initials(value: string): string { return senderName(value).split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('').toLocaleUpperCase('de-DE'); }
function folderDisplay(folder: ImapFolder) {
  const special = folder.specialUse?.toLowerCase() ?? '';
  if (special === '\\inbox' || folder.path.toLowerCase() === 'inbox') return { label: 'Posteingang', Icon: Inbox, primary: true };
  if (special === '\\sent') return { label: 'Gesendet', Icon: Send, primary: true };
  if (special === '\\drafts') return { label: 'Entwürfe auf Server', Icon: FileText, primary: true };
  if (special === '\\archive') return { label: 'Archiv', Icon: Archive, primary: true };
  if (special === '\\trash') return { label: 'Papierkorb', Icon: Trash2, primary: true };
  if (special === '\\junk') return { label: 'Spam', Icon: ShieldAlert, primary: true };
  return { label: folder.name || folder.path, Icon: Folder, primary: false };
}

export function ImapMailView({ accounts, folders, messages, dateBasis = 'sent', selectedAccountId, selectedFolder, selectedMessageId, focusVersion = 0, loading, loadingMore = false, bodyLoading = false, error, hasMore = false, onAccount, onFolder, onSelect, onVisibleMessages, onRefresh, onLoadMore, onSettings, onSearch, searchState, queryControls, onClearSearch, onCompose, onReply, onDownloadAttachment, onToggleRead, onDisplay, onOpenLink, onDrafts, draftCount, draftsSelected = false, draftsView }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const searchAction = useRef(onSearch); searchAction.current = onSearch;
  const clearSearchAction = useRef(onClearSearch); clearSearchAction.current = onClearSearch;
  const messageList = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState<{ messageId: string; index: number }>();
  const [marking, setMarking] = useState<string>();
  const [actionError, setActionError] = useState('');
  const selected = messages.find(message => message.id === selectedMessageId);
  const [displayBusy, setDisplayBusy] = useState<string>();
  const [remoteCount, setRemoteCount] = useState<{ id: string; count: number }>();
  const displayFormat = selected?.display?.format ?? 'auto';
  const useHtml = !!selected?.bodyHtml?.trim() && displayFormat !== 'text';
  const remoteImages = selected?.display?.remoteImages === true;
  const changeDisplay = async (patch: { format?: 'auto' | 'html' | 'text'; remoteImages?: boolean }) => {
    if (!selected || !onDisplay || displayBusy) return;
    const id = selected.id; setDisplayBusy(id); setActionError('');
    try { await onDisplay(id, patch); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Die Leseansicht konnte nicht geändert werden.'); }
    finally { setDisplayBusy(current => current === id ? undefined : current); }
  };
  const currentAccount = accounts.find(account => account.id === selectedAccountId);
  const selectedAccount = accounts.find(account => account.id === selected?.accountId) ?? currentAccount;
  const resultCount = searchState ? `${searchState.countExact === false ? 'Mindestens ' : ''}${searchState.total}${searchState.countExact === undefined && searchState.hasMore ? '+' : ''}` : '';
  const currentFolder = folders.find(folder => folder.path === selectedFolder);
  const folderName = currentFolder ? folderDisplay(currentFolder).label : selectedFolder || 'Postfach';
  const filtering = !!query.trim() || unreadOnly || attachmentsOnly;
  const primaryFolders = folders.filter(folder => folderDisplay(folder).primary);
  const otherFolders = folders.filter(folder => !folderDisplay(folder).primary);
  useEffect(() => window.workspace.onMailViewFilter(filter => {
    if (typeof filter.query === 'string') { const value = filter.query.slice(0, 200); setQuery(value); if (value.trim()) searchAction.current?.(value.trim()); else clearSearchAction.current?.(); }
    if (typeof filter.unreadOnly === 'boolean') setUnreadOnly(filter.unreadOnly);
    if (typeof filter.attachmentsOnly === 'boolean') setAttachmentsOnly(filter.attachmentsOnly);
  }), []);
  useEffect(() => { setQuery(searchState?.query ?? ''); }, [searchState?.query]);
  useEffect(() => { setShowDetail(false); }, [selectedAccountId, selectedFolder, draftsSelected]);
  useEffect(() => { if (focusVersion > 0 && selectedMessageId) setShowDetail(true); }, [focusVersion, selectedMessageId]);
  useEffect(() => { setActionError(''); setShowDetails(false); }, [selectedAccountId, selectedFolder, selectedMessageId]);
  const filteredMessages = useMemo(() => {
    const words = searchState ? [] : query.trim().toLocaleLowerCase('de-DE').split(/\s+/).filter(Boolean);
    return messages.filter(message => {
      if (unreadOnly && message.read) return false;
      if (attachmentsOnly && !message.attachments.length) return false;
      const content = `${message.from}\n${message.to}\n${message.subject}\n${message.preview ?? ''}\n${message.bodyText}`.toLocaleLowerCase('de-DE');
      return words.every(word => content.includes(word));
    });
  }, [messages, query, unreadOnly, attachmentsOnly, searchState]);
  const listedIds = filteredMessages.map(message => message.id).join('\n');
  useEffect(() => {
    const root = messageList.current;
    if (!root || !listedIds || draftsSelected || !onVisibleMessages) {
      onVisibleMessages?.([]);
      return;
    }
    const visible = new Set<string>();
    let reportedIds: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.messageId;
        if (id) { if (entry.isIntersecting) visible.add(id); else visible.delete(id); }
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        const ids = listedIds.split('\n').filter(id => visible.has(id));
        const key = ids.join('\n');
        if (reportedIds !== key) { reportedIds = key; onVisibleMessages(ids); }
      }, 60);
    }, { root, rootMargin: '100px 0px' });
    for (const row of root.querySelectorAll('[data-message-id]')) observer.observe(row);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [listedIds, draftsSelected, showDetail, onVisibleMessages]);
  function listDate(message: ImapMessage): string | undefined {
    const value = dateBasis === 'received' ? message.receivedAt : message.date;
    return value && !Number.isNaN(new Date(value).getTime()) ? value : undefined;
  }
  function listDateGroup(message: ImapMessage): string {
    const value = listDate(message);
    return value ? dateGroup(value) : dateBasis === 'received' ? 'Empfangszeit unbekannt' : 'Absenderdatum unbekannt';
  }

  function chooseMessage(id: string) { onSelect(id); setShowDetail(true); }
  function updateQuery(value: string) { if (draftsSelected) onFolder(selectedFolder); setQuery(value); }
  function submitSearch() { if (query.trim()) onSearch?.(query.trim()); else onClearSearch?.(); }
  function clearSearch() { setQuery(''); onClearSearch?.(); }
  async function downloadAttachment(message: ImapMessage, index: number) {
    if (!onDownloadAttachment || downloading) return;
    setActionError(''); setDownloading({ messageId: message.id, index });
    try { await onDownloadAttachment(message, index); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Der Anhang konnte nicht heruntergeladen werden.'); }
    finally { setDownloading(undefined); }
  }
  async function toggleRead(message: ImapMessage) {
    if (!onToggleRead || marking) return;
    setActionError(''); setMarking(message.id);
    try { await onToggleRead(message); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Der Gelesen-Status konnte nicht geändert werden.'); }
    finally { setMarking(undefined); }
  }
  const folderButton = (folder: ImapFolder) => {
    const { label, Icon } = folderDisplay(folder);
    return <button key={folder.path} type="button" className={!draftsSelected && folder.path === selectedFolder ? 'selected' : ''} aria-current={!draftsSelected && folder.path === selectedFolder ? 'page' : undefined} disabled={loading || !folder.selectable} title={folder.selectable ? folder.path : `${folder.path} (nicht auswählbar)`} onClick={() => onFolder(folder.path)}><Icon size={16} /><span>{label}</span></button>;
  };
  const accountChoice = <select aria-label="Mailkonto" value={selectedAccountId} onChange={event => onAccount(event.target.value)} disabled={loading || !accounts.length}>
    {!accounts.length && <option value="">Kein Konto eingerichtet</option>}
    {accounts.map(account => <option key={account.id} value={account.id}>{account.name || account.email} · {account.email}</option>)}
  </select>;
  const folderChoice = <select aria-label="Mailordner" value={draftsSelected ? '__local_drafts__' : selectedFolder} onChange={event => event.target.value === '__local_drafts__' ? onDrafts() : onFolder(event.target.value)} disabled={loading}>
    {!folders.length && <option value="">Keine Ordner</option>}
    <option value="__local_drafts__">Lokale Entwürfe</option>
    {folders.map(folder => <option key={folder.path} value={folder.path} disabled={!folder.selectable}>{folderDisplay(folder).label}</option>)}
  </select>;

  return <div className={`imap-mail${showDetail && selected && !draftsSelected ? ' imap-mail--detail' : ''}${draftsSelected ? ' imap-mail--drafts' : ''}`}>
    <header className="imap-app-header">
      <div className="imap-app-identity"><Mail size={19} /><strong>Mail</strong><span>{currentAccount?.name || 'Dein Postfach'}</span></div>
      <form className="imap-search" role="search" onSubmit={event => { event.preventDefault(); submitSearch(); }}><Search size={17} aria-hidden="true" /><input type="search" aria-label={onSearch ? "Postfach durchsuchen" : "Geladene Nachrichten durchsuchen"} placeholder={onSearch ? "Mails im Postfach suchen" : "Geladene Mails durchsuchen"} value={query} onChange={event => updateQuery(event.target.value)} />{query && <button type="button" onClick={clearSearch} aria-label="Suche löschen" title="Suche löschen"><X size={15} /></button>}<button type="submit" aria-label="Mails suchen" title="Mails suchen"><Search size={15} /></button></form>
      <button className="imap-header-settings" type="button" onClick={onSettings} aria-label="Mailkonten verwalten" title="Mailkonten verwalten"><Settings size={18} /></button>
    </header>
    <div className="imap-commandbar" role="toolbar" aria-label="Mailaktionen">
      <button type="button" className="imap-compose" onClick={onCompose ?? onSettings}><PenLine size={16} /><span>{onCompose ? 'Neue Nachricht' : 'Konto hinzufügen'}</span></button>
      {!draftsSelected && selected && <>
        <span className="imap-command-divider" />
        {onReply && <button type="button" className="imap-reply" disabled={!selected.bodyLoaded || bodyLoading} onClick={() => onReply(selected)} title="Antwortentwurf öffnen"><Reply size={16} /><span>Antworten</span></button>}
        {onToggleRead && <button type="button" disabled={!!marking || loading} onClick={() => void toggleRead(selected)} title={selected.read ? 'Als ungelesen markieren' : 'Als gelesen markieren'} aria-label={selected.read ? 'Als ungelesen markieren' : 'Als gelesen markieren'}>{selected.read ? <MailOpen size={16} /> : <MailCheck size={16} />}<span>{marking === selected.id ? 'Wird geändert …' : selected.read ? 'Ungelesen' : 'Gelesen'}</span></button>}
      </>}
      <button type="button" disabled={loading || !selectedAccountId} onClick={onRefresh} title="Postfach aktualisieren" aria-label="Postfach aktualisieren"><RefreshCw size={16} className={loading ? 'imap-spin' : ''} /><span>Aktualisieren</span></button>
      <details className="imap-more"><summary aria-label="Weitere Mailaktionen" title="Weitere Mailaktionen"><MoreHorizontal size={19} /></summary><div><button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onDrafts(); }}><FileText size={15} />Lokale Entwürfe</button><button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onSettings(); }}><Settings size={15} />Konten verwalten</button></div></details>
      <span className="imap-command-account" title={currentAccount?.email}>{currentAccount?.email}</span>
    </div>
    {queryControls}
    <div className="imap-mail-body">
      <aside className="imap-sidebar" aria-label="Mailkonto und Ordner">
        <div className="imap-account">{accounts.length > 1 ? accountChoice : <div className="imap-account-single" title={currentAccount ? `${currentAccount.name} · ${currentAccount.email}` : 'Konto hinzufügen'}><span className="imap-account-avatar" aria-hidden="true">{initials(currentAccount?.name || currentAccount?.email || 'Mail')}</span><strong>{currentAccount?.name || currentAccount?.email || 'Kein Konto'}</strong><span className="imap-account-address">{currentAccount?.email || 'Konto hinzufügen'}</span></div>}</div>
        <nav className="imap-folders" aria-label="Mailordner">
          <span className="imap-section-heading">ORDNER</span>
          {primaryFolders.map(folderButton)}
          <button type="button" className={draftsSelected ? 'selected' : ''} aria-current={draftsSelected ? 'page' : undefined} onClick={onDrafts} title="Auf diesem Gerät gespeicherte Entwürfe"><FileText size={16} /><span>Lokale Entwürfe</span>{draftCount > 0 && <small>{draftCount}</small>}</button>
          {otherFolders.length > 0 && <span className="imap-section-heading imap-extra-heading">WEITERE ORDNER</span>}
          {otherFolders.map(folderButton)}
          {!folders.length && !loading && <p>Keine Ordner geladen.</p>}
        </nav>
        <div className="imap-sidebar-footer"><span className={`imap-connection-dot${error ? ' has-error' : ''}`} /><span>{loading ? 'Wird aktualisiert …' : error ? 'Verbindung prüfen' : accounts.length ? 'IMAP-Postfach' : 'Noch kein Konto'}</span></div>
      </aside>
      <div className="imap-mobile-controls">{accountChoice}{folderChoice}</div>
      {draftsSelected ? <div className="imap-drafts-panel">{draftsView}</div> : <>
        <section className="imap-list-panel" aria-label="Nachrichtenliste">
          <header className="imap-list-header"><div><h2 title={searchState ? searchState.scope : folderName}>{searchState ? searchState.title || 'Suchergebnisse' : folderName}</h2>{(searchState || filtering) && <p title={searchState ? `${messages.length} Nachrichten geladen · ${searchState.scope}${searchState.complete === false || searchState.countExact === false ? ' · Teilergebnis' : ''}` : `${filteredMessages.length} Treffer in ${messages.length} geladenen Nachrichten`}>{searchState ? `${messages.length} geladen${searchState.complete === false || searchState.countExact === false ? ' · Teilergebnis' : ''}` : `${filteredMessages.length} Treffer`}</p>}</div><span className="imap-count" title={searchState ? `${resultCount} Treffer insgesamt` : `${filtering ? filteredMessages.length : messages.length} Nachrichten geladen`}>{searchState ? resultCount : filtering ? filteredMessages.length : messages.length}</span></header>
          {searchState && <div className="imap-search-result-bar"><button type="button" onClick={clearSearch}><ArrowLeft size={13} /> Zum Ordner</button><span title={searchState.query || searchState.description}>{searchState.query ? `„${searchState.query}“` : searchState.description || 'Serverfilter'}</span><details className="imap-result-details"><summary>Umfang</summary><p>{searchState.scope}</p></details></div>}
          <div className="imap-list-filters" aria-label="Nachrichtenfilter"><div className="imap-list-tabs"><button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>Alle</button><button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Ungelesen</button></div><button type="button" className="imap-attachment-filter" aria-pressed={attachmentsOnly} onClick={() => setAttachmentsOnly(value => !value)} title="Nur Nachrichten mit Anhang" aria-label="Mit Anhang"><Paperclip size={15} /></button></div>
          {filtering && !searchState && <p className="imap-search-scope">In {messages.length} geladenen Nachrichten. {onSearch ? "Enter durchsucht das Postfach auf dem Server." : "Texte werden beim Öffnen geladen."}</p>}
          {searchState && (unreadOnly || attachmentsOnly) && <p className="imap-search-scope">Ansichtsfilter: {filteredMessages.length} von {messages.length} geladenen Treffern. Für eine vollständige Zählung „Filter & Anzahl“ verwenden.</p>}
          {error && <div className="imap-error" role="alert">{error}</div>}
          {(loading || searchState?.loading) && <p className="imap-list-status" role="status">{searchState?.loading ? "Postfach wird durchsucht …" : "Nachrichten werden geladen …"}</p>}
          {!loading && !error && messages.length === 0 && <p className="imap-list-status">{searchState ? 'Keine passenden Nachrichten gefunden.' : accounts.length ? 'Keine Nachrichten in diesem Ordner.' : 'Richte ein Mailkonto ein, um Nachrichten zu laden.'}</p>}
          {!loading && !error && messages.length > 0 && filtering && filteredMessages.length === 0 && <p className="imap-list-status" role="status">Keine Treffer in den geladenen Nachrichten.</p>}
          <div className="imap-message-list" ref={messageList}>
            {filteredMessages.map((message, index) => {
              const value = listDate(message), label = dateBasis === 'received' ? 'Empfangszeit' : 'Absenderdatum';
              const preview = (message.preview || (message.bodyLoaded ? message.bodyText : '')).replace(/\s+/g, ' ').trim();
              return <Fragment key={message.id}>{(index === 0 || listDateGroup(filteredMessages[index - 1]) !== listDateGroup(message)) && <div className="imap-date-group" title={label}>{listDateGroup(message)}</div>}<button type="button" className={`imap-message-row${message.id === selectedMessageId ? ' selected' : ''}${!message.read ? ' unread' : ''}`} data-message-id={message.id} aria-pressed={message.id === selectedMessageId} draggable onDragStart={event => writeMailDrag(event.dataTransfer, message.id)} title="Zum Referenzieren in den Chat ziehen" onClick={() => chooseMessage(message.id)}>
                <span className="imap-row-unread">{!message.read && <span className="imap-unread-dot" aria-label="Ungelesen" />}</span><span className="imap-message-content"><span className="imap-message-top"><strong>{senderName(message.from)}</strong><time dateTime={value} title={value ? `${label}: ${formatDate(value, true)}` : `${label} unbekannt`}>{value ? formatDate(value) : 'Unbekannt'}</time></span><span className="imap-message-subject-line"><span className="imap-message-subject">{message.subject || '(Kein Betreff)'}</span>{message.attachments.length > 0 && <span className="imap-message-flags" title={`${message.attachments.length} ${message.attachments.length === 1 ? 'Anhang' : 'Anhänge'}`}><Paperclip size={12} aria-label="Mit Anhang"/><span>{message.attachments.length}</span></span>}</span>{preview && <span className="imap-message-preview">{preview}</span>}</span>
              </button></Fragment>;
            })}
            {hasMore && onLoadMore && <button type="button" className="imap-load-more" disabled={loading || loadingMore} onClick={onLoadMore}>{loadingMore ? 'Wird geladen …' : 'Ältere Nachrichten laden'}</button>}
          </div>
          <footer className="imap-memory-note" title="Es werden höchstens 500 Nachrichten gleichzeitig angezeigt."><Mail size={12} /><span>{messages.length} geladen · Sitzungsspeicher</span></footer>
        </section>
        <section className="imap-detail" aria-label="Geöffnete Nachricht">
          <div className="imap-detail-header"><button className="imap-back" type="button" onClick={() => setShowDetail(false)}><ArrowLeft size={15} /> Nachrichten</button><span>{selected ? 'Lesebereich' : 'Keine Nachricht ausgewählt'}</span>{selected && <button type="button" className="imap-details-toggle" aria-expanded={showDetails} onClick={() => setShowDetails(value => !value)}>Details <ChevronDown size={14} className={showDetails ? 'expanded' : ''} /></button>}</div>
          {selected ? <div className="imap-detail-scroll"><article className="imap-detail-body">
            {(actionError || error) && <p className="imap-error imap-action-error" role="alert">{actionError || error}</p>}
            <h2 draggable onDragStart={event => writeMailDrag(event.dataTransfer, selected.id)} title="Zum Referenzieren in den Chat ziehen">{selected.subject || '(Kein Betreff)'}</h2>
            <div className="imap-sender-line"><div className="imap-avatar" aria-hidden="true">{initials(selected.from)}</div><div className="imap-sender"><strong>{senderName(selected.from)}</strong><small title={selected.from}>{senderAddress(selected.from)}</small></div><time dateTime={selected.date} title="Absenderdatum">{formatDate(selected.date, true)}</time></div>
            <div className="imap-recipient-line"><span>An</span><span title={selected.to}>{selected.to || 'Empfänger nicht angegeben'}</span></div>
            {showDetails && <dl className="imap-metadata"><div><dt>Von</dt><dd>{selected.from}</dd></div><div><dt>An</dt><dd>{selected.to || 'Nicht angegeben'}</dd></div>{selected.cc && <div><dt>CC</dt><dd>{selected.cc}</dd></div>}<div><dt>Konto</dt><dd>{selectedAccount?.email}</dd></div>{selected.folder && <div><dt>Ordner</dt><dd>{selected.folder}</dd></div>}{selected.receivedAt && <div><dt>Eingegangen</dt><dd>{formatDate(selected.receivedAt, true)}</dd></div>}{selected.messageId && <div><dt>Nachrichten-ID</dt><dd>{selected.messageId}</dd></div>}</dl>}
            {selected.attachments.length > 0 && <div className="imap-attachments"><h3><Paperclip size={13} />{selected.attachments.length} {selected.attachments.length === 1 ? 'Anhang' : 'Anhänge'}</h3><div className="imap-attachment-list">{selected.attachments.map((attachment, index) => <div className="imap-attachment" key={`${attachment.name}-${index}`}><FileText size={20} /><div><span>{attachment.name || 'Anhang'}</span><small>{formatSize(attachment.size)}</small></div>{onDownloadAttachment && <button type="button" disabled={!!downloading || loading} onClick={() => void downloadAttachment(selected, index)} aria-label={`${attachment.name || 'Anhang'} herunterladen`} title="Anhang herunterladen"><Download size={16} />{downloading?.messageId === selected.id && downloading.index === index && <span>Wird geladen …</span>}</button>}</div>)}</div></div>}
            {selected.bodyLoaded && !bodyLoading && selected.bodyHtml?.trim() && <div className="mail-reader-controls" aria-label="Leseansicht">
              <div className="mail-reader-format" role="group" aria-label="Darstellung der Nachricht">
                <button type="button" aria-pressed={useHtml} disabled={!onDisplay || !!displayBusy} onClick={() => void changeDisplay({ format: 'html' })}>HTML</button>
                <button type="button" aria-pressed={!useHtml} disabled={!onDisplay || !!displayBusy} onClick={() => void changeDisplay({ format: 'text' })}>Text</button>
              </div>
              {useHtml && ((remoteCount?.id === selected.id && remoteCount.count > 0) || remoteImages) && <button type="button" className="mail-reader-images" disabled={!onDisplay || !!displayBusy} onClick={() => void changeDisplay({ remoteImages: !remoteImages })}>{remoteImages ? 'Externe Bilder ausblenden' : `Externe Bilder laden${remoteCount?.id === selected.id ? ` (${remoteCount.count})` : ''}`}</button>}
              {useHtml && <p className="mail-reader-note">{remoteImages ? 'Externe Bilder sind für diese Nachricht freigegeben.' : 'Externe Bilder sind blockiert. Beim Laden kann der Absender den Abruf erkennen.'}</p>}
            </div>}
            {bodyLoading ? <div className="imap-body-text" role="status">Nachricht wird geladen …</div> : selected.bodyLoaded ? useHtml ? <HtmlMailBody key={selected.id} html={selected.bodyHtml!} remoteImages={remoteImages} inlineImages={selected.inlineImages} onRemoteImagesCount={count => setRemoteCount(current => current?.id === selected.id && current.count === count ? current : { id: selected.id, count })} onOpenLink={onOpenLink ? url => onOpenLink(selected.id, url) : undefined} /> : <div className="imap-body-text">{selected.bodyText || 'Für diese Nachricht ist kein Text verfügbar.'}</div> : <div className="imap-body-text">Nachricht konnte nicht geladen werden. Erneut auswählen zum Wiederholen.</div>}
            {(useHtml ? selected.htmlTruncated : selected.truncated) && <p className="imap-truncated">Diese Nachricht wurde nur teilweise geladen.</p>}
            {onReply && selected.bodyLoaded && !bodyLoading && <div className="imap-message-footer"><button type="button" onClick={() => onReply(selected)}><Reply size={16} />Antworten</button><span>Zum Referenzieren kannst du diese Mail in den Chat ziehen.</span></div>}
          </article></div> : <div className="imap-detail-empty"><span><Mail size={30} /></span><strong>Deine Nachrichten im Blick</strong><p>Wähle links eine Mail aus, um sie hier zu lesen.</p><small>Mails lassen sich direkt in den OVD-Chat ziehen.</small></div>}
        </section>
      </>}
    </div>
  </div>;
}

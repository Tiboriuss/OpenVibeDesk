import { useUiLocale } from '../../../src/locale';
import { mailText } from './mail-locale';
import { mailFormat } from './mail-format';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, Download, FileText, Mail, MailCheck, MailOpen, MoreHorizontal, Paperclip, PenLine, RefreshCw, Reply, Search, Settings, X } from 'lucide-react';
import type { ImapFolder, ImapMessage, MailAccountSummary } from '../../../shared/mail';
import { HtmlMailBody } from './HtmlMailBody';
import { MailTextReader } from './MailTextReader';
import { writeMailDrag } from '../../../src/mail-reference';
import './imap-mail.css';

type Props = {
  largeText: boolean;
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
  textReadRequest?: { emailId: string; cursor?: string; limit?: number; version: number };
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

export function ImapMailView({ largeText, accounts, folders, messages, dateBasis = 'sent', selectedAccountId, selectedFolder, selectedMessageId, focusVersion = 0, loading, loadingMore = false, bodyLoading = false, textReadRequest, error, hasMore = false, onAccount, onFolder, onSelect, onVisibleMessages, onRefresh, onLoadMore, onSettings, onSearch, searchState, queryControls, onClearSearch, onCompose, onReply, onDownloadAttachment, onToggleRead, onDisplay, onOpenLink, onDrafts, draftCount, draftsSelected = false, draftsView }: Props) {
  const locale = useUiLocale();
  const copy = mailText[locale];
  const { formatDate, dateGroup, formatSize, senderName, senderAddress, initials, folderDisplay } = mailFormat[locale];
  const [showDetail, setShowDetail] = useState(false);
  const [readerTarget, setReaderTarget] = useState<{ emailId: string; cursor?: string; limit?: number; version?: number }>();
  const textReaderId = readerTarget?.emailId;
  useEffect(() => { setReaderTarget(textReadRequest?.emailId === selectedMessageId ? textReadRequest : undefined); }, [selectedMessageId, textReadRequest]);
  const [showDetails, setShowDetails] = useState(false);
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [attachmentsOnly, setAttachmentsOnly] = useState(false);
  const searchAction = useRef(onSearch); searchAction.current = onSearch;
  const clearSearchAction = useRef(onClearSearch); clearSearchAction.current = onClearSearch;
  const messageList = useRef<HTMLDivElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const returnFocusToList = useRef(false);
  const moreMenu = useRef<HTMLDetailsElement>(null);
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
    catch (reason) { setActionError(reason instanceof Error ? reason.message : copy.readerError); }
    finally { setDisplayBusy(current => current === id ? undefined : current); }
  };
  const currentAccount = accounts.find(account => account.id === selectedAccountId);
  const selectedAccount = accounts.find(account => account.id === selected?.accountId) ?? currentAccount;
  const resultCount = searchState ? `${searchState.countExact === false ? copy.atLeast + " " : ''}${searchState.total}${searchState.countExact === undefined && searchState.hasMore ? '+' : ''}` : '';
  const currentFolder = folders.find(folder => folder.path === selectedFolder);
  const folderName = currentFolder ? folderDisplay(currentFolder).label : selectedFolder || copy.mailbox;
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
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (moreMenu.current?.open && !moreMenu.current.contains(event.target as Node)) moreMenu.current.open = false; };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !moreMenu.current?.open) return;
      event.preventDefault(); moreMenu.current.open = false; moreMenu.current.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, []);
  const filteredMessages = useMemo(() => {
    const words = searchState ? [] : query.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean);
    return messages.filter(message => {
      if (unreadOnly && message.read) return false;
      if (attachmentsOnly && !message.attachments.length) return false;
      const content = `${message.from}\n${message.to}\n${message.subject}\n${message.preview ?? ''}\n${message.bodyText}`.toLocaleLowerCase(locale);
      return words.every(word => content.includes(word));
    });
  }, [messages, query, unreadOnly, attachmentsOnly, searchState, locale]);
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
    return value ? dateGroup(value) : dateBasis === 'received' ? copy.missingReceivedDate : copy.missingSentDate;
  }

  useLayoutEffect(() => {
    if (showDetail && backButton.current?.getClientRects().length) {
      backButton.current.focus({ preventScroll: true });
    } else if (!showDetail && returnFocusToList.current) {
      returnFocusToList.current = false;
      const row = messageList.current?.querySelector<HTMLButtonElement>('.imap-message-row.selected');
      (row ?? listHeading.current)?.focus({ preventScroll: true });
    }
  }, [showDetail, selected?.id]);

  function returnToList() {
    returnFocusToList.current = true;
    setShowDetail(false);
  }
  function chooseMessage(id: string) { onSelect(id); setShowDetail(true); }
  function updateQuery(value: string) { if (draftsSelected) onFolder(selectedFolder); setQuery(value); }
  function submitSearch() { if (query.trim()) onSearch?.(query.trim()); else onClearSearch?.(); }
  function clearSearch() { setQuery(''); onClearSearch?.(); }
  async function downloadAttachment(message: ImapMessage, index: number) {
    if (!onDownloadAttachment || downloading) return;
    setActionError(''); setDownloading({ messageId: message.id, index });
    try { await onDownloadAttachment(message, index); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : copy.downloadFailed); }
    finally { setDownloading(undefined); }
  }
  async function toggleRead(message: ImapMessage) {
    if (!onToggleRead || marking) return;
    setActionError(''); setMarking(message.id);
    try { await onToggleRead(message); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : copy.readFailed); }
    finally { setMarking(undefined); }
  }
  const folderButton = (folder: ImapFolder) => {
    const { label, Icon } = folderDisplay(folder);
    return <button key={folder.path} type="button" className={!draftsSelected && folder.path === selectedFolder ? 'selected' : ''} aria-current={!draftsSelected && folder.path === selectedFolder ? 'page' : undefined} disabled={loading || !folder.selectable} title={folder.selectable ? folder.path : copy.unavailableFolder(folder.path)} onClick={() => onFolder(folder.path)}><Icon size={16} /><span>{label}</span></button>;
  };
  const accountChoice = <select aria-label={copy.accountLabel} value={selectedAccountId} onChange={event => onAccount(event.target.value)} disabled={loading || !accounts.length}>
    {!accounts.length && <option value="">{copy.noAccountConfigured}</option>}
    {accounts.map(account => <option key={account.id} value={account.id}>{account.name || account.email} · {account.email}</option>)}
  </select>;
  const folderChoice = <select aria-label={copy.folderLabel} value={draftsSelected ? '__local_drafts__' : selectedFolder} onChange={event => event.target.value === '__local_drafts__' ? onDrafts() : onFolder(event.target.value)} disabled={loading}>
    {!folders.length && <option value="">{copy.noFolders}</option>}
    <option value="__local_drafts__">{copy.localDrafts}</option>
    {folders.map(folder => <option key={folder.path} value={folder.path} disabled={!folder.selectable}>{folderDisplay(folder).label}</option>)}
  </select>;

  return <div className={`imap-mail${showDetail && selected && !draftsSelected ? ' imap-mail--detail' : ''}${draftsSelected ? ' imap-mail--drafts' : ''}`}>
    <header className="imap-app-header">
      <div className="imap-app-identity"><Mail size={19} /><strong>Mail</strong><span>{currentAccount?.name || copy.yourMailbox}</span></div>
      <form className="imap-search" role="search" onSubmit={event => { event.preventDefault(); submitSearch(); }}><Search size={17} aria-hidden="true" /><input type="search" aria-label={onSearch ? copy.searchMailbox : copy.searchLoaded} placeholder={onSearch ? copy.searchPlaceholder : copy.searchLoadedPlaceholder} value={query} onChange={event => updateQuery(event.target.value)} />{query && <button type="button" onClick={clearSearch} aria-label={copy.clearSearch} title={copy.clearSearch}><X size={15} /></button>}<button type="submit" aria-label={copy.searchMail} title={copy.searchMail}><Search size={15} /></button></form>
      <button className="imap-header-settings" type="button" onClick={onSettings} aria-label={copy.manageMailAccounts} title={copy.manageMailAccounts}><Settings size={18} /></button>
    </header>
    <div className="imap-commandbar" role="toolbar" aria-label={copy.mailActions}>
      <button type="button" className="imap-compose" onClick={onCompose ?? onSettings}><PenLine size={16} /><span>{onCompose ? copy.newMessage : copy.addAccount}</span></button>
      {!draftsSelected && selected && <>
        <span className="imap-command-divider" />
        {onReply && <button type="button" className="imap-reply" disabled={!selected.bodyLoaded || bodyLoading} onClick={() => onReply(selected)} title={copy.openReply}><Reply size={16} /><span>{copy.replyAction}</span></button>}
        {onToggleRead && <button type="button" disabled={!!marking || loading} onClick={() => void toggleRead(selected)} title={selected.read ? copy.markUnread : copy.markRead} aria-label={selected.read ? copy.markUnread : copy.markRead}>{selected.read ? <MailOpen size={16} /> : <MailCheck size={16} />}<span>{marking === selected.id ? copy.updating : selected.read ? copy.unread : copy.read}</span></button>}
      </>}
      <button type="button" disabled={loading || !selectedAccountId} onClick={onRefresh} title={copy.refreshMailbox} aria-label={copy.refreshMailbox}><RefreshCw size={16} className={loading ? 'imap-spin' : ''} /><span>{copy.refresh}</span></button>
      <details ref={moreMenu} className="imap-more" onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}><summary aria-label={copy.moreActions} title={copy.moreActions}><MoreHorizontal size={19} /></summary><div><button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onDrafts(); }}><FileText size={15} />{copy.localDrafts}</button><button type="button" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); onSettings(); }}><Settings size={15} />{copy.manageAccounts}</button></div></details>
      <span className="imap-command-account" title={currentAccount?.email}>{currentAccount?.email}</span>
    </div>
    {queryControls}
    <div className="imap-mail-body">
      <aside className="imap-sidebar" aria-label={copy.accountAndFolders}>
        <div className="imap-account">{accounts.length > 1 ? accountChoice : <div className="imap-account-single" title={currentAccount ? `${currentAccount.name} · ${currentAccount.email}` : copy.addAccount}><span className="imap-account-avatar" aria-hidden="true">{initials(currentAccount?.name || currentAccount?.email || 'Mail')}</span><strong>{currentAccount?.name || currentAccount?.email || copy.noAccount}</strong><span className="imap-account-address">{currentAccount?.email || copy.addAccount}</span></div>}</div>
        <nav className="imap-folders" aria-label={copy.folderLabel}>
          <span className="imap-section-heading">{copy.foldersHeading}</span>
          {primaryFolders.map(folderButton)}
          <button type="button" className={draftsSelected ? 'selected' : ''} aria-current={draftsSelected ? 'page' : undefined} onClick={onDrafts} title={copy.localDraftsHint}><FileText size={16} /><span>{copy.localDrafts}</span>{draftCount > 0 && <small>{draftCount}</small>}</button>
          {otherFolders.length > 0 && <span className="imap-section-heading imap-extra-heading">{copy.moreFoldersHeading}</span>}
          {otherFolders.map(folderButton)}
          {!folders.length && !loading && <p>{copy.foldersEmpty}</p>}
        </nav>
        {(loading || error) && <div className="imap-sidebar-footer" role="status"><span className={`imap-connection-dot${error ? ' has-error' : ''}`} /><span>{loading ? copy.refreshing : copy.errorOccurred}</span></div>}
      </aside>
      <div className="imap-mobile-controls">{accountChoice}{folderChoice}</div>
      {draftsSelected ? <div className="imap-drafts-panel">{draftsView}</div> : <>
        <section className="imap-list-panel" aria-label={copy.messageList}>
          <header className="imap-list-header"><div><h2 ref={listHeading} tabIndex={-1} title={searchState ? searchState.scope : folderName}>{searchState ? searchState.title || copy.searchResults : folderName}</h2>{(searchState || filtering) && <p title={searchState ? `${copy.loadedCount(messages.length)} · ${searchState.scope}${searchState.complete === false || searchState.countExact === false ? " " + copy.partialResult : ''}` : copy.matchesIn(filteredMessages.length, messages.length)}>{searchState ? `${copy.shortLoaded(messages.length)}${searchState.complete === false || searchState.countExact === false ? " " + copy.partialResult : ''}` : copy.matchCount(filteredMessages.length)}</p>}</div><span className="imap-count" title={searchState ? copy.totalMatches(resultCount) : copy.loadedCount(filtering ? filteredMessages.length : messages.length)}>{searchState ? resultCount : filtering ? filteredMessages.length : messages.length}</span></header>
          {searchState && <div className="imap-search-result-bar"><button type="button" onClick={clearSearch}><ArrowLeft size={13} /> {copy.backToFolder}</button><span title={searchState.query || searchState.description}>{searchState.query ? `„${searchState.query}“` : searchState.description || copy.serverFilter}</span><details className="imap-result-details"><summary>{copy.scope}</summary><p>{searchState.scope}</p></details></div>}
          <div className="imap-list-filters" aria-label={copy.messageFilters}><div className="imap-list-tabs"><button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>{copy.all}</button><button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>{copy.unread}</button></div><button type="button" className="imap-attachment-filter" aria-pressed={attachmentsOnly} onClick={() => setAttachmentsOnly(value => !value)} title={copy.attachmentsOnly} aria-label={copy.hasAttachment}><Paperclip size={15} /></button></div>
          {filtering && !searchState && <p className="imap-search-scope">{filteredMessages.length} {copy.of} {messages.length} {copy.loadedMessages}{query.trim() && onSearch ? " " + copy.enterToSearch : ''}</p>}
          {searchState && (unreadOnly || attachmentsOnly) && <p className="imap-search-scope">{filteredMessages.length} {copy.of} {messages.length} {copy.loadedMatches}</p>}
          {error && <div className="imap-error" role="alert">{error}</div>}
          {(loading || searchState?.loading) && <p className="imap-list-status" role="status">{searchState?.loading ? copy.searching : copy.loadingMessages}</p>}
          {!loading && !error && messages.length === 0 && <p className="imap-list-status">{searchState ? copy.noMatches : accounts.length ? copy.emptyFolder : copy.setupToLoad}</p>}
          {!loading && !error && messages.length > 0 && filtering && filteredMessages.length === 0 && <p className="imap-list-status" role="status">{copy.emptyFiltered}</p>}
          <div className="imap-message-list" ref={messageList}>
            {filteredMessages.map((message, index) => {
              const value = listDate(message), label = dateBasis === 'received' ? copy.receivedTime : copy.sentDate;
              const preview = (message.preview || (message.bodyLoaded ? message.bodyText : '')).replace(/\s+/g, ' ').trim();
              return <Fragment key={message.id}>{(index === 0 || listDateGroup(filteredMessages[index - 1]) !== listDateGroup(message)) && <div className="imap-date-group" title={label}>{listDateGroup(message)}</div>}<button type="button" className={`imap-message-row${message.id === selectedMessageId ? ' selected' : ''}${!message.read ? ' unread' : ''}`} data-message-id={message.id} aria-pressed={message.id === selectedMessageId} draggable onDragStart={event => writeMailDrag(event.dataTransfer, message.id)} title={copy.dragHint} onClick={() => chooseMessage(message.id)}>
                <span className="imap-row-unread">{!message.read && <span className="imap-unread-dot" aria-label={copy.unread} />}</span><span className="imap-message-content"><span className="imap-message-top"><strong>{senderName(message.from)}</strong><time dateTime={value} title={value ? `${label}: ${formatDate(value, true)}` : copy.unknownDate(label)}>{value ? formatDate(value) : copy.unknown}</time></span><span className="imap-message-subject-line"><span className="imap-message-subject">{message.subject || copy.noSubject}</span>{message.attachments.length > 0 && <span className="imap-message-flags" title={`${message.attachments.length} ${message.attachments.length === 1 ? copy.attachment : copy.attachments}`}><Paperclip size={12} aria-label={copy.hasAttachment}/><span>{message.attachments.length}</span></span>}</span>{preview && <span className="imap-message-preview">{preview}</span>}</span>
              </button></Fragment>;
            })}
            {hasMore && onLoadMore && <button type="button" className="imap-load-more" disabled={loading || loadingMore} onClick={onLoadMore}>{loadingMore ? copy.loading : copy.loadOlder}</button>}
          </div>
        </section>
        <section className="imap-detail" aria-label={copy.openMessage}>
          <div className="imap-detail-header"><button ref={backButton} className="imap-back" type="button" onClick={returnToList}><ArrowLeft size={15} /> {copy.messages}</button><span>{selected ? copy.reader : copy.noSelection}</span>{selected && <button type="button" className="imap-details-toggle" aria-expanded={showDetails} onClick={() => setShowDetails(value => !value)}>Details <ChevronDown size={14} className={showDetails ? 'expanded' : ''} /></button>}</div>
          {selected ? <div key={selected.id} className="imap-detail-scroll"><article className="imap-detail-body">
            {(actionError || error) && <p className="imap-error imap-action-error" role="alert">{actionError || error}</p>}
            <h2 draggable onDragStart={event => writeMailDrag(event.dataTransfer, selected.id)} title={copy.dragHint}>{selected.subject || copy.noSubject}</h2>
            <div className="imap-sender-line"><div className="imap-avatar" aria-hidden="true">{initials(selected.from)}</div><div className="imap-sender"><strong>{senderName(selected.from)}</strong><small title={selected.from}>{senderAddress(selected.from)}</small></div><time dateTime={selected.date} title={copy.sentDate}>{formatDate(selected.date, true)}</time></div>
            <div className="imap-recipient-line"><span>{copy.to}</span><span title={selected.to}>{selected.to || copy.noRecipientSpecified}</span></div>
            {showDetails && <dl className="imap-metadata"><div><dt>{copy.from}</dt><dd>{selected.from}</dd></div><div><dt>{copy.to}</dt><dd>{selected.to || copy.unspecified}</dd></div>{selected.cc && <div><dt>CC</dt><dd>{selected.cc}</dd></div>}<div><dt>{copy.account}</dt><dd>{selectedAccount?.email}</dd></div>{selected.folder && <div><dt>{copy.folder}</dt><dd>{selected.folder}</dd></div>}{selected.receivedAt && <div><dt>{copy.received}</dt><dd>{formatDate(selected.receivedAt, true)}</dd></div>}{selected.messageId && <div><dt>{copy.messageId}</dt><dd>{selected.messageId}</dd></div>}</dl>}
            {selected.attachments.length > 0 && <div className="imap-attachments"><h3><Paperclip size={13} />{selected.attachments.length} {selected.attachments.length === 1 ? copy.attachment : copy.attachments}</h3><div className="imap-attachment-list">{selected.attachments.map((attachment, index) => <div className="imap-attachment" key={`${attachment.name}-${index}`}><FileText size={20} /><div><span>{attachment.name || copy.attachment}</span><small>{formatSize(attachment.size)}</small></div>{onDownloadAttachment && <button type="button" disabled={!!downloading || loading} onClick={() => void downloadAttachment(selected, index)} aria-label={copy.downloadNamed(attachment.name || copy.attachment)} title={copy.download}><Download size={16} />{downloading?.messageId === selected.id && downloading.index === index && <span>{copy.loading}</span>}</button>}</div>)}</div></div>}
            {textReaderId !== selected.id && selected.bodyLoaded && !bodyLoading && selected.bodyHtml?.trim() && <div className="mail-reader-controls" aria-label={copy.readingMode}>
              <div className="mail-reader-format" role="group" aria-label={copy.messageFormat}>
                <button type="button" aria-pressed={useHtml} disabled={!onDisplay || !!displayBusy} onClick={() => void changeDisplay({ format: 'html' })}>HTML</button>
                <button type="button" aria-pressed={!useHtml} disabled={!onDisplay || !!displayBusy} onClick={() => void changeDisplay({ format: 'text' })}>Text</button>
              </div>
              {useHtml && ((remoteCount?.id === selected.id && remoteCount.count > 0) || remoteImages) && <button type="button" className="mail-reader-images" disabled={!onDisplay || !!displayBusy} title={remoteImages ? undefined : copy.externalImageHint} onClick={() => void changeDisplay({ remoteImages: !remoteImages })}>{remoteImages ? copy.hideImages : `${copy.loadImages}${remoteCount?.id === selected.id ? ` (${remoteCount.count})` : ''}`}</button>}
            </div>}
            {textReaderId === selected.id ? <MailTextReader key={`${selected.id}:${readerTarget?.version ?? 0}`} emailId={selected.id} initialCursor={readerTarget?.cursor} pageSize={readerTarget?.limit} onClose={() => setReaderTarget(undefined)}/> : bodyLoading ? <div className="imap-body-text" role="status">{copy.loadingMessage}</div> : selected.bodyLoaded ? useHtml ? <HtmlMailBody largeText={largeText} html={selected.bodyHtml!} remoteImages={remoteImages} inlineImages={selected.inlineImages} onRemoteImagesCount={count => setRemoteCount(current => current?.id === selected.id && current.count === count ? current : { id: selected.id, count })} onOpenLink={onOpenLink ? url => onOpenLink(selected.id, url) : undefined} /> : <div className="imap-body-text">{selected.bodyText || copy.noText}</div> : <div className="imap-body-text">{copy.messageRetry}</div>}
            {textReaderId !== selected.id && !bodyLoading && (useHtml ? selected.htmlTruncated : selected.truncated) && <div className="mail-text-more"><button type="button" onClick={() => setReaderTarget({ emailId: selected.id })}>{copy.readFull}</button></div>}
            {onReply && selected.bodyLoaded && !bodyLoading && <div className="imap-message-footer"><button type="button" onClick={() => onReply(selected)}><Reply size={16} />{copy.replyAction}</button></div>}
          </article></div> : <div className="imap-detail-empty"><span aria-hidden="true"><Mail size={24} /></span><p>{copy.selectMessage}</p></div>}
        </section>
      </>}
    </div>
  </div>;
}

import type { UiLocale } from '../../../shared/locale';
import { useUiLocale } from '../../../src/locale';
import { filesText } from '../files-locale';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, File, FilePlus2, Folder, FolderOpen, Home, Link2, Paperclip, Pencil, RefreshCw, Search, X } from 'lucide-react';
import type { Draft } from '../../../shared/model';
import type { FileChooseKind, FileEntry, FileListingPage, FileListRequest, FileNavigationTarget, FileReadResult } from '../../../shared/files';
import { writeModuleReferenceDrag } from '../../../shared/references';
import './files-view.css';

function sizeLabel(size: number, locale: UiLocale): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} MB`;
}
function dateLabel(value: string, locale: UiLocale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
function fileType(entry: FileEntry, locale: UiLocale): string {
  const copy = filesText[locale];
  if (entry.isDirectory) return copy.folder;
  const extension = entry.name.includes('.') ? entry.name.split('.').at(-1) : undefined;
  return extension && extension.length <= 12 ? copy.fileWithExtension(extension.toUpperCase()) : copy.file;
}
function directoryName(value: string): string {
  if (/^[A-Za-z]:[/\\]?$/.test(value)) return value;
  return value.split(/[/\\]/).filter(Boolean).at(-1) || value;
}
function breadcrumbs(listing?: FileListingPage): { title: string; path: string }[] {
  if (!listing) return [];
  const root = listing.root;
  const separator = root.includes('\\') ? '\\' : '/';
  const rootPrefix = /[/\\]$/.test(root) ? root : root + separator;
  const relative = listing.path.slice(root.length).split(/[/\\]/).filter(Boolean);
  return [{ title: root, path: root }, ...relative.map((title, index) => ({ title, path: rootPrefix + relative.slice(0, index + 1).join(separator) }))];
}

export function FilesView({ draft, onAttach }: { draft?: Draft; onAttach(file: { path: string; name: string; size: number }): void | Promise<void> }) {
  const locale = useUiLocale();
  const copy = filesText[locale];
  const [listing, setListing] = useState<FileListingPage>();
  const [loading, setLoading] = useState(true), [paging, setPaging] = useState(false);
  const [pagePosition, setPagePosition] = useState({ index: 0, offset: 0 });
  const [error, setError] = useState(''), [notice, setNotice] = useState<'' | 'referenced' | 'attached'>('');
  const [query, setQuery] = useState('');
  const [filterPending, setFilterPending] = useState(false);
  const [sort, setSort] = useState('name:asc');
  const [selected, setSelected] = useState<FileEntry>();
  const [preview, setPreview] = useState<FileReadResult>(), [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false), [previewError, setPreviewError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [editingPath, setEditingPath] = useState(false), [pathDraft, setPathDraft] = useState('');
  const browseVersion = useRef(0), previewVersion = useRef(0);
  const currentPath = useRef<string | undefined>(undefined);
  const currentQuery = useRef('');
  const currentSort = useRef<Pick<FileListRequest, 'sort' | 'direction'>>({ sort: 'name', direction: 'asc' });
  const queryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pageHistory = useRef<{ cursor?: string; offset: number }[]>([{ offset: 0 }]);
  const pagingFocus = useRef<{ button: HTMLButtonElement; version: number } | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<HTMLElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null), pathEditButtonRef = useRef<HTMLButtonElement>(null);
  const pathNavigationVersion = useRef<number | undefined>(undefined);

  function clearQueryTimer() { if (queryTimer.current) clearTimeout(queryTimer.current); queryTimer.current = undefined; }
  async function select(entry: FileEntry) {
    const version = ++previewVersion.current;
    setSelected(entry); setPreview(undefined); setPreviewText(''); setPreviewError(''); setNotice('');
    if (entry.isDirectory) { setPreviewLoading(false); return; }
    setPreviewLoading(true);
    try {
      const result = await window.workspace.filesRead({ id: entry.id });
      if (version === previewVersion.current) { setPreview(result); setPreviewText(result.text ?? ''); }
    } catch (reason) { if (version === previewVersion.current) setPreviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (version === previewVersion.current) setPreviewLoading(false); }
  }
  async function browse(path?: string, selectedId?: string, fromPathEditor = false) {
    const version = ++browseVersion.current;
    pathNavigationVersion.current = fromPathEditor ? version : undefined;
    previewVersion.current++;
    currentPath.current = path;
    setLoading(true); setPaging(false); setFilterPending(false); setError(''); setNotice('');
    setSelected(undefined); setPreview(undefined); setPreviewText(''); setPreviewError(''); setPreviewLoading(false);
    try {
      const result = await window.workspace.filesList({ path, query: currentQuery.current || undefined, ...currentSort.current, limit: 100 });
      if (version !== browseVersion.current) return;
      pageHistory.current = [{ offset: 0 }]; setPagePosition({ index: 0, offset: 0 });
      currentPath.current = result.path; setListing(result); listRef.current?.scrollTo({ top: 0 });
      if (fromPathEditor) { setEditingPath(false); setPathDraft(result.path); }
      if (selectedId) {
        const entry = result.entries.find(item => item.id === selectedId);
        if (entry) void select(entry);
        else {
          const selectionVersion = previewVersion.current;
          const detail = await window.workspace.filesRead({ id: selectedId });
          if (version !== browseVersion.current || selectionVersion !== previewVersion.current) return;
          setSelected({ id: detail.id, name: detail.name, path: detail.path, size: detail.size, modifiedAt: detail.modifiedAt, isDirectory: false });
          setPreview(detail); setPreviewText(detail.text ?? '');
        }
      }
    } catch (reason) { if (version === browseVersion.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (version === browseVersion.current) setLoading(false); if (pathNavigationVersion.current === version) pathNavigationVersion.current = undefined; }
  }
  function navigate(path?: string, selectedId?: string) {
    setEditingPath(false); clearQueryTimer(); currentQuery.current = ''; setQuery(''); void browse(path, selectedId);
  }
  function editPath() {
    setPathDraft(listing?.path ?? currentPath.current ?? ''); setEditingPath(true);
  }
  function cancelPathEdit() {
    if (pathNavigationVersion.current === browseVersion.current) { browseVersion.current++; setLoading(false); setPaging(false); }
    pathNavigationVersion.current = undefined; currentPath.current = listing?.path;
    setEditingPath(false); setError('');
    requestAnimationFrame(() => pathEditButtonRef.current?.focus());
  }
  function submitPath() {
    const path = pathDraft.trim();
    if (!path || !(/^[\/\\]/.test(path) || /^[A-Za-z]:[/\\]/.test(path) || path === '~' || /^~[/\\]/.test(path))) {
      setError(copy.absolutePath); pathInputRef.current?.focus(); return;
    }
    clearQueryTimer(); currentQuery.current = ''; setQuery(''); void browse(path, undefined, true);
  }
  useEffect(() => {
    void browse();
    const unsubscribe = window.workspace.onShowFiles((target: FileNavigationTarget | string | undefined) => {
      if (typeof target === 'string' || target === undefined) navigate(target);
      else navigate(target.path, target.selectedId);
    });
    return () => { browseVersion.current++; previewVersion.current++; clearQueryTimer(); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (editingPath) { pathInputRef.current?.focus(); pathInputRef.current?.select(); }
  }, [editingPath]);
  useEffect(() => {
    const ids = [...new Set([...(listing?.entries.map(entry => entry.id) ?? []), ...(selected ? [selected.id] : [])])];
    window.workspace.filesSetViewContext(ids);
  }, [listing, selected?.id]);
  useEffect(() => () => { window.workspace.filesSetViewContext([]); }, []);
  useEffect(() => {
    if (paging) return;
    const focused = pagingFocus.current;
    pagingFocus.current = undefined;
    if (!focused || focused.version !== browseVersion.current || !focused.button.isConnected || (document.activeElement !== document.body && document.activeElement !== focused.button)) return;
    const target = focused.button.disabled ? focused.button.parentElement?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? listRef.current?.querySelector<HTMLButtonElement>('.ovd-files-entry') : focused.button;
    target?.focus();
  }, [paging, listing]);
  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const revealCurrentFolder = () => { path.scrollLeft = path.scrollWidth; };
    revealCurrentFolder();
    const observer = new ResizeObserver(revealCurrentFolder);
    observer.observe(path);
    return () => observer.disconnect();
  }, [listing?.path, editingPath]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); editPath(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [listing?.path]);
  async function changePage(direction: -1 | 1) {
    if (!listing || paging || loading || filterPending || queryTimer.current) return;
    const index = pagePosition.index + direction;
    const target = direction === 1
      ? listing.nextCursor && { cursor: listing.nextCursor, offset: pagePosition.offset + listing.entries.length }
      : pageHistory.current[index];
    if (!target || index < 0) return;
    const version = ++browseVersion.current;
    pagingFocus.current = document.activeElement instanceof HTMLButtonElement && document.activeElement.closest('.ovd-files-pages') ? { button: document.activeElement, version } : undefined;
    setPaging(true); setError('');
    try {
      const result = await window.workspace.filesList({ path: listing.path, cursor: target.cursor, query: currentQuery.current || undefined, ...currentSort.current, limit: 100 });
      if (version !== browseVersion.current) return;
      if (direction === 1) pageHistory.current = [...pageHistory.current.slice(0, index), target];
      setListing(result); setPagePosition({ index, offset: target.offset });
      listRef.current?.scrollTo({ top: 0 });
    } catch (reason) { if (version === browseVersion.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (version === browseVersion.current) setPaging(false); }
  }
  async function readMore() {
    if (!preview?.nextCursor || !selected || previewLoading) return;
    const version = previewVersion.current;
    setPreviewLoading(true); setPreviewError('');
    try {
      const result = await window.workspace.filesRead({ id: selected.id, cursor: preview.nextCursor });
      if (version === previewVersion.current) {
        if (result.textOffset !== previewText.length) throw new Error(copy.previewChanged);
        setPreview(result); setPreviewText(text => text + (result.text ?? ''));
      }
    } catch (reason) { if (version === previewVersion.current) setPreviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (version === previewVersion.current) setPreviewLoading(false); }
  }
  async function choose(kind: FileChooseKind) {
    setActionBusy(true); setError(''); setNotice('');
    try { await window.workspace.filesChoose(kind); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setActionBusy(false); }
  }
  async function reference(entry: FileEntry) {
    setActionBusy(true); setPreviewError(''); setNotice('');
    try { await window.workspace.filesReference(entry.id); setNotice('referenced'); }
    catch (reason) { setPreviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setActionBusy(false); }
  }
  async function attach(entry: FileEntry) {
    setActionBusy(true); setPreviewError(''); setNotice('');
    try { await onAttach(entry); setNotice('attached'); }
    catch (reason) { setPreviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setActionBusy(false); }
  }

  return <div className="ovd-files">
    <header className="ovd-files-toolbar">
      <div className="ovd-files-heading"><FolderOpen size={19} aria-hidden="true"/><strong>{listing?.path === listing?.root ? listing?.root ?? copy.documents : listing ? directoryName(listing.path) : copy.documents}</strong></div>
      <div className="ovd-files-toolbar-actions">
        <button type="button" className="ovd-files-icon" aria-label={copy.openDocuments} title={copy.openDocuments} onClick={() => navigate()}><Home size={16}/></button>
        <button type="button" className="ovd-files-icon" aria-label={copy.openParent} title={copy.parent} disabled={!listing?.parentPath || loading} onClick={() => navigate(listing?.parentPath)}><ArrowUp size={16}/></button>
        <button type="button" className="ovd-files-icon" aria-label={copy.reloadList} title={copy.refresh} disabled={loading} onClick={() => { clearQueryTimer(); void browse(currentPath.current, selected?.id); }}><RefreshCw size={16} className={loading ? 'is-loading' : ''}/></button>
        <span className="ovd-files-toolbar-divider"/>
        <button type="button" className="ovd-files-icon" aria-label={copy.chooseFolder} title={copy.chooseFolder} disabled={actionBusy} onClick={() => void choose('directory')}><Folder size={16}/></button>
        <button type="button" className="ovd-files-icon" aria-label={copy.chooseFile} title={copy.chooseFile} disabled={actionBusy} onClick={() => void choose('file')}><FilePlus2 size={16}/></button>
      </div>
    </header>
    <div className={`ovd-files-pathbar${editingPath ? ' is-editing' : ''}`}>
      {editingPath ? <form className="ovd-files-path-editor" onSubmit={event => { event.preventDefault(); submitPath(); }}><input ref={pathInputRef} aria-label={copy.folderPath} value={pathDraft} maxLength={4096} placeholder={copy.enterAbsolutePath} onChange={event => setPathDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelPathEdit(); } }}/><button type="submit" className="ovd-files-icon" aria-label={copy.openPath} title={copy.openPath}><ArrowRight size={14}/></button><button type="button" className="ovd-files-icon" aria-label={copy.cancelPath} title={copy.cancelShortcut} onClick={cancelPathEdit}><X size={14}/></button></form> : <><nav ref={pathRef} className="ovd-files-path" aria-label={copy.currentPath} title={listing?.path}>{breadcrumbs(listing).map((crumb, index, all) => <span key={crumb.path}>{index > 0 && <ChevronRight size={11} aria-hidden="true"/>}<button type="button" disabled={index === all.length - 1} onClick={() => navigate(crumb.path)} aria-current={index === all.length - 1 ? 'location' : undefined}>{crumb.title}</button></span>)}</nav><button ref={pathEditButtonRef} type="button" className="ovd-files-icon" aria-label={copy.enterPath} title={copy.enterPathShortcut} onClick={editPath}><Pencil size={13}/></button></>}
    </div>
    <div className="ovd-files-filters"><label className="ovd-files-search"><Search size={14} aria-hidden="true"/><input aria-label={copy.filterLabel} placeholder={copy.filterPlaceholder} maxLength={200} value={query} onChange={event => { const value = event.target.value; setQuery(value); currentQuery.current = value; clearQueryTimer(); setFilterPending(true); queryTimer.current = setTimeout(() => { queryTimer.current = undefined; void browse(currentPath.current); }, 200); }}/>{query && <button type="button" aria-label={copy.clearFilter} onClick={() => { clearQueryTimer(); currentQuery.current = ''; setQuery(''); void browse(currentPath.current); }}><X size={13}/></button>}</label>
      <select aria-label={copy.sort} value={sort} onChange={event => { const value = event.target.value; setSort(value); const [field, direction] = value.split(':'); currentSort.current = { sort: field as FileListRequest['sort'], direction: direction as FileListRequest['direction'] }; clearQueryTimer(); void browse(currentPath.current); }}><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="modified:desc">{copy.newest}</option><option value="size:desc">{copy.largest}</option></select>
    </div>
    {error && <div className="ovd-files-feedback error" role="alert">{error}<button type="button" onClick={() => void browse(currentPath.current)}>{copy.reload}</button></div>}
    {listing?.warning && <div className="ovd-files-feedback" role="status">{listing.skippedEntries === undefined ? listing.warning : copy.skippedEntries(listing.skippedEntries)}</div>}
    <div className={`ovd-files-content${selected ? ' has-selection' : ''}`}>
      <div className="ovd-files-browser">
        <div className="ovd-files-columns" aria-hidden="true"><span>Name</span><span>{copy.size}</span><span>{copy.modified}</span></div>
        <div ref={listRef} className="ovd-files-list" aria-label={copy.list} aria-busy={loading || paging}>
          {loading ? <p className="ovd-files-empty" role="status">{copy.loading}</p> : listing?.entries.map(entry => <button type="button" key={entry.id} className={`ovd-files-entry${selected?.id === entry.id ? ' is-selected' : ''}`} aria-pressed={selected?.id === entry.id} title={`${entry.name}${entry.isDirectory ? copy.openHint : copy.fileHint}`} draggable={!entry.isDirectory} onDragStart={event => { writeModuleReferenceDrag(event.dataTransfer, { moduleId: 'ovd-files', type: 'file', id: entry.id }); }} onClick={() => void select(entry)} onDoubleClick={() => { if (entry.isDirectory) navigate(entry.path); }} onKeyDown={event => { if (event.key === 'Enter' && entry.isDirectory) { event.preventDefault(); navigate(entry.path); } }}>
            <span className={`ovd-files-entry-icon${entry.isDirectory ? ' is-folder' : ''}`}>{entry.isDirectory ? <Folder size={17} aria-hidden="true"/> : <File size={17} aria-hidden="true"/>}</span><span className="ovd-files-entry-name"><strong>{entry.name}</strong><small>{fileType(entry, locale)}</small></span><span className="ovd-files-entry-size">{entry.isDirectory ? '–' : sizeLabel(entry.size, locale)}</span><time dateTime={entry.modifiedAt}>{dateLabel(entry.modifiedAt, locale)}</time>
          </button>)}
          {!loading && listing && !listing.entries.length && <p className="ovd-files-empty">{query ? copy.noMatches : copy.emptyFolder}</p>}
        </div>
      </div>
      {selected && <aside className="ovd-files-preview" aria-label={copy.selected}>
        <header><div>{selected.isDirectory ? <Folder size={16} aria-hidden="true"/> : <File size={16} aria-hidden="true"/>}<strong title={selected.name}>{selected.name}</strong></div><button type="button" className="ovd-files-icon" title={copy.closePreview} aria-label={copy.closePreview} onClick={() => { previewVersion.current++; setSelected(undefined); setPreview(undefined); setPreviewText(''); setPreviewError(''); setNotice(''); }}><X size={14}/></button></header>
        <div className="ovd-files-preview-body"><dl className="ovd-files-metadata"><div><dt>{copy.type}</dt><dd>{fileType(selected, locale)}</dd></div>{!selected.isDirectory && <div><dt>{copy.size}</dt><dd>{sizeLabel(selected.size, locale)}</dd></div>}<div><dt>{copy.modified}</dt><dd>{dateLabel(selected.modifiedAt, locale)}</dd></div><div className="ovd-files-metadata-path"><dt>{copy.path}</dt><dd title={selected.path}>{selected.path}</dd></div></dl>
          {selected.isDirectory ? <button type="button" className="ovd-files-primary" onClick={() => navigate(selected.path)}><FolderOpen size={14}/>{copy.open}</button> : <div className="ovd-files-file-actions"><button type="button" className="ovd-files-primary" disabled={actionBusy} onClick={() => void reference(selected)}><Link2 size={14}/>{copy.reference}</button>{draft && <button type="button" disabled={actionBusy} title={draft.subject || copy.untitled} onClick={() => void attach(selected)}><Paperclip size={14}/>{copy.attach}</button>}</div>}
          {previewError && <div className="ovd-files-feedback error" role="alert">{previewError}</div>}
          {notice && <p className="ovd-files-notice" role="status"><Check size={13} aria-hidden="true"/>{copy[notice]}</p>}
          {!selected.isDirectory && <section className="ovd-files-text-preview" aria-label={copy.filePreview}><div className="ovd-files-preview-label"><strong>{copy.preview}</strong>{preview?.readable && <small>{preview.complete ? copy.complete : copy.excerpt}</small>}</div>{previewText && <pre tabIndex={0}>{previewText}</pre>}{preview?.readable && preview.textLength === 0 && <p>{copy.emptyFile}</p>}{preview?.readable === false && <p>{preview.reasonCode ? copy[preview.reasonCode] : preview.reason || copy.unavailable}</p>}{previewLoading && <p role="status">{copy.loadingPreview}</p>}{preview?.hasMore && <button type="button" disabled={previewLoading} onClick={() => void readMore()}>{copy.readMore}</button>}</section>}
        </div>
      </aside>}
    </div>
    <footer className="ovd-files-footer"><span role="status" aria-live="polite">{listing ? copy.pageCount(loading || paging ? '…' : listing.entries.length ? `${(pagePosition.offset + 1).toLocaleString(locale)}–${(pagePosition.offset + listing.entries.length).toLocaleString(locale)}` : '0', listing.total) : copy.local}</span>{listing && (pagePosition.index > 0 || listing.hasMore) && <nav className="ovd-files-pages" aria-label={copy.pages}><button type="button" aria-label={copy.previousPage} title={copy.previous} disabled={pagePosition.index === 0 || loading || paging || filterPending} onClick={() => void changePage(-1)}><ChevronLeft size={15}/></button><button type="button" aria-label={copy.nextPage} title={copy.next} disabled={!listing.hasMore || loading || paging || filterPending} onClick={() => void changePage(1)}><ChevronRight size={15}/></button></nav>}</footer>
  </div>;
}

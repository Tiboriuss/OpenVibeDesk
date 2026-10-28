import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, Check, ChevronRight, File, FilePlus2, Folder, FolderOpen, Home, Link2, Paperclip, Pencil, RefreshCw, Search, X } from 'lucide-react';
import type { Draft } from '../../../shared/model';
import type { FileChooseKind, FileEntry, FileListingPage, FileListRequest, FileNavigationTarget, FileReadResult } from '../../../shared/files';
import { writeModuleReferenceDrag } from '../../../shared/references';
import './files-view.css';

function sizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(size / 1024)} KB`;
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} MB`;
}
function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '–' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}
function fileType(entry: FileEntry): string {
  if (entry.isDirectory) return 'Ordner';
  const extension = entry.name.includes('.') ? entry.name.split('.').at(-1) : undefined;
  return extension && extension.length <= 12 ? `${extension.toUpperCase()}-Datei` : 'Datei';
}
function directoryName(value?: string): string {
  if (!value) return 'Dokumente';
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
  const [listing, setListing] = useState<FileListingPage>();
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
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
  const listRef = useRef<HTMLDivElement>(null);
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
    setLoading(true); setLoadingMore(false); setFilterPending(false); setError(''); setNotice('');
    setSelected(undefined); setPreview(undefined); setPreviewText(''); setPreviewError(''); setPreviewLoading(false);
    try {
      const result = await window.workspace.filesList({ path, query: currentQuery.current || undefined, ...currentSort.current, limit: 100 });
      if (version !== browseVersion.current) return;
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
    if (pathNavigationVersion.current === browseVersion.current) { browseVersion.current++; setLoading(false); setLoadingMore(false); }
    pathNavigationVersion.current = undefined; currentPath.current = listing?.path;
    setEditingPath(false); setError('');
    requestAnimationFrame(() => pathEditButtonRef.current?.focus());
  }
  function submitPath() {
    const path = pathDraft.trim();
    if (!path || !(/^[\/\\]/.test(path) || /^[A-Za-z]:[/\\]/.test(path) || path === '~' || /^~[/\\]/.test(path))) {
      setError('Bitte einen absoluten Pfad oder ~ für deinen Benutzerordner eingeben.'); pathInputRef.current?.focus(); return;
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
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); editPath(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [listing?.path]);
  async function loadMore() {
    if (!listing?.nextCursor || loadingMore || loading || filterPending || queryTimer.current) return;
    const version = browseVersion.current;
    setLoadingMore(true); setError('');
    try {
      const result = await window.workspace.filesList({ path: listing.path, cursor: listing.nextCursor, query: currentQuery.current || undefined, ...currentSort.current, limit: 100 });
      if (version === browseVersion.current) setListing(previous => previous && ({ ...result, entries: [...previous.entries, ...result.entries] }));
    } catch (reason) { if (version === browseVersion.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (version === browseVersion.current) setLoadingMore(false); }
  }
  async function readMore() {
    if (!preview?.nextCursor || !selected || previewLoading) return;
    const version = previewVersion.current;
    setPreviewLoading(true); setPreviewError('');
    try {
      const result = await window.workspace.filesRead({ id: selected.id, cursor: preview.nextCursor });
      if (version === previewVersion.current) {
        if (result.textOffset !== previewText.length) throw new Error('Die Vorschau hat sich geändert. Bitte die Datei erneut auswählen.');
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
    try { await window.workspace.filesReference(entry.id); setNotice('Datei als Referenz im Chat ausgewählt.'); }
    catch (reason) { setPreviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setActionBusy(false); }
  }
  async function attach(entry: FileEntry) {
    setActionBusy(true); setPreviewError(''); setNotice('');
    try { await onAttach(entry); setNotice('Datei an den aktiven Entwurf angehängt.'); }
    catch (reason) { setPreviewError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setActionBusy(false); }
  }

  return <div className="ovd-files">
    <header className="ovd-files-toolbar">
      <div className="ovd-files-heading"><FolderOpen size={19} aria-hidden="true"/><strong>{listing?.path === listing?.root ? listing?.root ?? 'Dokumente' : directoryName(listing?.path)}</strong></div>
      <div className="ovd-files-toolbar-actions">
        <button type="button" className="ovd-files-icon" aria-label="Dokumente öffnen" title="Dokumente öffnen" onClick={() => navigate()}><Home size={16}/></button>
        <button type="button" className="ovd-files-icon" aria-label="Übergeordneten Ordner öffnen" title="Übergeordneter Ordner" disabled={!listing?.parentPath || loading} onClick={() => navigate(listing?.parentPath)}><ArrowUp size={16}/></button>
        <button type="button" className="ovd-files-icon" aria-label="Dateiliste aktualisieren" title="Aktualisieren" disabled={loading} onClick={() => { clearQueryTimer(); void browse(currentPath.current, selected?.id); }}><RefreshCw size={16} className={loading ? 'is-loading' : ''}/></button>
        <span className="ovd-files-toolbar-divider"/>
        <button type="button" className="ovd-files-icon" aria-label="Anderen Ordner auswählen" title="Anderen Ordner auswählen" disabled={actionBusy} onClick={() => void choose('directory')}><Folder size={16}/></button>
        <button type="button" className="ovd-files-icon" aria-label="Datei auswählen" title="Datei auswählen" disabled={actionBusy} onClick={() => void choose('file')}><FilePlus2 size={16}/></button>
      </div>
    </header>
    <div className={`ovd-files-pathbar${editingPath ? ' is-editing' : ''}`}>
      {editingPath ? <form className="ovd-files-path-editor" onSubmit={event => { event.preventDefault(); submitPath(); }}><input ref={pathInputRef} aria-label="Ordnerpfad" value={pathDraft} maxLength={4096} placeholder="Absoluten Ordnerpfad eingeben …" onChange={event => setPathDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancelPathEdit(); } }}/><button type="submit" className="ovd-files-icon" aria-label="Ordnerpfad öffnen" title="Ordnerpfad öffnen"><ArrowRight size={14}/></button><button type="button" className="ovd-files-icon" aria-label="Pfadbearbeitung abbrechen" title="Abbrechen (Esc)" onClick={cancelPathEdit}><X size={14}/></button></form> : <><nav className="ovd-files-path" aria-label="Aktueller Dateipfad" title={listing?.path}>{breadcrumbs(listing).map((crumb, index, all) => <span key={crumb.path}>{index > 0 && <ChevronRight size={11} aria-hidden="true"/>}<button type="button" disabled={index === all.length - 1} onClick={() => navigate(crumb.path)} aria-current={index === all.length - 1 ? 'location' : undefined}>{crumb.title}</button></span>)}</nav><button ref={pathEditButtonRef} type="button" className="ovd-files-icon" aria-label="Ordnerpfad eingeben" title="Ordnerpfad eingeben (⌘/Strg+L)" onClick={editPath}><Pencil size={13}/></button></>}
    </div>
    <div className="ovd-files-filters"><label className="ovd-files-search"><Search size={14} aria-hidden="true"/><input aria-label="Dateien im aktuellen Ordner filtern" placeholder="In diesem Ordner filtern …" maxLength={200} value={query} onChange={event => { const value = event.target.value; setQuery(value); currentQuery.current = value; clearQueryTimer(); setFilterPending(true); queryTimer.current = setTimeout(() => { queryTimer.current = undefined; void browse(currentPath.current); }, 200); }}/>{query && <button type="button" aria-label="Dateifilter zurücksetzen" onClick={() => { clearQueryTimer(); currentQuery.current = ''; setQuery(''); void browse(currentPath.current); }}><X size={13}/></button>}</label>
      <select aria-label="Dateien sortieren" value={sort} onChange={event => { const value = event.target.value; setSort(value); const [field, direction] = value.split(':'); currentSort.current = { sort: field as FileListRequest['sort'], direction: direction as FileListRequest['direction'] }; clearQueryTimer(); void browse(currentPath.current); }}><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="modified:desc">Zuletzt geändert</option><option value="size:desc">Größte zuerst</option></select>
    </div>
    {error && <div className="ovd-files-feedback error" role="alert">{error}<button type="button" onClick={() => void browse(currentPath.current)}>Erneut laden</button></div>}
    {listing?.warning && <div className="ovd-files-feedback" role="status">{listing.warning}</div>}
    <div className={`ovd-files-content${selected ? ' has-selection' : ''}`}>
      <div className="ovd-files-browser">
        <div className="ovd-files-columns" aria-hidden="true"><span>Name</span><span>Größe</span><span>Geändert</span></div>
        <div ref={listRef} className="ovd-files-list" aria-label="Dateien und Ordner" aria-busy={loading}>
          {loading ? <p className="ovd-files-empty" role="status">Ordner wird geladen …</p> : listing?.entries.map(entry => <button type="button" key={entry.id} className={`ovd-files-entry${selected?.id === entry.id ? ' is-selected' : ''}`} aria-pressed={selected?.id === entry.id} title={`${entry.name}${entry.isDirectory ? ' · Doppelklick oder Enter zum Öffnen' : ' · Zur Vorschau auswählen oder in den Chat ziehen'}`} draggable={!entry.isDirectory} onDragStart={event => { writeModuleReferenceDrag(event.dataTransfer, { moduleId: 'ovd-files', type: 'file', id: entry.id }); }} onClick={() => void select(entry)} onDoubleClick={() => { if (entry.isDirectory) navigate(entry.path); }} onKeyDown={event => { if (event.key === 'Enter' && entry.isDirectory) { event.preventDefault(); navigate(entry.path); } }}>
            <span className={`ovd-files-entry-icon${entry.isDirectory ? ' is-folder' : ''}`}>{entry.isDirectory ? <Folder size={17} aria-hidden="true"/> : <File size={17} aria-hidden="true"/>}</span><span className="ovd-files-entry-name"><strong>{entry.name}</strong><small>{fileType(entry)}</small></span><span className="ovd-files-entry-size">{entry.isDirectory ? '–' : sizeLabel(entry.size)}</span><time dateTime={entry.modifiedAt}>{dateLabel(entry.modifiedAt)}</time>
          </button>)}
          {!loading && listing && !listing.entries.length && <p className="ovd-files-empty">{query ? 'Keine Dateien mit diesem Namen gefunden.' : 'Dieser Ordner ist leer.'}</p>}
          {!loading && listing?.hasMore && <button type="button" className="ovd-files-more" disabled={loadingMore || filterPending} onClick={() => void loadMore()}>{loadingMore ? 'Weitere Einträge werden geladen …' : 'Weitere Einträge laden'}</button>}
        </div>
      </div>
      {selected && <aside className="ovd-files-preview" aria-label="Ausgewählte Datei">
        <header><div>{selected.isDirectory ? <Folder size={16} aria-hidden="true"/> : <File size={16} aria-hidden="true"/>}<strong title={selected.name}>{selected.name}</strong></div><button type="button" className="ovd-files-icon" title="Vorschau schließen" aria-label="Vorschau schließen" onClick={() => { previewVersion.current++; setSelected(undefined); setPreview(undefined); setPreviewText(''); setPreviewError(''); setNotice(''); }}><X size={14}/></button></header>
        <div className="ovd-files-preview-body"><dl className="ovd-files-metadata"><div><dt>Typ</dt><dd>{fileType(selected)}</dd></div>{!selected.isDirectory && <div><dt>Größe</dt><dd>{sizeLabel(selected.size)}</dd></div>}<div><dt>Geändert</dt><dd>{dateLabel(selected.modifiedAt)}</dd></div><div className="ovd-files-metadata-path"><dt>Pfad</dt><dd title={selected.path}>{selected.path}</dd></div></dl>
          {selected.isDirectory ? <button type="button" className="ovd-files-primary" onClick={() => navigate(selected.path)}><FolderOpen size={14}/>Ordner öffnen</button> : <div className="ovd-files-file-actions"><button type="button" className="ovd-files-primary" disabled={actionBusy} onClick={() => void reference(selected)}><Link2 size={14}/>Im Chat referenzieren</button>{draft && <button type="button" disabled={actionBusy} title={draft.subject || 'Unbenannter Entwurf'} onClick={() => void attach(selected)}><Paperclip size={14}/>An Entwurf anhängen</button>}</div>}
          {previewError && <div className="ovd-files-feedback error" role="alert">{previewError}</div>}
          {notice && <p className="ovd-files-notice" role="status"><Check size={13} aria-hidden="true"/>{notice}</p>}
          {!selected.isDirectory && <section className="ovd-files-text-preview" aria-label="Dateivorschau"><div className="ovd-files-preview-label"><strong>Vorschau</strong>{preview?.readable && <small>{preview.complete ? 'vollständig' : 'Ausschnitt'}</small>}</div>{previewText && <pre tabIndex={0}>{previewText}</pre>}{preview?.readable && preview.textLength === 0 && <p>Diese Textdatei ist leer.</p>}{preview?.readable === false && <p>{preview.reason || 'Für dieses Dateiformat ist keine Textvorschau verfügbar. Du kannst die Datei als Referenz verwenden.'}</p>}{previewLoading && <p role="status">Vorschau wird geladen …</p>}{preview?.hasMore && <button type="button" disabled={previewLoading} onClick={() => void readMore()}>Weiterlesen</button>}</section>}
        </div>
      </aside>}
    </div>
    <footer className="ovd-files-footer"><span>{listing ? `${loading ? '…' : listing.entries.length} von ${listing.total} ${listing.total === 1 ? 'Eintrag' : 'Einträgen'}` : 'Lokale Dateien'}</span><span>Dateien in den Chat ziehen</span></footer>
  </div>;
}

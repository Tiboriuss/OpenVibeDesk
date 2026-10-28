import { useEffect, useState } from 'react';
import { Check, FolderCheck, LoaderCircle, Paperclip, RotateCw, Save, Send, TriangleAlert, X } from 'lucide-react';
import type { Draft } from '../../../shared/model';
import type { DraftSaveState } from '../../../shared/drafts';
import type { ImapFolder, MailSendResult, SentCopyResult } from '../../../shared/mail';
import './draft-view.css';

export function DraftView({ draft, accounts = [], saveState, onSave, onUpdate, onAttach, onRemoveAttachment, onSend, onFileSent, onListSentFolders }: { draft?: Draft; saveState?: DraftSaveState; onSave?(): Promise<void>; accounts?: { id: string; name: string; email: string }[]; onUpdate(patch: { to?: string; cc?: string; bcc?: string; subject?: string; body?: string; accountId?: string }): void; onAttach(): void; onRemoveAttachment?(index: number): void; onSend?(): Promise<void | MailSendResult>; onFileSent?(folder?: string): Promise<SentCopyResult>; onListSentFolders?(): Promise<ImapFolder[]> }) {
  const [showCopies, setShowCopies] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [filingDraftId, setFilingDraftId] = useState<string>();
  const [folderOptions, setFolderOptions] = useState<{ draftId: string; items: ImapFolder[] }>();
  const [folderSelection, setFolderSelection] = useState<{ draftId: string; path: string }>();
  const [loadingFoldersId, setLoadingFoldersId] = useState<string>();
  const [filingError, setFilingError] = useState<{ draftId: string; message: string }>();
  useEffect(() => { setShowCopies(!!(draft?.cc || draft?.bcc)); }, [draft?.id]);
  useEffect(() => { setSendError(''); setFilingError(undefined); }, [draft?.id]);
  useEffect(() => {
    if (!draft || !onSave) return;
    const saveShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (saveState?.status !== 'saving' && !sending) void onSave();
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, [draft?.id, onSave, saveState?.status, sending]);
  if (!draft) return <div className="empty-detail">Kein Entwurf ausgewählt.</div>;
  const deliveryStatus = draft.deliveryStatus ?? 'draft';
  const locked = sending || deliveryStatus !== 'draft';
  const sendMessage = async () => {
    if (!onSend || locked) return;
    setSending(true); setSendError('');
    try { const result = await onSend(); if (result && result.status !== 'sent' && result.status !== 'cancelled') setSendError(result.error ?? result.message ?? 'Der Versandstatus konnte nicht bestätigt werden.'); }
    catch (error) { setSendError(error instanceof Error ? error.message : 'Die Nachricht konnte nicht gesendet werden.'); }
    finally { setSending(false); }
  };
  const sentCopy = draft.sentCopy;
  const filing = filingDraftId === draft.id || sentCopy?.status === 'filing';
  const fileSentCopy = async () => {
    if (!onFileSent || deliveryStatus !== 'sent' || filing || sentCopy?.status === 'filed') return;
    const id = draft.id;
    setFilingDraftId(id); setFilingError(undefined);
    try {
      const result = await onFileSent(folderSelection?.draftId === id ? folderSelection.path || undefined : undefined);
      if (!result.ok && result.error) setFilingError({ draftId: id, message: result.error });
    } catch (error) {
      setFilingError({ draftId: id, message: error instanceof Error ? error.message : 'Die Ablage konnte nicht bestätigt werden. Die Nachricht wird nicht erneut versendet.' });
    } finally { setFilingDraftId(current => current === id ? undefined : current); }
  };
  const chooseSentFolder = async () => {
    if (!onListSentFolders || sentCopy?.appendAttempted || filing) return;
    const id = draft.id; setLoadingFoldersId(id); setFilingError(undefined);
    try {
      const items = (await onListSentFolders()).filter(folder => folder.selectable);
      setFolderOptions({ draftId: id, items });
      setFolderSelection({ draftId: id, path: items.some(folder => folder.path === sentCopy?.folder) ? sentCopy!.folder! : '' });
      if (!items.length) setFilingError({ draftId: id, message: 'Das Konto hat keine auswählbaren Ordner für die Ablage.' });
    } catch (error) { setFilingError({ draftId: id, message: error instanceof Error ? error.message : 'Die Ablageordner konnten nicht geladen werden.' }); }
    finally { setLoadingFoldersId(current => current === id ? undefined : current); }
  };
  const visibleFolders = folderOptions?.draftId === draft.id ? folderOptions.items : undefined;
  const chosenFolder = folderSelection?.draftId === draft.id ? folderSelection.path : '';
  const copyError = (filingError?.draftId === draft.id ? filingError.message : undefined) || sentCopy?.error;
  const filingLabel = filing ? 'Ablage wird geprüft …' : sentCopy?.status === 'filed' ? 'In Gesendet abgelegt' : sentCopy?.status === 'failed' ? 'Ablage fehlgeschlagen' : sentCopy?.status === 'uncertain' ? 'Ablage noch unklar' : 'Ablage ausstehend';
  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const savedDate = saveState?.savedAt ? new Date(saveState.savedAt) : undefined;
  const savedTime = savedDate && Number.isFinite(savedDate.getTime()) ? savedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : undefined;
  const saveLabel = saveState?.status === 'saved' ? `Lokal gespeichert${savedTime ? ` · ${savedTime}` : ''}` : saveState?.status === 'saving' ? 'Wird gespeichert …' : saveState?.status === 'error' ? 'Speicherung nicht bestätigt' : 'Speicherstatus wird geladen …';
  return <div className={`draft-layout${deliveryStatus === 'sent' ? ' has-sent-copy' : ''}`}>
    <div className="draft-toolbar"><div><small>ENTWURF</small><h2>{draft.replyTo || draft.inReplyTo ? 'Antwort' : 'Neue Nachricht'}</h2></div><div className={`draft-save-controls ${saveState?.status ?? 'loading'}`}>
      <span className="draft-save-status" role="status" aria-live="polite" title={savedDate && Number.isFinite(savedDate.getTime()) ? `Zuletzt lokal gespeichert: ${savedDate.toLocaleString()}` : undefined}>
        {saveState?.status === 'saved' ? <Check size={14} aria-hidden="true" /> : saveState?.status === 'error' ? <TriangleAlert size={14} aria-hidden="true" /> : <LoaderCircle size={14} className="draft-save-spinner" aria-hidden="true" />}
        <span>{saveLabel}</span>
      </span>
      {onSave && <button className="draft-save-button" type="button" onClick={() => void onSave()} disabled={saveState?.status === 'saving' || sending || deliveryStatus === 'sending'} aria-label={saveState?.status === 'error' ? 'Entwurf erneut lokal speichern' : 'Entwurf lokal speichern'} title="Lokal speichern (⌘S / Strg+S)"><Save size={15} aria-hidden="true" /></button>}
    </div></div>
    {saveState?.status === 'error' && <p className="draft-save-error" role="alert">{saveState.error || 'Die letzte Änderung konnte nicht lokal gespeichert werden.'} Deine Änderungen sind noch im Fenster verfügbar. Bitte erneut speichern.</p>}
    <div className="draft-fields">
      <label htmlFor="draft-account">Von<select id="draft-account" disabled={locked} value={draft.accountId ?? ''} onChange={event => onUpdate({ accountId: event.target.value })}><option value="">{accounts.length ? 'Sendekonto auswählen' : 'Kein Mailkonto eingerichtet'}</option>{accounts.map(account => <option value={account.id} key={account.id}>{account.name} · {account.email}</option>)}</select></label>
      <div className="draft-to-row"><label htmlFor="draft-to">An<input id="draft-to" disabled={locked} value={draft.to} onChange={event => onUpdate({ to: event.target.value })} placeholder="name@beispiel.de" /></label><button type="button" className="draft-copy-toggle" onClick={() => setShowCopies(value => !value)} aria-expanded={showCopies} aria-controls="draft-copy-fields">CC / BCC</button></div>
      <div id="draft-copy-fields" hidden={!showCopies}>
        <label htmlFor="draft-cc">CC<input id="draft-cc" disabled={locked} value={draft.cc ?? ''} onChange={event => onUpdate({ cc: event.target.value })} placeholder="Weitere Empfänger" /></label>
        <label htmlFor="draft-bcc">BCC<input id="draft-bcc" disabled={locked} value={draft.bcc ?? ''} onChange={event => onUpdate({ bcc: event.target.value })} placeholder="Verdeckte Empfänger" /></label>
      </div>
      <label htmlFor="draft-subject">Betreff<input id="draft-subject" disabled={locked} value={draft.subject} onChange={event => onUpdate({ subject: event.target.value })} placeholder="Betreff eingeben" /></label>
    </div>
    <textarea className="draft-body" aria-label="Nachrichtentext" disabled={locked} value={draft.body} onChange={event => onUpdate({ body: event.target.value })} placeholder="Schreibe deine Nachricht …" />
    {draft.attachments.length > 0 && <section className="draft-attachments" aria-label="Anhänge"><div className="draft-attachments-heading">Anhänge · {draft.attachments.length}</div><ul>{draft.attachments.map((attachment, index) => <li className="draft-attachment-row" key={`${attachment.path}-${index}`}><Paperclip size={15} aria-hidden="true" /><span className="draft-attachment-name" title={attachment.name}>{attachment.name}</span><small>{formatSize(attachment.size)}</small>{onRemoveAttachment && !locked && <button type="button" onClick={() => onRemoveAttachment(index)} aria-label={`${attachment.name} entfernen`} title="Anhang entfernen"><X size={15} /></button>}</li>)}</ul></section>}
    {(sendError || draft.deliveryError) && <p className="draft-delivery-error" role="alert">{sendError || draft.deliveryError}</p>}
    {deliveryStatus === 'sent' && !!draft.rejectedRecipients?.length && <div className="draft-delivery-error" role="alert">Nicht angenommen: {draft.rejectedRecipients.join(', ')}. Die Nachricht wurde an die übrigen Empfänger übergeben.</div>}
    {deliveryStatus === 'sent' && <section className={`draft-sent-copy ${sentCopy?.status ?? 'legacy'}`} aria-label="Ablage im Gesendet-Ordner">
      <div className="draft-sent-copy-heading"><span role="status" aria-live="polite">
        {filing ? <LoaderCircle size={15} className="draft-save-spinner" aria-hidden="true" /> : sentCopy?.status === 'filed' ? <FolderCheck size={15} aria-hidden="true" /> : sentCopy?.status === 'failed' || sentCopy?.status === 'uncertain' ? <TriangleAlert size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
        {sentCopy ? filingLabel : 'Vom SMTP-Server angenommen'}
      </span>{sentCopy?.folder && <small title={sentCopy.folder}>{sentCopy.folder}</small>}</div>
      {!sentCopy ? <p>Für diese ältere Nachricht ist keine vorbereitete Kopie für die Ablage vorhanden.</p> : <>
        {sentCopy.status === 'filed' ? <p>Die Kopie wurde im Gesendet-Ordner bestätigt.</p> : <p>Die Nachricht wurde angenommen. Eine erneute Ablage sendet sie nicht noch einmal.{sentCopy.status === 'uncertain' ? ' Der Ordner wird zuerst auf die vorhandene Kopie geprüft.' : ''}</p>}
        {copyError && sentCopy.status !== 'filed' && <p className="draft-sent-copy-error" role="alert">{copyError}</p>}
        {sentCopy.status !== 'filed' && !sentCopy.appendAttempted && onListSentFolders && <>
          <button type="button" className="draft-choose-sent-folder" onClick={() => void chooseSentFolder()} disabled={filing || loadingFoldersId === draft.id}>{loadingFoldersId === draft.id ? 'Ordner werden geladen …' : visibleFolders ? 'Ordnerliste aktualisieren' : 'Ablageordner wählen'}</button>
          {visibleFolders && visibleFolders.length > 0 && <label className="draft-sent-folder-label" htmlFor="draft-sent-folder">Ablageordner<select id="draft-sent-folder" value={chosenFolder} disabled={filing} onChange={event => setFolderSelection({ draftId: draft.id, path: event.target.value })}><option value="">Automatisch bestimmen</option>{visibleFolders.map(folder => <option key={folder.path} value={folder.path}>{folder.path}</option>)}</select></label>}
        </>}
        {sentCopy.status !== 'filed' && onFileSent && <button type="button" className="draft-file-sent-button" onClick={() => void fileSentCopy()} disabled={filing || sending}><RotateCw size={14} aria-hidden="true" />{filing ? 'Ablage wird geprüft …' : sentCopy.status === 'uncertain' ? 'Ablage erneut prüfen' : 'Nur Ablage erneut versuchen'}</button>}
      </>}
    </section>}
    <div className="draft-footer"><button className="attach-button" type="button" onClick={onAttach} disabled={locked}><Paperclip size={16} /> Datei anhängen</button><button className="draft-send-button" type="button" disabled={!onSend || locked} onClick={() => void sendMessage()} aria-describedby="draft-send-note"><Send size={15} /> {sending || deliveryStatus === 'sending' ? 'Wird gesendet …' : deliveryStatus === 'sent' ? 'Gesendet' : 'Senden'}</button></div>
    <p id="draft-send-note" className="draft-send-note">{deliveryStatus === 'uncertain' ? 'Der Versandstatus ist unklar. Die Nachricht könnte bereits angenommen worden sein. Bitte vor einem erneuten Versand prüfen.' : deliveryStatus === 'sent' ? 'Vom SMTP-Server angenommen. Der Versand kann nicht erneut gestartet werden.' : deliveryStatus === 'sending' || sending ? 'Die Nachricht wird an den SMTP-Server übergeben.' : onSend ? 'Die Nachricht wird erst nach deiner Bestätigung versendet.' : 'Versand ist noch nicht eingerichtet. Dein Entwurf bleibt lokal erhalten.'}</p>
  </div>;
}

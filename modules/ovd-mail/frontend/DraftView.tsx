import { useUiLocale } from '../../../src/locale';
import { mailFormat } from './mail-format';
import { mailText } from './mail-locale';
import { useEffect, useState } from 'react';
import { Check, FolderCheck, LoaderCircle, Paperclip, RotateCw, Save, Send, TriangleAlert, X } from 'lucide-react';
import type { Draft } from '../../../shared/model';
import type { DraftSaveState } from '../../../shared/drafts';
import type { ImapFolder, MailSendResult, SentCopyResult } from '../../../shared/mail';
import './draft-view.css';

export function DraftView({ draft, accounts = [], saveState, onSave, onUpdate, onAttach, onRemoveAttachment, onSend, onFileSent, onListSentFolders }: { draft?: Draft; saveState?: DraftSaveState; onSave?(): Promise<void>; accounts?: { id: string; name: string; email: string; senderName?: string }[]; onUpdate(patch: { to?: string; cc?: string; bcc?: string; subject?: string; body?: string; accountId?: string }): void; onAttach(): void; onRemoveAttachment?(index: number): void; onSend?(): Promise<void | MailSendResult>; onFileSent?(folder?: string): Promise<SentCopyResult>; onListSentFolders?(): Promise<ImapFolder[]> }) {
  const locale = useUiLocale();
  const copy = mailText[locale];
  const [showCopies, setShowCopies] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [filingDraftId, setFilingDraftId] = useState<string>();
  const [folderOptions, setFolderOptions] = useState<{ draftId: string; items: ImapFolder[] }>();
  const [folderSelection, setFolderSelection] = useState<{ draftId: string; path: string }>();
  const [loadingFoldersId, setLoadingFoldersId] = useState<string>();
  const [filingError, setFilingError] = useState<{ draftId: string; message: string }>();
  useEffect(() => { setShowCopies(!!(draft?.cc || draft?.bcc)); }, [draft?.id]);
  useEffect(() => { if (draft?.cc || draft?.bcc) setShowCopies(true); }, [draft?.cc, draft?.bcc]);
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
  if (!draft) return <div className="empty-detail">{copy.noDraft}</div>;
  const deliveryStatus = draft.deliveryStatus ?? 'draft';
  const locked = sending || deliveryStatus !== 'draft';
  const sendMessage = async () => {
    if (!onSend || locked) return;
    setSending(true); setSendError('');
    try { const result = await onSend(); if (result && result.status !== 'sent' && result.status !== 'cancelled') setSendError(result.error ?? result.message ?? copy.sendUnconfirmed); }
    catch (error) { setSendError(error instanceof Error ? error.message : copy.sendFailed); }
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
      setFilingError({ draftId: id, message: error instanceof Error ? error.message : copy.filingUnconfirmed });
    } finally { setFilingDraftId(current => current === id ? undefined : current); }
  };
  const chooseSentFolder = async () => {
    if (!onListSentFolders || sentCopy?.appendAttempted || filing) return;
    const id = draft.id; setLoadingFoldersId(id); setFilingError(undefined);
    try {
      const items = (await onListSentFolders()).filter(folder => folder.selectable);
      setFolderOptions({ draftId: id, items });
      setFolderSelection({ draftId: id, path: items.some(folder => folder.path === sentCopy?.folder) ? sentCopy!.folder! : '' });
      if (!items.length) setFilingError({ draftId: id, message: copy.noFilingFolders });
    } catch (error) { setFilingError({ draftId: id, message: error instanceof Error ? error.message : copy.filingFoldersError }); }
    finally { setLoadingFoldersId(current => current === id ? undefined : current); }
  };
  const visibleFolders = folderOptions?.draftId === draft.id ? folderOptions.items : undefined;
  const chosenFolder = folderSelection?.draftId === draft.id ? folderSelection.path : '';
  const copyError = (filingError?.draftId === draft.id ? filingError.message : undefined) || sentCopy?.error;
  const filingLabel = filing ? copy.filingChecking : sentCopy?.status === 'filed' ? copy.filed : sentCopy?.status === 'failed' ? copy.filingFailed : sentCopy?.status === 'uncertain' ? copy.filingUncertain : copy.filingPending;
  const { formatSize } = mailFormat[locale];
  const savedDate = saveState?.savedAt ? new Date(saveState.savedAt) : undefined;
  const savedTime = savedDate && Number.isFinite(savedDate.getTime()) ? savedDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : undefined;
  const saveLabel = saveState?.status === 'saved' ? `${copy.savedLocally}${savedTime ? ` · ${savedTime}` : ''}` : saveState?.status === 'saving' ? copy.saving : saveState?.status === 'error' ? copy.saveUnconfirmed : copy.loadingSave;
  return <div className={`draft-layout${deliveryStatus === 'sent' ? ' has-sent-copy' : ''}`}>
    <div className="draft-toolbar"><div><h2>{deliveryStatus === 'sent' ? copy.sentMessage : draft.replyTo || draft.inReplyTo ? copy.reply : copy.newMessage}</h2></div><div className={`draft-save-controls ${saveState?.status ?? 'loading'}`}>
      <span className="draft-save-status" role="status" aria-live="polite" title={savedDate && Number.isFinite(savedDate.getTime()) ? `${copy.lastSaved}: ${savedDate.toLocaleString(locale)}` : undefined}>
        {saveState?.status === 'saved' ? <Check size={14} aria-hidden="true" /> : saveState?.status === 'error' ? <TriangleAlert size={14} aria-hidden="true" /> : <LoaderCircle size={14} className="draft-save-spinner" aria-hidden="true" />}
        <span>{saveLabel}</span>
      </span>
      {onSave && <button className="draft-save-button" type="button" onClick={() => void onSave()} disabled={saveState?.status === 'saving' || sending || deliveryStatus === 'sending'} aria-label={saveState?.status === 'error' ? copy.retryLocalSave : copy.saveLocal} title={copy.saveShortcut}><Save size={15} aria-hidden="true" /></button>}
    </div></div>
    {saveState?.status === 'error' && <p className="draft-save-error" role="alert">{saveState.error || copy.lastSaveFailed} {copy.retryDraftHint}</p>}
    <div className="draft-fields">
      <label htmlFor="draft-account">{copy.from}<select id="draft-account" disabled={locked} value={draft.accountId ?? ''} onChange={event => onUpdate({ accountId: event.target.value })}><option value="">{accounts.length ? copy.sendingAccount : copy.noMailAccount}</option>{accounts.map(account => <option value={account.id} key={account.id}>{account.senderName || account.name} · {account.email}</option>)}</select></label>
      <div className="draft-to-row"><label htmlFor="draft-to">{copy.to}<input id="draft-to" disabled={locked} value={draft.to} onChange={event => onUpdate({ to: event.target.value })} placeholder="name@beispiel.de" /></label><button type="button" className="draft-copy-toggle" onClick={() => setShowCopies(value => !value)} aria-expanded={showCopies} aria-controls="draft-copy-fields">CC / BCC</button></div>
      <div id="draft-copy-fields" hidden={!showCopies}>
        <label htmlFor="draft-cc">CC<input id="draft-cc" disabled={locked} value={draft.cc ?? ''} onChange={event => onUpdate({ cc: event.target.value })} placeholder={copy.ccPlaceholder} /></label>
        <label htmlFor="draft-bcc">BCC<input id="draft-bcc" disabled={locked} value={draft.bcc ?? ''} onChange={event => onUpdate({ bcc: event.target.value })} placeholder={copy.bccPlaceholder} /></label>
      </div>
      <label htmlFor="draft-subject">{copy.subject}<input id="draft-subject" disabled={locked} value={draft.subject} onChange={event => onUpdate({ subject: event.target.value })} placeholder={copy.enterSubject} /></label>
    </div>
    <textarea className="draft-body" aria-label={copy.messageBody} disabled={locked} value={draft.body} onChange={event => onUpdate({ body: event.target.value })} placeholder={copy.writeMessage} />
    {draft.attachments.length > 0 && <section className="draft-attachments" aria-label={copy.attachments}><div className="draft-attachments-heading">{copy.attachmentsCount} {draft.attachments.length}</div><ul>{draft.attachments.map((attachment, index) => <li className="draft-attachment-row" key={`${attachment.path}-${index}`}><Paperclip size={15} aria-hidden="true" /><span className="draft-attachment-name" title={attachment.name}>{attachment.name}</span><small>{formatSize(attachment.size)}</small>{onRemoveAttachment && !locked && <button type="button" onClick={() => onRemoveAttachment(index)} aria-label={copy.removeNamed(attachment.name)} title={copy.removeAttachment}><X size={15} /></button>}</li>)}</ul></section>}
    {(sendError || draft.deliveryError) && <p className="draft-delivery-error" role="alert">{sendError || draft.deliveryError}</p>}
    {deliveryStatus === 'sent' && !!draft.rejectedRecipients?.length && <div className="draft-delivery-error" role="alert">{copy.rejected} {draft.rejectedRecipients.join(', ')}{copy.othersAccepted}</div>}
    {deliveryStatus === 'sent' && <section className={`draft-sent-copy ${sentCopy?.status ?? 'legacy'}`} aria-label={copy.sentCopy}>
      <div className="draft-sent-copy-heading"><span role="status" aria-live="polite">
        {filing ? <LoaderCircle size={15} className="draft-save-spinner" aria-hidden="true" /> : sentCopy?.status === 'filed' ? <FolderCheck size={15} aria-hidden="true" /> : sentCopy?.status === 'failed' || sentCopy?.status === 'uncertain' ? <TriangleAlert size={15} aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
        {sentCopy ? filingLabel : copy.smtpAccepted}
      </span>{sentCopy?.folder && <small title={sentCopy.folder}>{sentCopy.folder}</small>}</div>
      {!sentCopy ? <p>{copy.noOlderCopy}</p> : <>
        {sentCopy.status !== 'filed' && <p>{sentCopy.status === 'uncertain' ? copy.checkBeforeRetry : copy.alreadySent}</p>}
        {copyError && sentCopy.status !== 'filed' && <p className="draft-sent-copy-error" role="alert">{copyError}</p>}
        {sentCopy.status !== 'filed' && !sentCopy.appendAttempted && onListSentFolders && <>
          <button type="button" className="draft-choose-sent-folder" onClick={() => void chooseSentFolder()} disabled={filing || loadingFoldersId === draft.id}>{loadingFoldersId === draft.id ? copy.loadingFolders : visibleFolders ? copy.refreshFolders : copy.chooseFilingFolder}</button>
          {visibleFolders && visibleFolders.length > 0 && <label className="draft-sent-folder-label" htmlFor="draft-sent-folder">{copy.filingFolder}<select id="draft-sent-folder" value={chosenFolder} disabled={filing} onChange={event => setFolderSelection({ draftId: draft.id, path: event.target.value })}><option value="">{copy.automatic}</option>{visibleFolders.map(folder => <option key={folder.path} value={folder.path}>{folder.path}</option>)}</select></label>}
        </>}
        {sentCopy.status !== 'filed' && onFileSent && <button type="button" className="draft-file-sent-button" onClick={() => void fileSentCopy()} disabled={filing || sending}><RotateCw size={14} aria-hidden="true" />{filing ? copy.filingChecking : sentCopy.status === 'uncertain' ? copy.checkFiling : copy.retryFiling}</button>}
      </>}
    </section>}
    <div className="draft-footer"><button className="attach-button" type="button" onClick={onAttach} disabled={locked}><Paperclip size={16} /> {copy.attachFile}</button><button className="draft-send-button" type="button" disabled={!onSend || locked} onClick={() => void sendMessage()} aria-describedby={deliveryStatus === 'uncertain' || !onSend ? 'draft-send-note' : undefined}><Send size={15} /> {sending || deliveryStatus === 'sending' ? copy.sending : deliveryStatus === 'sent' ? copy.sent : copy.send}</button></div>
    {(deliveryStatus === 'uncertain' || !onSend) && <p id="draft-send-note" className="draft-send-note">{deliveryStatus === 'uncertain' ? copy.uncertainSendHint : copy.sendNotConfigured}</p>}
  </div>;
}

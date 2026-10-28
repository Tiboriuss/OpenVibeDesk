import { useEffect, useState } from 'react';
import { Paperclip, Send, X } from 'lucide-react';
import type { Draft } from '../../../shared/model';
import type { MailSendResult } from '../../../shared/mail';
import './draft-view.css';

export function DraftView({ draft, accounts = [], onUpdate, onAttach, onRemoveAttachment, onSend }: { draft?: Draft; accounts?: { id: string; name: string; email: string }[]; onUpdate(patch: { to?: string; cc?: string; bcc?: string; subject?: string; body?: string; accountId?: string }): void; onAttach(): void; onRemoveAttachment?(index: number): void; onSend?(): Promise<void | MailSendResult> }) {
  const [showCopies, setShowCopies] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  useEffect(() => { setShowCopies(!!(draft?.cc || draft?.bcc)); }, [draft?.id]);
  useEffect(() => { setSendError(''); }, [draft?.id]);
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
  const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return <div className="draft-layout">
    <div className="draft-toolbar"><div><small>ENTWURF</small><h2>{draft.replyTo || draft.inReplyTo ? 'Antwort' : 'Neue Nachricht'}</h2></div><span>Wird automatisch lokal gespeichert</span></div>
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
    <div className="draft-footer"><button className="attach-button" type="button" onClick={onAttach} disabled={locked}><Paperclip size={16} /> Datei anhängen</button><button className="draft-send-button" type="button" disabled={!onSend || locked} onClick={() => void sendMessage()} aria-describedby="draft-send-note"><Send size={15} /> {sending || deliveryStatus === 'sending' ? 'Wird gesendet …' : deliveryStatus === 'sent' ? 'Gesendet' : 'Senden'}</button></div>
    <p id="draft-send-note" className="draft-send-note">{deliveryStatus === 'uncertain' ? 'Der Versandstatus ist unklar. Die Nachricht könnte bereits angenommen worden sein. Bitte vor einem erneuten Versand prüfen.' : deliveryStatus === 'sent' ? 'Vom SMTP-Server angenommen. Der Gesendet-Ordner wird noch nicht abgeglichen. Der Versand kann nicht erneut gestartet werden.' : deliveryStatus === 'sending' || sending ? 'Die Nachricht wird an den SMTP-Server übergeben.' : onSend ? 'Die Nachricht wird erst nach deiner Bestätigung versendet.' : 'Versand ist noch nicht eingerichtet. Dein Entwurf bleibt lokal erhalten.'}</p>
  </div>;
}

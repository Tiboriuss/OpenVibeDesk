import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { MailTextPage } from '../../../shared/mail-content';

/** Keep one source page in the reader, independently of the bounded HTML preview. */
export function MailTextReader({ emailId, initialCursor, pageSize = 6000, onClose }: { emailId: string; initialCursor?: string; pageSize?: number; onClose(): void }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([initialCursor]);
  const [index, setIndex] = useState(0), [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<MailTextPage>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const cursor = cursors[index];
  useEffect(() => {
    let active = true;
    setBusy(true); setError('');
    void window.workspace.readMailText(emailId, { cursor, limit: pageSize }).then(value => {
      if (!active) return;
      setPage(value); container.current?.scrollIntoView({ block: 'nearest' });
    }).catch(reason => { if (active) { setPage(undefined); setError(reason instanceof Error ? reason.message : 'Text konnte nicht geladen werden.'); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; void window.workspace.cancelMailText().catch(() => {}); };
  }, [emailId, cursor, pageSize, attempt]);
  return <div className="mail-text-reader" ref={container} aria-label="Vollständiger Mailtext">
    <div className="mail-text-navigation">
      <button type="button" disabled={busy || index === 0} onClick={() => setIndex(value => value - 1)}><ArrowLeft size={14}/>Zurück</button>
      {index === 0 && page && page.offset > 0 && <button type="button" disabled={busy} onClick={() => { setCursors([undefined]); setAttempt(value => value + 1); }}>Anfang</button>}
      <span role="status">{busy ? 'Text wird geladen …' : page ? `${page.totalCharacters ? page.offset + 1 : 0}–${page.offset + page.returnedCharacters} / ${page.totalCharacters} Zeichen` : 'Text nicht verfügbar'}</span>
      <button type="button" disabled={busy || !page?.nextCursor} onClick={() => { if (!page?.nextCursor) return; setCursors(value => [...value.slice(0, index + 1), page.nextCursor]); setIndex(value => value + 1); }}>Weiter<ArrowRight size={14}/></button>
      <button type="button" onClick={onClose} title="Zur Vorschau zurückkehren"><X size={14}/>Vorschau</button>
    </div>
    {error && <div className="imap-error" role="alert">{error}<button type="button" onClick={() => setAttempt(value => value + 1)}>Erneut laden</button><button type="button" onClick={() => { setCursors([undefined]); setIndex(0); setAttempt(value => value + 1); }}>Von Anfang lesen</button></div>}
    {!busy && page && <div className="imap-body-text">{page.text || 'Diese Nachricht enthält keinen Text.'}</div>}
  </div>;
}

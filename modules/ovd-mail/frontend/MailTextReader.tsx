import { useUiLocale } from '../../../src/locale';
import { mailText } from './mail-locale';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import type { MailTextPage } from '../../../shared/mail-content';

/** Keep one source page in the reader, independently of the bounded HTML preview. */
export function MailTextReader({ emailId, initialCursor, pageSize = 6000, onClose }: { emailId: string; initialCursor?: string; pageSize?: number; onClose(): void }) {
  const locale = useUiLocale();
  const copy = mailText[locale];
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
    }).catch(reason => { if (active) { setPage(undefined); setError(reason instanceof Error ? reason.message : copy.textLoadFailed); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; void window.workspace.cancelMailText().catch(() => {}); };
  }, [emailId, cursor, pageSize, attempt]);
  return <div className="mail-text-reader" ref={container} aria-label={copy.fullMailText}>
    <div className="mail-text-navigation">
      <button type="button" disabled={busy || index === 0} onClick={() => setIndex(value => value - 1)}><ArrowLeft size={14}/>{copy.back}</button>
      {index === 0 && page && page.offset > 0 && <button type="button" disabled={busy} onClick={() => { setCursors([undefined]); setAttempt(value => value + 1); }}>{copy.start}</button>}
      <span role="status">{busy ? copy.loadingText : page ? `${page.totalCharacters ? page.offset + 1 : 0}–${page.offset + page.returnedCharacters} / ${page.totalCharacters.toLocaleString(locale)} ${copy.characters}` : copy.textUnavailable}</span>
      <button type="button" disabled={busy || !page?.nextCursor} onClick={() => { if (!page?.nextCursor) return; setCursors(value => [...value.slice(0, index + 1), page.nextCursor]); setIndex(value => value + 1); }}>{copy.next}<ArrowRight size={14}/></button>
      <button type="button" onClick={onClose} title={copy.backToPreview}><X size={14}/>{copy.preview}</button>
    </div>
    {error && <div className="imap-error" role="alert">{error}<button type="button" onClick={() => setAttempt(value => value + 1)}>{copy.reload}</button><button type="button" onClick={() => { setCursors([undefined]); setIndex(0); setAttempt(value => value + 1); }}>{copy.fromStart}</button></div>}
    {!busy && page && <div className="imap-body-text">{page.text || copy.emptyText}</div>}
  </div>;
}

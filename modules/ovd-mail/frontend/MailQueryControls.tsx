import { useId, useState } from 'react';
import { ChevronDown, Filter, RotateCcw } from 'lucide-react';
import type { ImapFolder, MailAccountSummary } from '../../../shared/mail';
import type { MailCountRequest, MailCountResult, MailFilter, MailQueryRequest } from '../../../shared/mail-query';
import './mail-query-controls.css';

const periods = [
  ['', 'Jederzeit'], ['today', 'Heute'], ['yesterday', 'Gestern'], ['this_week', 'Diese Woche'],
  ['last_week', 'Letzte Woche'], ['this_month', 'Dieser Monat'], ['last_month', 'Letzter Monat'],
  ['last_7_days', 'Letzte 7 Tage'], ['last_30_days', 'Letzte 30 Tage'], ['custom', 'Eigener Zeitraum']
] as const;
type Period = NonNullable<MailFilter['received']>['period'];

export function MailQueryControls({ accounts, folders, accountId, folder, busy, hidden = false, summary, onQuery, onCount, onReset }: {
  accounts: MailAccountSummary[]; folders: ImapFolder[]; accountId: string; folder: string; busy: boolean;
  hidden?: boolean;
  summary?: MailCountResult;
  onQuery(request: MailQueryRequest): Promise<void>;
  onCount(request: MailCountRequest): Promise<void>;
  onReset(): void;
}) {
  const id = useId();
  const [account, setAccount] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [text, setText] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [subject, setSubject] = useState('');
  const [read, setRead] = useState('');
  const [period, setPeriod] = useState<Period | ''>('');
  const [startDate, setStartDate] = useState(''), [endDate, setEndDate] = useState('');
  const [sort, setSort] = useState<NonNullable<MailQueryRequest['sort']>>('received_desc');
  const [error, setError] = useState('');
  const allAccounts = account === '__all__';
  const activeFilters = [text.trim(), from.trim(), to.trim(), subject.trim(), read, period].filter(Boolean).length;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function request(): MailQueryRequest {
    const filter: NonNullable<MailQueryRequest['filter']> = {
      ...(text.trim() ? { text: text.trim() } : {}), ...(from.trim() ? { from: from.trim() } : {}),
      ...(to.trim() ? { to: to.trim() } : {}), ...(subject.trim() ? { subject: subject.trim() } : {}),
      ...(read ? { read: read === 'read' } : {}),
      ...(period ? { received: { period, timeZone, ...(period === 'custom' ? { startDate, endDate } : {}) } } : {})
    };
    return {
      ...(allAccounts ? { allAccounts: true } : account || accountId ? { accountId: account || accountId } : {}),
      ...(selectedFolder === '__all__' ? { allFolders: true } : selectedFolder === '__current__' && folder ? { folders: [folder] } : selectedFolder && !allAccounts ? { folders: [selectedFolder] } : {}),
      filter, sort, limit: 20
    };
  }
  async function run(countOnly: boolean) {
    if (busy) return;
    setError('');
    if (period === 'custom' && (!startDate || !endDate || endDate <= startDate)) { setError('Bitte einen gültigen Zeitraum angeben. Das Bis-Datum liegt nach dem Von-Datum.'); return; }
    try {
      const query = request();
      if (countOnly) { const { sort: _sort, limit: _limit, cursor: _cursor, ...count } = query; await onCount(count); }
      else await onQuery(query);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Mailabfrage konnte nicht ausgeführt werden.'); }
  }
  function reset() {
    setAccount(''); setSelectedFolder(''); setText(''); setFrom(''); setTo(''); setSubject(''); setRead(''); setPeriod(''); setStartDate(''); setEndDate(''); setSort('received_desc'); setError(''); onReset();
  }

  return <section className="mail-query-controls" aria-label="Mailfilter und Zählung" hidden={hidden}>
    <details className="mail-query-details">
      <summary><Filter size={14} aria-hidden="true"/><span>Filter & Anzahl</span>{activeFilters > 0 && <small>{activeFilters} Filter</small>}<ChevronDown size={13} aria-hidden="true"/></summary>
      <form className="mail-query-form" onSubmit={event => { event.preventDefault(); void run(false); }}>
        <div className="mail-query-fields">
          <label htmlFor={`${id}-account`}>Konto<select id={`${id}-account`} value={account} disabled={busy} onChange={event => { setAccount(event.target.value); setSelectedFolder(''); }}><option value="">Aktives Konto{accounts.find(item => item.id === accountId)?.name ? ` · ${accounts.find(item => item.id === accountId)?.name}` : ''}</option><option value="__all__">Alle Konten</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select></label>
          <label htmlFor={`${id}-folder`}>Ordner<select id={`${id}-folder`} value={selectedFolder} disabled={busy} onChange={event => setSelectedFolder(event.target.value)}><option value="">Posteingang</option><option value="__all__">Alle Ordner</option>{!allAccounts && folder && <option value="__current__">Aktueller Ordner · {folder}</option>}{!allAccounts && (account === '' || account === accountId) && folders.filter(item => item.selectable).map(item => <option key={item.path} value={item.path}>{item.name || item.path}</option>)}</select></label>
          <label htmlFor={`${id}-text`}>Suchtext<input id={`${id}-text`} type="search" value={text} maxLength={200} placeholder="Zum Beispiel Calimoto" disabled={busy} onChange={event => setText(event.target.value)}/></label>
          <label htmlFor={`${id}-from`}>Absender<input id={`${id}-from`} value={from} maxLength={200} placeholder="Name oder Adresse" disabled={busy} onChange={event => setFrom(event.target.value)}/></label>
          <label htmlFor={`${id}-to`}>Empfänger<input id={`${id}-to`} value={to} maxLength={200} placeholder="Name oder Adresse" disabled={busy} onChange={event => setTo(event.target.value)}/></label>
          <label htmlFor={`${id}-subject`}>Betreff<input id={`${id}-subject`} value={subject} maxLength={200} disabled={busy} onChange={event => setSubject(event.target.value)}/></label>
          <label htmlFor={`${id}-read`}>Gelesen-Status<select id={`${id}-read`} value={read} disabled={busy} onChange={event => setRead(event.target.value)}><option value="">Alle Nachrichten</option><option value="unread">Ungelesen</option><option value="read">Gelesen</option></select></label>
          <label htmlFor={`${id}-period`}>Eingegangen<select id={`${id}-period`} value={period} disabled={busy} onChange={event => setPeriod(event.target.value as Period | '')}>{periods.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          {period === 'custom' && <><label htmlFor={`${id}-start`}>Von<input id={`${id}-start`} type="date" value={startDate} required disabled={busy} onChange={event => setStartDate(event.target.value)}/></label><label htmlFor={`${id}-end`}>Bis (ausschließlich)<input id={`${id}-end`} type="date" value={endDate} required min={startDate || undefined} disabled={busy} onChange={event => setEndDate(event.target.value)}/></label></>}
          <label htmlFor={`${id}-sort`}>Sortierung<select id={`${id}-sort`} value={sort} disabled={busy} onChange={event => setSort(event.target.value as typeof sort)}><option value="received_desc">Neueste Eingänge zuerst</option><option value="received_asc">Älteste Eingänge zuerst</option><option value="sent_desc">Neuestes Absenderdatum zuerst</option><option value="sent_asc">Ältestes Absenderdatum zuerst</option><option value="uid_desc">Zuletzt im Ordner aufgenommen</option></select></label>
        </div>
        <div className="mail-query-actions"><button type="submit" disabled={busy || !accounts.length}>{busy ? 'Wird abgefragt …' : 'Mails anzeigen'}</button><button type="button" disabled={busy || !accounts.length} onClick={() => void run(true)}>Nur Anzahl</button><button type="button" className="mail-query-reset" disabled={busy} onClick={reset}><RotateCcw size={12} aria-hidden="true"/>Zurücksetzen</button><small>Serverabfrage · Zeiträume in {timeZone}</small></div>
        {selectedFolder === '__all__' && <p className="mail-query-scope-note">Alle Ordner umfassen auch Gesendet, Spam und Papierkorb. Kopien derselben Mail in mehreren Ordnern zählen jeweils einzeln.</p>}
      </form>
    </details>
    {error && <p className="mail-query-error" role="alert">{error}</p>}
    {summary && <div className={`mail-query-summary${!summary.complete || !summary.countExact ? ' is-partial' : ''}`} role="status"><strong>{summary.countExact ? '' : 'Mindestens '}{summary.count.toLocaleString('de-DE')} {summary.count === 1 ? 'Nachricht' : 'Nachrichten'}{!summary.complete || !summary.countExact ? ' · Teilergebnis' : ''}</strong><span>{summary.scope}</span><small>Stand: {new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(summary.observedAt))}</small>{summary.resolvedRange && <small>Empfangszeit: {new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: summary.resolvedRange.timeZone || timeZone }).format(new Date(summary.resolvedRange.start))} bis {new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: summary.resolvedRange.timeZone || timeZone }).format(new Date(summary.resolvedRange.end))} (ausschließlich) · {summary.resolvedRange.timeZone || timeZone}</small>}{summary.warnings?.map(warning => <small key={warning}>{warning}</small>)}</div>}
  </section>;
}

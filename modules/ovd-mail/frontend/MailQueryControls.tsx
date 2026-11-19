import { useUiLocale } from '../../../src/locale';
import { mailText } from './mail-locale';
import { useEffect, useId, useState } from 'react';
import { ChevronDown, Filter, RotateCcw } from 'lucide-react';
import type { ImapFolder, MailAccountSummary } from '../../../shared/mail';
import type { MailCountRequest, MailCountResult, MailFilter, MailQueryRequest } from '../../../shared/mail-query';
import './mail-query-controls.css';


type Period = NonNullable<MailFilter['received']>['period'];

export function MailQueryControls({ accounts, folders, accountId, folder, busy, hidden = false, summary, onQuery, onCount, onReset }: {
  accounts: MailAccountSummary[]; folders: ImapFolder[]; accountId: string; folder: string; busy: boolean;
  hidden?: boolean;
  summary?: MailCountResult;
  onQuery(request: MailQueryRequest): Promise<void>;
  onCount(request: MailCountRequest): Promise<void>;
  onReset(): void;
}) {
  const locale = useUiLocale();
  const copy = mailText[locale];
  const periods = [
    ['', copy.anyTime], ['today', copy.today], ['yesterday', copy.yesterday], ['this_week', copy.thisWeek],
    ['last_week', copy.lastWeek], ['this_month', copy.thisMonth], ['last_month', copy.lastMonth],
    ['last_7_days', copy.lastWeekDays], ['last_30_days', copy.last30], ['custom', copy.customRange]
  ] as const;
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
  const queryAccountId = allAccounts ? '' : account || accountId;
  const usesActiveFolders = queryAccountId === accountId;
  const [accountFolders, setAccountFolders] = useState<{ accountId: string; items: ImapFolder[]; loading: boolean; error?: string }>();
  const availableFolders = usesActiveFolders ? folders : accountFolders?.accountId === queryAccountId ? accountFolders.items : [];
  const foldersLoading = !usesActiveFolders && !!queryAccountId && (accountFolders?.accountId !== queryAccountId || accountFolders.loading);
  const activeFilters = [text.trim(), from.trim(), to.trim(), subject.trim(), read, period].filter(Boolean).length;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const partial = !!summary && (!summary.complete || !summary.countExact);
  const resultLabel = summary ? `${summary.countExact ? '' : copy.atLeast + " "}${summary.count.toLocaleString(locale)} ${summary.count === 1 ? copy.message : copy.messages}${partial ? " " + copy.partialResult : ''}` : '';

  useEffect(() => { setSelectedFolder(''); }, [queryAccountId, usesActiveFolders]);
  useEffect(() => {
    if (!queryAccountId || usesActiveFolders) return;
    let active = true;
    setAccountFolders({ accountId: queryAccountId, items: [], loading: true });
    void window.workspace.listMailFolders(queryAccountId).then(items => {
      if (active) setAccountFolders({ accountId: queryAccountId, items, loading: false });
    }).catch(reason => {
      if (active) setAccountFolders({ accountId: queryAccountId, items: [], loading: false, error: reason instanceof Error ? reason.message : copy.foldersFailed });
    });
    return () => { active = false; };
  }, [queryAccountId, usesActiveFolders]);

  function request(): MailQueryRequest {
    const filter: NonNullable<MailQueryRequest['filter']> = {
      ...(text.trim() ? { text: text.trim() } : {}), ...(from.trim() ? { from: from.trim() } : {}),
      ...(to.trim() ? { to: to.trim() } : {}), ...(subject.trim() ? { subject: subject.trim() } : {}),
      ...(read ? { read: read === 'read' } : {}),
      ...(period ? { received: { period, timeZone, ...(period === 'custom' ? { startDate, endDate } : {}) } } : {})
    };
    return {
      ...(allAccounts ? { allAccounts: true } : account || accountId ? { accountId: account || accountId } : {}),
      ...(selectedFolder === '__all__' ? { allFolders: true } : selectedFolder === '__current__' ? usesActiveFolders && folder ? { folders: [folder] } : {} : selectedFolder && !allAccounts ? { folders: [selectedFolder] } : {}),
      filter, sort, limit: 20
    };
  }
  async function run(countOnly: boolean) {
    if (busy) return;
    setError('');
    if (period === 'custom' && (!startDate || !endDate || endDate <= startDate)) { setError(copy.badRange); return; }
    try {
      const query = request();
      if (countOnly) { const { sort: _sort, limit: _limit, cursor: _cursor, ...count } = query; await onCount(count); }
      else await onQuery(query);
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.queryFailed); }
  }
  function reset() {
    setAccount(''); setSelectedFolder(''); setText(''); setFrom(''); setTo(''); setSubject(''); setRead(''); setPeriod(''); setStartDate(''); setEndDate(''); setSort('received_desc'); setError(''); onReset();
  }

  return <section className="mail-query-controls" aria-label={copy.filterAndCount} hidden={hidden}>
    <details className="mail-query-details">
      <summary><Filter size={14} aria-hidden="true"/><span>{copy.filters}</span>{activeFilters > 0 && <small>{activeFilters} Filter</small>}{summary && <span className={`mail-query-result-count${partial ? ' is-partial' : ''}`} role="status">{resultLabel}</span>}<ChevronDown size={13} aria-hidden="true"/></summary>
      {summary && <div className={`mail-query-summary${partial ? ' is-partial' : ''}`} aria-label={copy.queryResult}><strong>{resultLabel}</strong><span>{summary.scope}</span><small>{copy.asOf} {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(summary.observedAt))}</small>{summary.resolvedRange && <small>{copy.receivedTimeLabel} {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone: summary.resolvedRange.timeZone || timeZone }).format(new Date(summary.resolvedRange.start))} {copy.until} {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone: summary.resolvedRange.timeZone || timeZone }).format(new Date(summary.resolvedRange.end))} {copy.exclusive} {summary.resolvedRange.timeZone || timeZone}</small>}{summary.warnings?.map(warning => <small key={warning}>{warning}</small>)}</div>}
      <form className="mail-query-form" onSubmit={event => { event.preventDefault(); void run(false); }}>
        <div className="mail-query-fields">
          <label htmlFor={`${id}-account`}>{copy.account}<select id={`${id}-account`} value={account} disabled={busy} onChange={event => { setAccount(event.target.value); setSelectedFolder(''); }}><option value="">{copy.activeAccount}{accounts.find(item => item.id === accountId)?.name ? ` · ${accounts.find(item => item.id === accountId)?.name}` : ''}</option><option value="__all__">{copy.allAccounts}</option>{accounts.map(item => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}</select></label>
          <label htmlFor={`${id}-folder`}>{copy.folder}<select id={`${id}-folder`} value={selectedFolder} disabled={busy} aria-busy={foldersLoading} onChange={event => setSelectedFolder(event.target.value)}><option value="">{copy.inbox}</option><option value="__all__">{copy.allFolders}</option>{!allAccounts && usesActiveFolders && folder && <option value="__current__">{copy.currentFolder} {folder}</option>}{!allAccounts && availableFolders.filter(item => item.selectable && item.path.toLowerCase() !== 'inbox').map(item => <option key={item.path} value={item.path}>{item.name || item.path}</option>)}{foldersLoading && <option disabled>{copy.loadingFolders}</option>}</select></label>
          <label htmlFor={`${id}-text`}>{copy.searchText}<input id={`${id}-text`} type="search" value={text} maxLength={200} disabled={busy} onChange={event => setText(event.target.value)}/></label>
          <label htmlFor={`${id}-from`}>{copy.sender}<input id={`${id}-from`} value={from} maxLength={200} placeholder={copy.nameAddress} disabled={busy} onChange={event => setFrom(event.target.value)}/></label>
          <label htmlFor={`${id}-to`}>{copy.recipient}<input id={`${id}-to`} value={to} maxLength={200} placeholder={copy.nameAddress} disabled={busy} onChange={event => setTo(event.target.value)}/></label>
          <label htmlFor={`${id}-subject`}>{copy.subject}<input id={`${id}-subject`} value={subject} maxLength={200} disabled={busy} onChange={event => setSubject(event.target.value)}/></label>
          <label htmlFor={`${id}-read`}>{copy.readStatus}<select id={`${id}-read`} value={read} disabled={busy} onChange={event => setRead(event.target.value)}><option value="">{copy.allMessages}</option><option value="unread">{copy.unread}</option><option value="read">{copy.read}</option></select></label>
          <label htmlFor={`${id}-period`}>{copy.received}<select id={`${id}-period`} value={period} disabled={busy} onChange={event => setPeriod(event.target.value as Period | '')}>{periods.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          {period === 'custom' && <><label htmlFor={`${id}-start`}>{copy.from}<input id={`${id}-start`} type="date" value={startDate} required disabled={busy} onChange={event => setStartDate(event.target.value)}/></label><label htmlFor={`${id}-end`}>{copy.exclusiveEnd}<input id={`${id}-end`} type="date" value={endDate} required min={startDate || undefined} disabled={busy} onChange={event => setEndDate(event.target.value)}/></label></>}
          <label htmlFor={`${id}-sort`}>{copy.sort}<select id={`${id}-sort`} value={sort} disabled={busy} onChange={event => setSort(event.target.value as typeof sort)}><option value="received_desc">{copy.receivedNewest}</option><option value="received_asc">{copy.receivedOldest}</option><option value="sent_desc">{copy.sentNewest}</option><option value="sent_asc">{copy.sentOldest}</option><option value="uid_desc">{copy.uidNewest}</option></select></label>
        </div>
        {!usesActiveFolders && accountFolders?.accountId === queryAccountId && accountFolders.error && <p className="mail-query-error" role="alert">{accountFolders.error}</p>}
        <div className="mail-query-actions"><button type="submit" disabled={busy || !accounts.length}>{busy ? copy.querying : copy.showMessages}</button><button type="button" disabled={busy || !accounts.length} onClick={() => void run(true)}>{copy.countOnly}</button><button type="button" className="mail-query-reset" disabled={busy} onClick={reset}><RotateCcw size={12} aria-hidden="true"/>{copy.reset}</button><small>{copy.queryZone} {timeZone}</small></div>
        {selectedFolder === '__all__' && <p className="mail-query-scope-note">{copy.allFolderHint}</p>}
      </form>
    </details>
    {error && <p className="mail-query-error" role="alert">{error}</p>}
  </section>;
}

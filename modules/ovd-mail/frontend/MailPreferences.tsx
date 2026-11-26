import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { MAIL_POLL_INTERVALS, mailPreferences, mailPreferencesSchema } from '../../../shared/mail-preferences';
import type { MailAccountSummary } from '../../../shared/mail';
import { MailSuggestion, type MailSuggestionProps } from './MailSuggestion';
import { accountIssue, useAccountText, intervalText } from './account-copy';
import { useUiLocale } from '../../../src/locale';
import { useFormFeedback } from '../../../src/form-feedback';
import type { MailAccountStatus } from './MailAccounts';

export function MailPreferences({ account, suggestions, onDismissSuggestion, searchQuery, peerBusy, onStatus }: MailSuggestionProps & {
  account: MailAccountSummary; searchQuery: string; peerBusy: boolean;
  onStatus(status: MailAccountStatus): void;
}) {
  const [baseline, setBaseline] = useState(() => mailPreferences(account));
  const [values, setValues] = useState(() => mailPreferences(account));
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const copy = useAccountText(), locale = useUiLocale();
  const [error, setError] = useFormFeedback(copy, locale), [notice, setNotice] = useFormFeedback(copy, locale);
  const form = useRef<HTMLFormElement>(null), waitingForSaved = useRef<string | undefined>(undefined);
  const savedKey = JSON.stringify(mailPreferences(account));
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const locked = busy || peerBusy;
  const status = busy ? 'busy' : dirty ? 'dirty' : 'clean';
  useLayoutEffect(() => { onStatus(status); }, [status, onStatus]);
  useEffect(() => () => onStatus('clean'), [onStatus]);
  useEffect(() => {
    if (dirty || busy || waitingForSaved.current && savedKey !== waitingForSaved.current) return;
    waitingForSaved.current = undefined;
    if (savedKey !== JSON.stringify(baseline)) { const saved = mailPreferences(account); setBaseline(saved); setValues(saved); }
  }, [savedKey, account, baseline, dirty, busy]);
  useEffect(() => { if (suggestions[0]) setOpen(true); }, [suggestions[0]?.token]);
  function update(patch: Partial<typeof values>) { setValues(current => ({ ...current, ...patch })); setError(''); setNotice(''); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !form.current?.reportValidity()) return;
    const parsed = mailPreferencesSchema.safeParse({ accountId: account.id, ...values });
    if (!parsed.success) { setError(c => c.checkPreferences); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await window.workspace.saveMailPreferences(parsed.data);
      const { accountId: _accountId, ...saved } = parsed.data;
      waitingForSaved.current = JSON.stringify(saved); setBaseline(saved); setValues(saved);
      setNotice(c => c.preferencesSaved);
    } catch (reason) { setError((c, language) => accountIssue(reason, language) || c.preferencesFail); }
    finally { setBusy(false); }
  }
  const id = `preferences-${account.id}`;
  const intervalLabel = intervalText(copy, baseline.pollIntervalSeconds);
  return <details className="mail-connection-group mail-preferences-group" open={!!searchQuery.trim() || open} onToggle={event => { if (event.target === event.currentTarget && !searchQuery.trim()) setOpen(event.currentTarget.open); }}>
    <summary><span><strong>{copy.preferences}</strong><small>{baseline.senderName || copy.senderEmpty} · {baseline.signature ? copy.signatureSet : copy.signatureEmpty} · {intervalLabel}{dirty ? ` · ${copy.pending}` : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
    <form ref={form} className="mail-preferences-form" data-protocol="preferences" data-status={status} onSubmit={event => void save(event)}>
      <MailSuggestion kind="mail-preferences" suggestions={suggestions} onDismissSuggestion={onDismissSuggestion} current={values} baseline={baseline} disabled={locked} onApply={update} />
      <fieldset disabled={locked}>
        <div className="mail-account-field"><label htmlFor={`${id}-sender`}>{copy.fields.senderName}</label><input id={`${id}-sender`} maxLength={120} autoComplete="name" value={values.senderName} onChange={event => update({ senderName: event.target.value })} placeholder={copy.senderExample} /><p>{copy.emailOnly(account.email)}</p></div>
        <div className="mail-account-field"><label htmlFor={`${id}-signature`}>{copy.fields.signature}</label><textarea id={`${id}-signature`} rows={4} maxLength={5000} value={values.signature} onChange={event => update({ signature: event.target.value })} placeholder={copy.signatureExample} /><p>{copy.signatureHint}</p></div>
        <div className="mail-account-field mail-retrieval-field"><label htmlFor={`${id}-interval`}>{copy.fields.pollIntervalSeconds}</label><select id={`${id}-interval`} value={values.pollIntervalSeconds} onChange={event => update({ pollIntervalSeconds: Number(event.target.value) })}>{MAIL_POLL_INTERVALS.map(value => <option key={value} value={value}>{intervalText(copy, value)}</option>)}</select><p>{copy.backgroundHint}</p></div>
        {dirty && <p className="mail-account-unsaved">{copy.pending}</p>}
        <div className="mail-account-actions">{dirty && <button className="mail-account-check" type="button" onClick={() => { setValues(baseline); setError(''); setNotice(c => c.discarded); }}>{copy.discard}</button>}<button className="mail-account-save" type="submit" disabled={!dirty}>{busy ? copy.saving : copy.savePreferences}</button></div>
      </fieldset>
      {error && <p className="mail-account-feedback error" role="alert">{error}</p>}{notice && <p className="mail-account-feedback success" role="status">{notice}</p>}
    </form>
  </details>;
}

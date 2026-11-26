import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, Mail, MailPlus, Trash2 } from 'lucide-react';
import type { MailAccountInput, MailAccountSummary, SmtpConfig, SmtpInput } from '../../../shared/mail';
import { mailSuggestionSchemas } from '../settings-suggestions';
import { MailSuggestion, type MailSuggestionProps } from './MailSuggestion';
import { accountIssue, useAccountText } from './account-copy';
import { useFormFeedback } from '../../../src/form-feedback';
import { useUiLocale } from '../../../src/locale';
import { MailPreferences } from './MailPreferences';
import './mail-accounts.css';

export type { MailAccountInput, MailAccountSummary } from '../../../shared/mail';
export type MailSecurity = 'tls' | 'starttls';
export type MailAccountStatus = 'clean' | 'dirty' | 'busy';
type ImapForm = Pick<MailAccountSummary, 'name' | 'email' | 'host' | 'port' | 'security' | 'username'> & { password: string };
type SmtpForm = { host: string; port: number; security: MailSecurity; username: string; useImapCredentials: boolean; password: string };

const emptyImap = (): ImapForm => ({ name: '', email: '', host: '', port: 993, security: 'tls', username: '', password: '' });
const imapForm = (account?: MailAccountSummary): ImapForm => account ? { name: account.name, email: account.email, host: account.host, port: account.port, security: account.security, username: account.username, password: '' } : emptyImap();
const imapKey = (account?: Omit<ImapForm, 'password'>): string => account ? JSON.stringify([account.name, account.email, account.host, account.port, account.security, account.username]) : '';
const connectionKey = (value: Pick<ImapForm, 'host' | 'port' | 'security' | 'username'>): string => JSON.stringify([value.host.trim().toLowerCase(), value.port, value.security, value.username.trim()]);
const smtpKey = (value?: SmtpConfig): string => value ? JSON.stringify([value.accountId, value.host, value.port, value.security, value.username, value.useImapCredentials]) : '';
const smtpForm = (config: SmtpConfig | undefined, account: MailAccountSummary): SmtpForm => ({ host: config?.host ?? '', port: config?.port ?? 587, security: config?.security ?? 'starttls', username: config?.username ?? account.username, useImapCredentials: config?.useImapCredentials ?? true, password: '' });
const accountIdentity = (account: Pick<MailAccountSummary, 'email' | 'host' | 'username'>): string => JSON.stringify([account.email, account.host.toLowerCase(), account.username]);
const normalize = (value: string): string => value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
const searchWords = 'account accounts settings incoming outgoing retrieval polling interval refresh check checks every minutes manual signature sender password credentials encryption host address mailbox username login absender absendername sender signatur signature unterschrift abruf abrufzeit abrufzeiten intervall automatisch hintergrund manuell minuten mail e-mail email konto konten postfach allgemein kontoname anzeigename bearbeiten andern konfiguration adresse empfang posteingang imap versand senden postausgang smtp server host port verschlusselung tls starttls benutzername login passwort zugang';
const matchesAccount = (query: string, account: MailAccountSummary, smtp?: SmtpConfig): boolean => {
  const haystack = normalize(`${searchWords} ${account.name} ${account.email} ${account.senderName ?? ''} ${account.host} ${account.username} ${smtp?.host ?? ''} ${smtp?.username ?? ''}`);
  return normalize(query).split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
};

function useReportedStatus(status: MailAccountStatus, onStatus: (status: MailAccountStatus) => void) {
  useLayoutEffect(() => { onStatus(status); }, [status, onStatus]);
  useEffect(() => () => onStatus('clean'), [onStatus]);
}
function validateForm(form: HTMLFormElement | null, reveal: () => void): boolean {
  if (!form) return false;
  if (form.querySelector(':invalid')) {
    reveal();
    for (const details of form.querySelectorAll('details')) details.open = true;
  }
  return form.reportValidity();
}

function ImapSettings({ account, suggestions, onDismissSuggestion, searchQuery, peerBusy, onTest, onSave, onSaved, onStatus }: MailSuggestionProps & {
  account?: MailAccountSummary; searchQuery: string; peerBusy: boolean;
  onTest(input: MailAccountInput): Promise<void>; onSave(input: MailAccountInput): Promise<void>; onSaved?(input: MailAccountInput): void; onStatus(status: MailAccountStatus): void;
}) {
  const [baseline, setBaseline] = useState(account);
  const [values, setValues] = useState<ImapForm>(() => imapForm(account));
  const [imapOpen, setImapOpen] = useState(!account);
  const [busy, setBusy] = useState<'test' | 'save'>();
  const copy = useAccountText(), locale = useUiLocale();
  const [error, setError] = useFormFeedback(copy, locale), [notice, setNotice] = useFormFeedback(copy, locale);
  const form = useRef<HTMLFormElement>(null), waitingForSaved = useRef<string | undefined>(undefined);
  const usernameEdited = useRef(!!account);
  const initial = imapForm(baseline);
  const dirty = imapKey(values) !== imapKey(initial) || !!values.password;
  const passwordRequired = !account || !!baseline && connectionKey(values) !== connectionKey(baseline);
  const locked = !!busy || peerBusy;
  const savedKey = imapKey(account);
  useEffect(() => {
    if (!account || dirty || busy) return;
    if (waitingForSaved.current && savedKey !== waitingForSaved.current) return;
    waitingForSaved.current = undefined;
    if (savedKey !== imapKey(baseline)) { setBaseline(account); setValues(imapForm(account)); }
  }, [savedKey, account, baseline, dirty, busy]);
  useEffect(() => { if (suggestions[0]) setImapOpen(true); }, [suggestions[0]?.token]);
  useReportedStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean', onStatus);

  function update(patch: Partial<ImapForm>) { setValues(current => ({ ...current, ...patch })); setError(''); setNotice(''); }
  function changeEmail(email: string) { setValues(current => ({ ...current, email, ...(!account && !usernameEdited.current ? { username: email } : {}) })); setError(''); setNotice(''); }
  function input(): MailAccountInput {
    return { ...(account ? { accountId: account.id } : {}), name: values.name.trim(), email: values.email.trim(), host: values.host.trim(), port: values.port, security: values.security, username: values.username.trim(), ...(values.password ? { password: values.password } : {}) };
  }
  function reset() { setValues(imapForm(baseline)); usernameEdited.current = !!account; setError(''); setNotice(c => c.discarded); }
  async function test() {
    if (locked || !validateForm(form.current, () => setImapOpen(true))) return;
    setBusy('test'); setError(''); setNotice('');
    try { await onTest(input()); setNotice(c => c.imapTested); }
    catch (reason) { setError((c, language) => accountIssue(reason, language) || c.imapFail); }
    finally { setBusy(undefined); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !validateForm(form.current, () => setImapOpen(true))) return;
    setBusy('save'); setError(''); setNotice('');
    const submitted = input();
    try {
      await onSave(submitted);
      if (account) {
        const saved = { id: account.id, name: submitted.name, email: submitted.email, host: submitted.host, port: submitted.port, security: submitted.security, username: submitted.username };
        waitingForSaved.current = imapKey(saved); setBaseline(saved); setValues(imapForm(saved));
        setNotice(c => c.imapSaved);
      } else { setValues(emptyImap()); usernameEdited.current = false; setNotice(c => c.created); }
      onSaved?.(submitted);
    } catch (reason) { setError((c, language) => accountIssue(reason, language) || c.accountSaveFail); }
    finally { setBusy(undefined); }
  }
  const id = `imap-${account?.id ?? 'new'}`;
  return <form className="mail-account-form" data-protocol="imap" data-status={busy ? 'busy' : dirty ? 'dirty' : 'clean'} ref={form} noValidate onSubmit={event => void save(event)}>
    <fieldset disabled={locked}>
      <details className="mail-connection-group imap-group" open={!!searchQuery.trim() || imapOpen} onToggle={event => { if (!searchQuery.trim()) setImapOpen(event.currentTarget.open); }}>
        <summary><span><strong>{copy.account}</strong><small>{baseline ? `${baseline.host}:${baseline.port} · ${baseline.security === 'tls' ? 'TLS' : 'STARTTLS'}` : copy.incomingHint}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="mail-connection-fields"><MailSuggestion kind="account" suggestions={suggestions} onDismissSuggestion={onDismissSuggestion} current={values} baseline={initial} inferUsername={!account && !usernameEdited.current} disabled={locked} onApply={patch => {
          if (patch.username !== undefined) usernameEdited.current = true;
          update(patch);
        }} /><section className="mail-general-fields" aria-label={copy.general}><h4>{copy.general}</h4><div className="mail-account-field"><label htmlFor={`${id}-name`}>{copy.fields.name}</label><input id={`${id}-name`} required maxLength={120} autoComplete="name" value={values.name} onChange={event => update({ name: event.target.value })} placeholder={copy.nameExample} /></div><div className="mail-account-field"><label htmlFor={`${id}-email`}>{copy.fields.email}</label><input id={`${id}-email`} type="email" required maxLength={320} autoComplete="email" spellCheck={false} value={values.email} onChange={event => changeEmail(event.target.value)} placeholder="name@example.com" /></div></section><div className="mail-account-field"><label htmlFor={`${id}-host`}>{copy.imapHost}</label><input id={`${id}-host`} required maxLength={253} autoComplete="off" spellCheck={false} value={values.host} onChange={event => update({ host: event.target.value })} placeholder="imap.example.com" /></div><div className="mail-account-grid"><div className="mail-account-field"><label htmlFor={`${id}-security`}>{copy.fields.security}</label><select id={`${id}-security`} value={values.security} onChange={event => { const security = event.target.value as MailSecurity; update({ security, ...([993, 143].includes(values.port) ? { port: security === 'tls' ? 993 : 143 } : {}) }); }}><option value="tls">{copy.directTls}</option><option value="starttls">STARTTLS</option></select></div><div className="mail-account-field"><label htmlFor={`${id}-port`}>Port</label><input id={`${id}-port`} type="number" required min={1} max={65535} value={values.port || ''} onChange={event => update({ port: Number(event.target.value) })} /></div></div><div className="mail-account-field"><label htmlFor={`${id}-user`}>{copy.imapUser}</label><input id={`${id}-user`} required maxLength={320} autoComplete="username" spellCheck={false} value={values.username} onChange={event => { usernameEdited.current = true; update({ username: event.target.value }); }} /></div><div className="mail-account-field"><label htmlFor={`${id}-password`}>{copy.imapPassword}</label><input id={`${id}-password`} type="password" required={passwordRequired} maxLength={4096} autoComplete="new-password" value={values.password} onChange={event => update({ password: event.target.value })} placeholder={account && !passwordRequired ? copy.keepPassword : copy.enterPassword} />{(!account || passwordRequired) && <p>{account ? copy.newPassword : copy.appPassword}</p>}</div>
      {dirty && <p className="mail-account-unsaved">{copy.imapPending}</p>}
      <div className="mail-account-actions">{dirty && <button className="mail-account-check" type="button" onClick={reset}>{copy.discard}</button>}<button className="mail-account-check" type="button" onClick={() => void test()}>{busy === 'test' ? copy.checkingImap : copy.checkImap}</button><button className="mail-account-save" type="submit" disabled={!!account && !dirty}>{busy === 'save' ? copy.saving : account ? copy.saveImap : copy.create}</button></div>
      {error && <p className="mail-account-feedback error" role="alert">{error}</p>}{notice && <p className="mail-account-feedback success" role="status">{notice}</p>}</div>
      </details>

    </fieldset>
  </form>;
}

function SmtpSettings({ account, config, suggestions, onDismissSuggestion, searchQuery, peerBusy, peerDirty, onTest, onSave, onStatus }: MailSuggestionProps & {
  account: MailAccountSummary; config?: SmtpConfig; searchQuery: string; peerBusy: boolean; peerDirty: boolean;
  onTest(input: SmtpInput): Promise<void>; onSave(input: SmtpInput): Promise<void>; onStatus(status: MailAccountStatus): void;
}) {
  const [baseline, setBaseline] = useState(config), [values, setValues] = useState<SmtpForm>(() => smtpForm(config, account));
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<'test' | 'save'>();
  const copy = useAccountText(), locale = useUiLocale();
  const [error, setError] = useFormFeedback(copy, locale), [notice, setNotice] = useFormFeedback(copy, locale);
  const form = useRef<HTMLFormElement>(null), waitingForSaved = useRef<string | undefined>(undefined);
  const initial = smtpForm(baseline, account);
  const dirty = values.host !== initial.host || values.port !== initial.port || values.security !== initial.security || values.useImapCredentials !== initial.useImapCredentials || !values.useImapCredentials && values.username !== initial.username || !!values.password;
  const locked = !!busy || peerBusy;
  const savedKey = smtpKey(config);
  useEffect(() => {
    if (dirty || busy || waitingForSaved.current && savedKey !== waitingForSaved.current) return;
    waitingForSaved.current = undefined;
    if (savedKey !== smtpKey(baseline)) { setBaseline(config); setValues(smtpForm(config, account)); }
  }, [savedKey, config, baseline, account, dirty, busy]);
  useEffect(() => { if (suggestions[0]) setOpen(true); }, [suggestions[0]?.token]);
  useReportedStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean', onStatus);
  function update(patch: Partial<SmtpForm>) { setValues(current => ({ ...current, ...patch })); setError(''); setNotice(''); }
  function input(): SmtpInput { return { accountId: account.id, host: values.host.trim(), port: values.port, security: values.security, username: values.useImapCredentials ? account.username : values.username.trim(), useImapCredentials: values.useImapCredentials, ...(!values.useImapCredentials && values.password ? { password: values.password } : {}) }; }
  function reset() { setValues(smtpForm(baseline, account)); setError(''); setNotice(c => c.discarded); }
  async function test() {
    if (locked || !validateForm(form.current, () => setOpen(true))) return;
    setBusy('test'); setError(''); setNotice('');
    try { await onTest(input()); setNotice(c => c.smtpTested); }
    catch (reason) { setError((c, language) => accountIssue(reason, language) || c.smtpFail); }
    finally { setBusy(undefined); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || !validateForm(form.current, () => setOpen(true))) return;
    setBusy('save'); setError(''); setNotice('');
    const submitted = input();
    try {
      await onSave(submitted);
      const saved: SmtpConfig = { accountId: account.id, host: submitted.host, port: submitted.port, security: submitted.security, username: submitted.username, useImapCredentials: submitted.useImapCredentials, hasPassword: !!submitted.password || !!baseline?.hasPassword };
      waitingForSaved.current = smtpKey(saved); setBaseline(saved); setValues(smtpForm(saved, account)); setNotice(c => c.smtpSaved);
    } catch (reason) { setError((c, language) => accountIssue(reason, language) || c.smtpSaveFail); }
    finally { setBusy(undefined); }
  }
  const id = `smtp-${account.id}`;
  return <details className="mail-connection-group smtp-group" open={!!searchQuery.trim() || open} onToggle={event => { if (!searchQuery.trim()) setOpen(event.currentTarget.open); }}>
    <summary><span><strong>{copy.outgoing}</strong><small>{baseline ? `${baseline.host}:${baseline.port} · ${baseline.security === 'tls' ? 'TLS' : 'STARTTLS'}` : copy.smtpUnset}{dirty ? ` · ${copy.pending}` : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
    <form className="smtp-form" data-protocol="smtp" data-status={busy ? 'busy' : dirty ? 'dirty' : 'clean'} ref={form} noValidate onSubmit={event => void save(event)}>
      <MailSuggestion kind="smtp" suggestions={suggestions} onDismissSuggestion={onDismissSuggestion} current={{ ...values, username: values.useImapCredentials ? account.username : values.username }} baseline={{ ...initial, username: initial.useImapCredentials ? account.username : initial.username }} disabled={locked} onApply={update} />
      <fieldset disabled={locked}><div className="mail-account-field"><label htmlFor={`${id}-host`}>{copy.smtpHost}</label><input id={`${id}-host`} required maxLength={253} autoComplete="off" spellCheck={false} value={values.host} onChange={event => update({ host: event.target.value })} placeholder="smtp.example.com" /></div><div className="mail-account-grid"><div className="mail-account-field"><label htmlFor={`${id}-security`}>{copy.fields.security}</label><select id={`${id}-security`} value={values.security} onChange={event => { const security = event.target.value as MailSecurity; update({ security, ...([465, 587].includes(values.port) ? { port: security === 'tls' ? 465 : 587 } : {}) }); }}><option value="starttls">STARTTLS</option><option value="tls">{copy.directTls}</option></select></div><div className="mail-account-field"><label htmlFor={`${id}-port`}>Port</label><input id={`${id}-port`} type="number" required min={1} max={65535} value={values.port || ''} onChange={event => update({ port: Number(event.target.value) })} /></div></div><label className="smtp-reuse"><input type="checkbox" checked={values.useImapCredentials} onChange={event => update({ useImapCredentials: event.target.checked })} /><span>{copy.fields.useImapCredentials}</span></label><div className="mail-account-field"><label htmlFor={`${id}-username`}>{copy.smtpUser}</label><input id={`${id}-username`} required maxLength={320} autoComplete="username" spellCheck={false} disabled={values.useImapCredentials} value={values.useImapCredentials ? account.username : values.username} onChange={event => update({ username: event.target.value })} />{values.useImapCredentials && peerDirty && <p>{copy.saveLoginFirst}</p>}</div>{!values.useImapCredentials && <div className="mail-account-field"><label htmlFor={`${id}-password`}>{copy.smtpPassword}</label><input id={`${id}-password`} type="password" required={!baseline?.hasPassword} maxLength={4096} autoComplete="new-password" value={values.password} onChange={event => update({ password: event.target.value })} placeholder={baseline?.hasPassword ? copy.keepPassword : copy.enterPassword} /></div>}{dirty && <p className="mail-account-unsaved">{copy.smtpPending}</p>}<div className="mail-account-actions">{dirty && <button className="mail-account-check" type="button" onClick={reset}>{copy.discard}</button>}<button className="mail-account-check" type="button" onClick={() => void test()}>{busy === 'test' ? copy.checkingSmtp : copy.checkSmtp}</button><button className="mail-account-save" type="submit" disabled={!!baseline && !dirty}>{busy === 'save' ? copy.saving : copy.saveSmtp}</button></div></fieldset>
      {error && <p className="mail-account-feedback error" role="alert">{error}</p>}{notice && <p className="mail-account-feedback success" role="status">{notice}</p>}
    </form>
  </details>;
}

function AccountGroup({ account, smtp, suggestions, onDismissSuggestion, searchQuery, autoOpen, onStatus, onTest, onSave, onRemove, onTestSmtp, onSaveSmtp }: MailSuggestionProps & {
  account: MailAccountSummary; smtp?: SmtpConfig; searchQuery: string; autoOpen: boolean; onStatus(id: string, status: MailAccountStatus): void;
  onTest(input: MailAccountInput): Promise<void>; onSave(input: MailAccountInput): Promise<void>; onRemove(id: string): Promise<boolean>; onTestSmtp(input: SmtpInput): Promise<void>; onSaveSmtp(input: SmtpInput): Promise<void>;
}) {
  const [open, setOpen] = useState(autoOpen), [imapStatus, setImapStatus] = useState<MailAccountStatus>('clean'), [smtpStatus, setSmtpStatus] = useState<MailAccountStatus>('clean'), [preferencesStatus, setPreferencesStatus] = useState<MailAccountStatus>('clean');
  const copy = useAccountText(), locale = useUiLocale();
  const [removing, setRemoving] = useState(false), [error, setError] = useFormFeedback(copy, locale);
  const group = useRef<HTMLDetailsElement>(null);
  const imapChanged = useCallback((status: MailAccountStatus) => setImapStatus(status), []), smtpChanged = useCallback((status: MailAccountStatus) => setSmtpStatus(status), []), preferencesChanged = useCallback((status: MailAccountStatus) => setPreferencesStatus(status), []);
  const reportStatus = useCallback((status: MailAccountStatus) => onStatus(account.id, status), [account.id, onStatus]);
  const busy = removing || imapStatus === 'busy' || smtpStatus === 'busy' || preferencesStatus === 'busy', dirty = imapStatus === 'dirty' || smtpStatus === 'dirty' || preferencesStatus === 'dirty';
  const status = busy ? 'busy' : dirty ? 'dirty' : 'clean';
  useReportedStatus(status, reportStatus);
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
  useEffect(() => { if (suggestions.length) { setOpen(true); requestAnimationFrame(() => group.current?.scrollIntoView({ block: 'nearest' })); } }, [suggestions.at(-1)?.token]);
  async function remove() {
    if (busy || dirty) return;
    setRemoving(true); setError('');
    try { await onRemove(account.id); }
    catch (reason) { setError((c, language) => accountIssue(reason, language) || c.removeFail); }
    finally { setRemoving(false); }
  }
  return <details ref={group} className="mail-account-group" data-account-id={account.id} data-status={status} hidden={!matchesAccount(searchQuery, account, smtp)} open={!!searchQuery.trim() || open} onToggle={event => { if (event.target === event.currentTarget && !searchQuery.trim()) setOpen(event.currentTarget.open); }}>
    <summary className="mail-account-summary"><Mail size={18} aria-hidden="true" /><span className="mail-account-summary-title"><strong>{account.name}</strong><small>{account.email}</small><span className="mail-account-connection-status"><span><CheckCircle2 size={11} aria-hidden="true" />{copy.receiving}</span><span className={smtp ? '' : 'incomplete'}>{smtp ? <CheckCircle2 size={11} aria-hidden="true" /> : null}{smtp ? copy.sending : copy.noSending}</span></span></span>{status !== 'clean' && <span className="mail-account-summary-state">{busy ? copy.busy : copy.pending}</span>}<ChevronDown size={16} className="mail-account-chevron" aria-hidden="true" /></summary>
    <div className="mail-account-group-content"><ImapSettings account={account} suggestions={suggestions.filter(item => item.kind === 'account')} onDismissSuggestion={onDismissSuggestion} searchQuery={searchQuery} peerBusy={smtpStatus === 'busy' || preferencesStatus === 'busy' || removing} onTest={onTest} onSave={onSave} onStatus={imapChanged} /><MailPreferences account={account} suggestions={suggestions.filter(item => item.kind === 'mail-preferences')} onDismissSuggestion={onDismissSuggestion} searchQuery={searchQuery} peerBusy={imapStatus === 'busy' || smtpStatus === 'busy' || removing} onStatus={preferencesChanged} /><SmtpSettings account={account} config={smtp} suggestions={suggestions.filter(item => item.kind === 'smtp')} onDismissSuggestion={onDismissSuggestion} searchQuery={searchQuery} peerBusy={imapStatus === 'busy' || preferencesStatus === 'busy' || removing} peerDirty={imapStatus === 'dirty'} onTest={onTestSmtp} onSave={onSaveSmtp} onStatus={smtpChanged} /><div className="mail-account-manage"><button type="button" className="mail-account-remove" title={dirty ? copy.finishFirst : copy.removeHint} aria-label={copy.removeNamed(account.name)} disabled={busy || dirty} onClick={() => void remove()}><Trash2 size={14} aria-hidden="true" />{copy.remove}</button></div>{error && <p className="mail-account-feedback error" role="alert">{error}</p>}</div>
  </details>;
}

export function MailAccounts({ accounts, smtpConfigs, onTest, onSave, onRemove, onTestSmtp, onSaveSmtp, onStatusChange, searchQuery = '', suggestions, onDismissSuggestion }: MailSuggestionProps & {
  accounts: MailAccountSummary[]; smtpConfigs: SmtpConfig[]; onTest(input: MailAccountInput): Promise<void>; onSave(input: MailAccountInput): Promise<void>; onRemove(id: string): Promise<boolean>; onTestSmtp(input: SmtpInput): Promise<void>; onSaveSmtp(input: SmtpInput): Promise<void>; onStatusChange?(status: MailAccountStatus): void; searchQuery?: string;
}) {
  const [statuses, setStatuses] = useState<Record<string, MailAccountStatus>>({}), [newStatus, setNewStatus] = useState<MailAccountStatus>('clean');
  const copy = useAccountText(), locale = useUiLocale();
  const [newOpen, setNewOpen] = useState(accounts.length === 0), [createdIdentity, setCreatedIdentity] = useState<string>(), [notice, setNotice] = useFormFeedback(copy, locale);
  const reportAccount = useCallback((id: string, status: MailAccountStatus) => setStatuses(current => current[id] === status ? current : { ...current, [id]: status }), []);
  const reportNew = useCallback((status: MailAccountStatus) => setNewStatus(status), []);
  const activeStatuses = [newStatus, ...accounts.map(account => statuses[account.id] ?? 'clean')];
  const status = activeStatuses.includes('busy') ? 'busy' : activeStatuses.includes('dirty') ? 'dirty' : 'clean';
  useLayoutEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    onStatusChange?.(status);
    if (status !== 'clean') window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [status, onStatusChange]);
  const supported = suggestions.filter(item => Object.hasOwn(mailSuggestionSchemas, item.kind));
  const newSuggestions = supported.filter(item => item.kind === 'account' && !item.targetId);
  useEffect(() => { if (newSuggestions.length) setNewOpen(true); }, [newSuggestions.at(-1)?.token]);
  const unavailable = suggestions.filter(item => !supported.includes(item) || (!newSuggestions.includes(item) && !accounts.some(account => account.id === item.targetId)));
  return <div className="mail-accounts">
    {unavailable.map(item => <div key={item.token} className="mail-account-feedback error" role="status">{supported.includes(item) ? copy.missing : copy.invalidSuggestion} <button type="button" onClick={() => onDismissSuggestion(item.token)}>{copy.dismiss}</button></div>)}
    {accounts.length > 0 && <section className="mail-account-list" aria-label={copy.accounts}>{accounts.map(account => <AccountGroup key={account.id} account={account} smtp={smtpConfigs.find(config => config.accountId === account.id)} suggestions={supported.filter(item => item.targetId === account.id)} onDismissSuggestion={onDismissSuggestion} searchQuery={searchQuery} autoOpen={createdIdentity === accountIdentity(account)} onStatus={reportAccount} onTest={onTest} onSave={onSave} onRemove={onRemove} onTestSmtp={onTestSmtp} onSaveSmtp={onSaveSmtp} />)}</section>}
    <details className="mail-account-form-group" data-new-account open={!!searchQuery.trim() || newOpen} onToggle={event => { if (event.target === event.currentTarget && !searchQuery.trim()) setNewOpen(event.currentTarget.open); }}><summary><span><MailPlus size={17} aria-hidden="true" /><strong>{copy.add}</strong></span><ChevronDown size={16} aria-hidden="true" /></summary><ImapSettings suggestions={newSuggestions} onDismissSuggestion={onDismissSuggestion} searchQuery={searchQuery} peerBusy={false} onTest={onTest} onSave={onSave} onStatus={reportNew} onSaved={input => { setNewOpen(false); setCreatedIdentity(accountIdentity(input)); setNotice(c => c.setUpOutgoing); }} /></details>
    {notice && <p className="mail-account-feedback success" role="status">{notice}</p>}
  </div>;
}

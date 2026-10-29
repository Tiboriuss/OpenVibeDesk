import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, ChevronDown, Mail, MailPlus, ShieldCheck, Trash2 } from 'lucide-react';
import type { MailAccountInput, MailAccountSummary, SmtpConfig, SmtpInput } from '../../../shared/mail';
import { preparationValues, SettingsPreparationNotice, useSettingsPreparation, type SettingsSuggestion } from '../../../src/settings-preparation';
import { MailPreferences } from './MailPreferences';
import './mail-accounts.css';

export type { MailAccountInput, MailAccountSummary } from '../../../shared/mail';
export type MailSecurity = 'tls' | 'starttls';
export type MailAccountStatus = 'clean' | 'dirty' | 'busy';
type ImapForm = Omit<MailAccountSummary, 'id'> & { password: string };
type SmtpForm = { host: string; port: number; security: MailSecurity; username: string; useImapCredentials: boolean; password: string };

const emptyImap = (): ImapForm => ({ name: '', email: '', host: '', port: 993, security: 'tls', username: '', password: '' });
const imapForm = (account?: MailAccountSummary): ImapForm => account ? { name: account.name, email: account.email, host: account.host, port: account.port, security: account.security, username: account.username, password: '' } : emptyImap();
const imapKey = (account?: Omit<ImapForm, 'password'>): string => account ? JSON.stringify([account.name, account.email, account.host, account.port, account.security, account.username]) : '';
const connectionKey = (value: Pick<ImapForm, 'host' | 'port' | 'security' | 'username'>): string => JSON.stringify([value.host.trim().toLowerCase(), value.port, value.security, value.username.trim()]);
const smtpKey = (value?: SmtpConfig): string => value ? JSON.stringify([value.accountId, value.host, value.port, value.security, value.username, value.useImapCredentials]) : '';
const smtpForm = (config: SmtpConfig | undefined, account: MailAccountSummary): SmtpForm => ({ host: config?.host ?? '', port: config?.port ?? 587, security: config?.security ?? 'starttls', username: config?.username ?? account.username, useImapCredentials: config?.useImapCredentials ?? true, password: '' });
const accountIdentity = (account: Pick<MailAccountSummary, 'email' | 'host' | 'username'>): string => JSON.stringify([account.email, account.host.toLowerCase(), account.username]);
const normalize = (value: string): string => value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
const searchWords = 'absender absendername sender signatur signature unterschrift abruf abrufzeit abrufzeiten intervall automatisch hintergrund manuell minuten mail e-mail email konto konten postfach allgemein kontoname anzeigename bearbeiten andern konfiguration adresse empfang posteingang imap versand senden postausgang smtp server host port verschlusselung tls starttls benutzername login passwort zugang';
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

function ImapSettings({ account, preparation, searchQuery, peerBusy, peerDirty, onTest, onSave, onSaved, onStatus }: {
  account?: MailAccountSummary; preparation?: SettingsSuggestion; searchQuery: string; peerBusy: boolean; peerDirty: boolean;
  onTest(input: MailAccountInput): Promise<void>; onSave(input: MailAccountInput): Promise<void>; onSaved?(input: MailAccountInput): void; onStatus(status: MailAccountStatus): void;
}) {
  const [baseline, setBaseline] = useState(account);
  const [values, setValues] = useState<ImapForm>(() => imapForm(account));
  const [imapOpen, setImapOpen] = useState(!account);
  const [busy, setBusy] = useState<'test' | 'save'>();
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const form = useRef<HTMLFormElement>(null), waitingForSaved = useRef<string | undefined>(undefined);
  const usernameEdited = useRef(!!account);
  const initial = imapForm(baseline);
  const dirty = imapKey(values) !== imapKey(initial) || !!values.password;
  const passwordRequired = !account || !!baseline && connectionKey(values) !== connectionKey(baseline);
  const locked = !!busy || peerBusy;
  const prepared = useSettingsPreparation(preparation, true, !dirty && !locked && !peerDirty, applyPreparation);
  const savedKey = imapKey(account);
  useEffect(() => {
    if (!account || dirty || busy) return;
    if (waitingForSaved.current && savedKey !== waitingForSaved.current) return;
    waitingForSaved.current = undefined;
    if (savedKey !== imapKey(baseline)) { setBaseline(account); setValues(imapForm(account)); }
  }, [savedKey, account, baseline, dirty, busy]);
  useEffect(() => { if (preparation && Object.keys(preparation.values).some(key => ['host', 'port', 'security', 'username'].includes(key))) setImapOpen(true); }, [preparation]);
  useReportedStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean', onStatus);

  function applyPreparation(suggestion: SettingsSuggestion) {
    const suggestionValues = preparationValues(suggestion);
    setValues(current => {
      const next = { ...current, ...suggestionValues, password: current.password } as ImapForm;
      if (!account && typeof suggestionValues.email === 'string' && typeof suggestionValues.username !== 'string' && !usernameEdited.current) next.username = suggestionValues.email;
      if (typeof suggestionValues.security === 'string' && typeof suggestionValues.port !== 'number' && [993, 143].includes(current.port)) next.port = suggestionValues.security === 'tls' ? 993 : 143;
      return next;
    });
    if (typeof suggestionValues.username === 'string') usernameEdited.current = true;
    setError(''); setNotice('Vorschlag vorbereitet. Bitte Angaben prüfen, gegebenenfalls das Passwort ergänzen und selbst speichern.');
  }
  function update(patch: Partial<ImapForm>) { setValues(current => ({ ...current, ...patch })); setError(''); setNotice(''); }
  function changeEmail(email: string) { setValues(current => ({ ...current, email, ...(!account && !usernameEdited.current ? { username: email } : {}) })); setError(''); setNotice(''); }
  function input(): MailAccountInput {
    return { ...(account ? { accountId: account.id } : {}), name: values.name.trim(), email: values.email.trim(), host: values.host.trim(), port: values.port, security: values.security, username: values.username.trim(), ...(values.password ? { password: values.password } : {}) };
  }
  function reset() { setValues(imapForm(baseline)); usernameEdited.current = !!account; setError(''); setNotice('Änderungen verworfen.'); }
  async function test() {
    if (locked || !validateForm(form.current, () => setImapOpen(true))) return;
    setBusy('test'); setError(''); setNotice('');
    try { await onTest(input()); setNotice(`IMAP-Verbindung erfolgreich geprüft.${dirty ? ' Änderungen sind noch nicht gespeichert.' : ''}`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Die IMAP-Verbindung konnte nicht geprüft werden.'); }
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
        setNotice('Kontodaten und IMAP-Einstellungen gespeichert.');
      } else { setValues(emptyImap()); usernameEdited.current = false; setNotice('Mailkonto angelegt.'); }
      onSaved?.(submitted);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Kontodaten konnten nicht gespeichert werden.'); }
    finally { setBusy(undefined); }
  }
  const id = `imap-${account?.id ?? 'new'}`;
  return <form className="mail-account-form" data-protocol="imap" data-status={busy ? 'busy' : dirty ? 'dirty' : 'clean'} ref={form} noValidate onSubmit={event => void save(event)}>
    <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || locked || peerDirty} onApply={prepared.accept} onDismiss={prepared.dismiss} />
    <fieldset disabled={locked}>
      <details className="mail-connection-group imap-group" open={!!searchQuery.trim() || imapOpen} onToggle={event => { if (!searchQuery.trim()) setImapOpen(event.currentTarget.open); }}>
        <summary><span><strong>Konto & Posteingang · IMAP</strong><small>{baseline ? `${baseline.host}:${baseline.port} · ${baseline.security === 'tls' ? 'TLS' : 'STARTTLS'}` : 'Server und Zugangsdaten für den Empfang'}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <div className="mail-connection-fields"><section className="mail-general-fields" aria-label="Allgemein"><h4>Allgemein</h4><div className="mail-account-field"><label htmlFor={`${id}-name`}>Kontoname</label><input id={`${id}-name`} required maxLength={120} autoComplete="name" value={values.name} onChange={event => update({ name: event.target.value })} placeholder="Zum Beispiel Arbeit" /></div><div className="mail-account-field"><label htmlFor={`${id}-email`}>E-Mail-Adresse</label><input id={`${id}-email`} type="email" required maxLength={320} autoComplete="email" spellCheck={false} value={values.email} onChange={event => changeEmail(event.target.value)} placeholder="name@beispiel.de" /></div></section><div className="mail-account-field"><label htmlFor={`${id}-host`}>IMAP-Serveradresse</label><input id={`${id}-host`} required maxLength={253} autoComplete="off" spellCheck={false} value={values.host} onChange={event => update({ host: event.target.value })} placeholder="imap.beispiel.de" /></div><div className="mail-account-grid"><div className="mail-account-field"><label htmlFor={`${id}-security`}>Verschlüsselung</label><select id={`${id}-security`} value={values.security} onChange={event => { const security = event.target.value as MailSecurity; update({ security, ...([993, 143].includes(values.port) ? { port: security === 'tls' ? 993 : 143 } : {}) }); }}><option value="tls">TLS direkt</option><option value="starttls">STARTTLS</option></select></div><div className="mail-account-field"><label htmlFor={`${id}-port`}>Port</label><input id={`${id}-port`} type="number" required min={1} max={65535} value={values.port || ''} onChange={event => update({ port: Number(event.target.value) })} /></div></div><div className="mail-account-field"><label htmlFor={`${id}-user`}>IMAP-Benutzername</label><input id={`${id}-user`} required maxLength={320} autoComplete="username" spellCheck={false} value={values.username} onChange={event => { usernameEdited.current = true; update({ username: event.target.value }); }} /></div><div className="mail-account-field"><label htmlFor={`${id}-password`}>IMAP-Passwort oder App-Passwort</label><input id={`${id}-password`} type="password" required={passwordRequired} maxLength={4096} autoComplete="new-password" value={values.password} onChange={event => update({ password: event.target.value })} placeholder={account && !passwordRequired ? 'Leer lassen, um das gespeicherte Passwort zu behalten' : 'Passwort eingeben'} /><p>{account ? passwordRequired ? 'Server oder Anmeldung wurden geändert. Bitte das Passwort für diese Verbindung erneut eingeben.' : 'Ein leeres Feld behält das sicher gespeicherte Passwort. Ein neues Passwort ersetzt es beim Speichern.' : 'Wird im Zugangsdaten-Speicher des Systems gespeichert.'}</p></div>
      {dirty && <p className="mail-account-unsaved">Kontodaten oder IMAP-Änderungen noch nicht gespeichert.</p>}
      <div className="mail-account-actions">{dirty && <button className="mail-account-check" type="button" onClick={reset}>Änderungen verwerfen</button>}<button className="mail-account-check" type="button" onClick={() => void test()}>{busy === 'test' ? 'IMAP wird geprüft …' : 'IMAP prüfen'}</button><button className="mail-account-save" type="submit" disabled={!!account && !dirty}>{busy === 'save' ? 'Wird gespeichert …' : account ? 'Konto & IMAP speichern' : 'Konto anlegen'}</button></div>
      {error && <p className="mail-account-feedback error" role="alert">{error}</p>}{notice && <p className="mail-account-feedback success" role="status">{notice}</p>}</div>
      </details>

    </fieldset>
  </form>;
}

function SmtpSettings({ account, config, preparation, searchQuery, peerBusy, peerDirty, onTest, onSave, onStatus }: {
  account: MailAccountSummary; config?: SmtpConfig; preparation?: SettingsSuggestion; searchQuery: string; peerBusy: boolean; peerDirty: boolean;
  onTest(input: SmtpInput): Promise<void>; onSave(input: SmtpInput): Promise<void>; onStatus(status: MailAccountStatus): void;
}) {
  const [baseline, setBaseline] = useState(config), [values, setValues] = useState<SmtpForm>(() => smtpForm(config, account));
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<'test' | 'save'>();
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const form = useRef<HTMLFormElement>(null), waitingForSaved = useRef<string | undefined>(undefined);
  const initial = smtpForm(baseline, account);
  const dirty = values.host !== initial.host || values.port !== initial.port || values.security !== initial.security || values.useImapCredentials !== initial.useImapCredentials || !values.useImapCredentials && values.username !== initial.username || !!values.password;
  const locked = !!busy || peerBusy;
  const savedKey = smtpKey(config);
  const prepared = useSettingsPreparation(preparation, true, !dirty && !locked && !peerDirty, applyPreparation);
  useEffect(() => {
    if (dirty || busy || waitingForSaved.current && savedKey !== waitingForSaved.current) return;
    waitingForSaved.current = undefined;
    if (savedKey !== smtpKey(baseline)) { setBaseline(config); setValues(smtpForm(config, account)); }
  }, [savedKey, config, baseline, account, dirty, busy]);
  useEffect(() => { if (preparation) setOpen(true); }, [preparation]);
  useReportedStatus(busy ? 'busy' : dirty ? 'dirty' : 'clean', onStatus);
  function applyPreparation(suggestion: SettingsSuggestion) { setValues(current => ({ ...current, ...preparationValues(suggestion), password: current.password } as SmtpForm)); setOpen(true); setError(''); setNotice('SMTP-Vorschlag vorbereitet. Bitte prüfen und selbst speichern.'); }
  function update(patch: Partial<SmtpForm>) { setValues(current => ({ ...current, ...patch })); setError(''); setNotice(''); }
  function input(): SmtpInput { return { accountId: account.id, host: values.host.trim(), port: values.port, security: values.security, username: values.useImapCredentials ? account.username : values.username.trim(), useImapCredentials: values.useImapCredentials, ...(!values.useImapCredentials && values.password ? { password: values.password } : {}) }; }
  function reset() { setValues(smtpForm(baseline, account)); setError(''); setNotice('SMTP-Änderungen verworfen.'); }
  async function test() {
    if (locked || !validateForm(form.current, () => setOpen(true))) return;
    setBusy('test'); setError(''); setNotice('');
    try { await onTest(input()); setNotice(`SMTP-Verbindung erfolgreich geprüft.${dirty ? ' Änderungen sind noch nicht gespeichert.' : ''}`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Die SMTP-Verbindung konnte nicht geprüft werden.'); }
    finally { setBusy(undefined); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked || !validateForm(form.current, () => setOpen(true))) return;
    setBusy('save'); setError(''); setNotice('');
    const submitted = input();
    try {
      await onSave(submitted);
      const saved: SmtpConfig = { accountId: account.id, host: submitted.host, port: submitted.port, security: submitted.security, username: submitted.username, useImapCredentials: submitted.useImapCredentials, hasPassword: !!submitted.password || !!baseline?.hasPassword };
      waitingForSaved.current = smtpKey(saved); setBaseline(saved); setValues(smtpForm(saved, account)); setNotice('SMTP-Einstellungen gespeichert.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Die SMTP-Einstellungen konnten nicht gespeichert werden.'); }
    finally { setBusy(undefined); }
  }
  const id = `smtp-${account.id}`;
  return <details className="mail-connection-group smtp-group" open={!!searchQuery.trim() || open} onToggle={event => { if (!searchQuery.trim()) setOpen(event.currentTarget.open); }}>
    <summary><span><strong>Postausgang · SMTP</strong><small>{baseline ? `${baseline.host}:${baseline.port} · ${baseline.security === 'tls' ? 'TLS' : 'STARTTLS'}` : 'Noch nicht eingerichtet'}{dirty ? ' · Änderungen offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
    <form className="smtp-form" data-protocol="smtp" data-status={busy ? 'busy' : dirty ? 'dirty' : 'clean'} ref={form} noValidate onSubmit={event => void save(event)}>
      <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || locked || peerDirty} onApply={prepared.accept} onDismiss={prepared.dismiss} />
      <fieldset disabled={locked}><div className="mail-account-field"><label htmlFor={`${id}-host`}>SMTP-Serveradresse</label><input id={`${id}-host`} required maxLength={253} autoComplete="off" spellCheck={false} value={values.host} onChange={event => update({ host: event.target.value })} placeholder="smtp.beispiel.de" /></div><div className="mail-account-grid"><div className="mail-account-field"><label htmlFor={`${id}-security`}>Verschlüsselung</label><select id={`${id}-security`} value={values.security} onChange={event => { const security = event.target.value as MailSecurity; update({ security, ...([465, 587].includes(values.port) ? { port: security === 'tls' ? 465 : 587 } : {}) }); }}><option value="starttls">STARTTLS</option><option value="tls">TLS direkt</option></select></div><div className="mail-account-field"><label htmlFor={`${id}-port`}>Port</label><input id={`${id}-port`} type="number" required min={1} max={65535} value={values.port || ''} onChange={event => update({ port: Number(event.target.value) })} /></div></div><label className="smtp-reuse"><input type="checkbox" checked={values.useImapCredentials} onChange={event => update({ useImapCredentials: event.target.checked })} /><span>IMAP-Zugangsdaten dieses Kontos verwenden</span></label><div className="mail-account-field"><label htmlFor={`${id}-username`}>SMTP-Benutzername</label><input id={`${id}-username`} required maxLength={320} autoComplete="username" spellCheck={false} disabled={values.useImapCredentials} value={values.useImapCredentials ? account.username : values.username} onChange={event => update({ username: event.target.value })} /><p>{values.useImapCredentials ? peerDirty ? 'Es gelten die gespeicherten IMAP-Zugangsdaten. Speichere Änderungen am Posteingang zuerst.' : 'Benutzername und Passwort des gespeicherten IMAP-Kontos werden verwendet.' : 'Eigene Zugangsdaten für den Postausgang.'}</p></div>{!values.useImapCredentials && <div className="mail-account-field"><label htmlFor={`${id}-password`}>SMTP-Passwort oder App-Passwort</label><input id={`${id}-password`} type="password" required={!baseline?.hasPassword} maxLength={4096} autoComplete="new-password" value={values.password} onChange={event => update({ password: event.target.value })} placeholder={baseline?.hasPassword ? 'Leer lassen, um das gespeicherte Passwort zu behalten' : 'Passwort eingeben'} /><p>{baseline?.hasPassword ? 'Ein leeres Feld behält das gespeicherte SMTP-Passwort.' : 'Wird im Zugangsdaten-Speicher des Systems gespeichert.'}</p></div>}{dirty && <p className="mail-account-unsaved">SMTP-Änderungen noch nicht gespeichert.</p>}<div className="mail-account-actions">{dirty && <button className="mail-account-check" type="button" onClick={reset}>Änderungen verwerfen</button>}<button className="mail-account-check" type="button" onClick={() => void test()}>{busy === 'test' ? 'SMTP wird geprüft …' : 'SMTP prüfen'}</button><button className="mail-account-save" type="submit" disabled={!!baseline && !dirty}>{busy === 'save' ? 'Wird gespeichert …' : 'SMTP speichern'}</button></div></fieldset>
      {error && <p className="mail-account-feedback error" role="alert">{error}</p>}{notice && <p className="mail-account-feedback success" role="status">{notice}</p>}
    </form>
  </details>;
}

function AccountGroup({ account, smtp, preparation, searchQuery, autoOpen, onStatus, onTest, onSave, onRemove, onTestSmtp, onSaveSmtp }: {
  account: MailAccountSummary; smtp?: SmtpConfig; preparation?: SettingsSuggestion; searchQuery: string; autoOpen: boolean; onStatus(id: string, status: MailAccountStatus): void;
  onTest(input: MailAccountInput): Promise<void>; onSave(input: MailAccountInput): Promise<void>; onRemove(id: string): Promise<boolean>; onTestSmtp(input: SmtpInput): Promise<void>; onSaveSmtp(input: SmtpInput): Promise<void>;
}) {
  const [open, setOpen] = useState(autoOpen), [imapStatus, setImapStatus] = useState<MailAccountStatus>('clean'), [smtpStatus, setSmtpStatus] = useState<MailAccountStatus>('clean'), [preferencesStatus, setPreferencesStatus] = useState<MailAccountStatus>('clean');
  const [removing, setRemoving] = useState(false), [error, setError] = useState('');
  const group = useRef<HTMLDetailsElement>(null);
  const scopedPreparation = (keys: string[]) => {
    if (preparation?.kind !== 'account') return undefined;
    const values = Object.fromEntries(Object.entries(preparation.values).filter(([key]) => keys.includes(key)));
    return Object.keys(values).length ? { ...preparation, values } : undefined;
  };
  const connectionPreparation = scopedPreparation(['name', 'email', 'host', 'port', 'security', 'username']);
  const preferencesPreparation = scopedPreparation(['senderName', 'signature', 'pollIntervalSeconds']);
  const imapChanged = useCallback((status: MailAccountStatus) => setImapStatus(status), []), smtpChanged = useCallback((status: MailAccountStatus) => setSmtpStatus(status), []), preferencesChanged = useCallback((status: MailAccountStatus) => setPreferencesStatus(status), []);
  const reportStatus = useCallback((status: MailAccountStatus) => onStatus(account.id, status), [account.id, onStatus]);
  const busy = removing || imapStatus === 'busy' || smtpStatus === 'busy' || preferencesStatus === 'busy', dirty = imapStatus === 'dirty' || smtpStatus === 'dirty' || preferencesStatus === 'dirty';
  const status = busy ? 'busy' : dirty ? 'dirty' : 'clean';
  useReportedStatus(status, reportStatus);
  useEffect(() => { if (autoOpen) setOpen(true); }, [autoOpen]);
  useEffect(() => { if (preparation) { setOpen(true); requestAnimationFrame(() => group.current?.scrollIntoView({ block: 'nearest' })); } }, [preparation]);
  async function remove() {
    if (busy || dirty) return;
    setRemoving(true); setError('');
    try { await onRemove(account.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Das Konto konnte nicht entfernt werden.'); }
    finally { setRemoving(false); }
  }
  return <details ref={group} className="mail-account-group" data-account-id={account.id} data-status={status} hidden={!matchesAccount(searchQuery, account, smtp)} open={!!searchQuery.trim() || open} onToggle={event => { if (event.target === event.currentTarget && !searchQuery.trim()) setOpen(event.currentTarget.open); }}>
    <summary className="mail-account-summary"><Mail size={18} aria-hidden="true" /><span className="mail-account-summary-title"><strong>{account.name}</strong><small>{account.email}</small><span className="mail-account-connection-status"><span><CheckCircle2 size={11} aria-hidden="true" />Empfang eingerichtet</span><span className={smtp ? '' : 'incomplete'}>{smtp ? <CheckCircle2 size={11} aria-hidden="true" /> : null}{smtp ? 'Versand eingerichtet' : 'Versand fehlt'}</span></span></span>{status !== 'clean' && <span className="mail-account-summary-state">{busy ? 'Vorgang läuft' : 'Änderungen offen'}</span>}<ChevronDown size={16} className="mail-account-chevron" aria-hidden="true" /></summary>
    <div className="mail-account-group-content"><ImapSettings account={account} preparation={connectionPreparation} searchQuery={searchQuery} peerBusy={smtpStatus === 'busy' || preferencesStatus === 'busy' || removing} peerDirty={smtpStatus === 'dirty' || preferencesStatus === 'dirty'} onTest={onTest} onSave={onSave} onStatus={imapChanged} /><MailPreferences account={account} preparation={preferencesPreparation} searchQuery={searchQuery} peerBusy={imapStatus === 'busy' || smtpStatus === 'busy' || removing} peerDirty={imapStatus === 'dirty' || smtpStatus === 'dirty'} onStatus={preferencesChanged} /><SmtpSettings account={account} config={smtp} preparation={preparation?.kind === 'smtp' ? preparation : undefined} searchQuery={searchQuery} peerBusy={imapStatus === 'busy' || preferencesStatus === 'busy' || removing} peerDirty={imapStatus === 'dirty' || preferencesStatus === 'dirty'} onTest={onTestSmtp} onSave={onSaveSmtp} onStatus={smtpChanged} /><div className="mail-account-manage"><button type="button" className="mail-account-remove" title={dirty ? 'Änderungen zuerst speichern oder verwerfen' : 'Konto und gespeicherte Zugangsdaten entfernen'} aria-label={`Konto ${account.name} entfernen`} disabled={busy || dirty} onClick={() => void remove()}><Trash2 size={14} aria-hidden="true" />Konto entfernen</button></div>{error && <p className="mail-account-feedback error" role="alert">{error}</p>}</div>
  </details>;
}

export function MailAccounts({ accounts, smtpConfigs, onTest, onSave, onRemove, onTestSmtp, onSaveSmtp, onStatusChange, searchQuery = '', preparation }: {
  accounts: MailAccountSummary[]; smtpConfigs: SmtpConfig[]; onTest(input: MailAccountInput): Promise<void>; onSave(input: MailAccountInput): Promise<void>; onRemove(id: string): Promise<boolean>; onTestSmtp(input: SmtpInput): Promise<void>; onSaveSmtp(input: SmtpInput): Promise<void>; onStatusChange?(status: MailAccountStatus): void; searchQuery?: string; preparation?: SettingsSuggestion;
}) {
  const [statuses, setStatuses] = useState<Record<string, MailAccountStatus>>({}), [newStatus, setNewStatus] = useState<MailAccountStatus>('clean');
  const [newOpen, setNewOpen] = useState(accounts.length === 0), [createdIdentity, setCreatedIdentity] = useState<string>(), [notice, setNotice] = useState('');
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
  const newPreparation = preparation?.kind === 'account' && !preparation.accountId ? preparation : undefined;
  useEffect(() => { if (newPreparation) setNewOpen(true); }, [newPreparation]);
  const missingTarget = preparation?.accountId && !accounts.some(account => account.id === preparation.accountId);
  return <div className="mail-accounts">
    <div className="mail-account-intro"><p>Empfang und Versand sind je Postfach zusammengefasst. Öffne ein Konto, um Kontodaten, Absender, Signatur, Abrufintervall, IMAP und SMTP zu bearbeiten.</p></div>
    {missingTarget && <p className="mail-account-feedback error" role="status">Das ausgewählte Mailkonto ist nicht mehr verfügbar. Bitte wähle ein vorhandenes Konto oder lege ein neues an.</p>}
    {preparation?.kind === 'smtp' && !preparation.accountId && <p className="mail-account-feedback error" role="status">Für den SMTP-Vorschlag ist ein eingerichtetes Mailkonto erforderlich.</p>}
    {accounts.length > 0 && <section className="mail-account-list" aria-label="Eingerichtete Mailkonten">{accounts.map(account => <AccountGroup key={account.id} account={account} smtp={smtpConfigs.find(config => config.accountId === account.id)} preparation={preparation?.accountId === account.id ? preparation : undefined} searchQuery={searchQuery} autoOpen={createdIdentity === accountIdentity(account)} onStatus={reportAccount} onTest={onTest} onSave={onSave} onRemove={onRemove} onTestSmtp={onTestSmtp} onSaveSmtp={onSaveSmtp} />)}</section>}
    <details className="mail-account-form-group" data-new-account open={!!searchQuery.trim() || newOpen} onToggle={event => { if (event.target === event.currentTarget && !searchQuery.trim()) setNewOpen(event.currentTarget.open); }}><summary><span><MailPlus size={17} aria-hidden="true" /><strong>Konto hinzufügen</strong></span><ChevronDown size={16} aria-hidden="true" /></summary><ImapSettings preparation={newPreparation} searchQuery={searchQuery} peerBusy={false} peerDirty={false} onTest={onTest} onSave={onSave} onStatus={reportNew} onSaved={input => { setNewOpen(false); setCreatedIdentity(accountIdentity(input)); setNotice('Mailkonto angelegt. Richte den Postausgang unter SMTP in diesem Konto ein.'); }} /></details>
    {notice && <p className="mail-account-feedback success" role="status">{notice}</p>}
    <div className="mail-account-note"><ShieldCheck size={15} aria-hidden="true" /><span>Zugangsdaten bleiben im sicheren Speicher des Systems. Manche Anbieter benötigen ein App-Passwort; OAuth wird noch nicht unterstützt.</span></div>
  </div>;
}

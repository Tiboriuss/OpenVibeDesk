import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { mailPreferences, mailPreferencesSchema } from '../../../shared/mail-preferences';
import type { MailAccountSummary } from '../../../shared/mail';
import { preparationValues, SettingsPreparationNotice, useSettingsPreparation, type SettingsSuggestion } from '../../../src/settings-preparation';
import type { MailAccountStatus } from './MailAccounts';

const intervals = [[0, 'Nur manuell'], [60, 'Jede Minute'], [120, 'Alle 2 Minuten'], [300, 'Alle 5 Minuten'], [600, 'Alle 10 Minuten'], [900, 'Alle 15 Minuten'], [1800, 'Alle 30 Minuten'], [3600, 'Jede Stunde']] as const;

export function MailPreferences({ account, preparation, searchQuery, peerBusy, peerDirty, onStatus }: {
  account: MailAccountSummary; preparation?: SettingsSuggestion; searchQuery: string; peerBusy: boolean; peerDirty: boolean;
  onStatus(status: MailAccountStatus): void;
}) {
  const [baseline, setBaseline] = useState(() => mailPreferences(account));
  const [values, setValues] = useState(() => mailPreferences(account));
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
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
  useEffect(() => { if (preparation) setOpen(true); }, [preparation]);
  const prepared = useSettingsPreparation(preparation, true, !dirty && !locked && !peerDirty, suggestion => {
    const publicValues = preparationValues(suggestion);
    setValues(current => ({ ...current, ...publicValues }));
    setOpen(true); setError(''); setNotice('Vorschlag vorbereitet. Bitte prüfen und selbst speichern.');
  });
  function update(patch: Partial<typeof values>) { setValues(current => ({ ...current, ...patch })); setError(''); setNotice(''); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !form.current?.reportValidity()) return;
    const parsed = mailPreferencesSchema.safeParse({ accountId: account.id, ...values });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || 'Bitte Absender, Signatur und Abrufintervall prüfen.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await window.workspace.saveMailPreferences(parsed.data);
      const { accountId: _accountId, ...saved } = parsed.data;
      waitingForSaved.current = JSON.stringify(saved); setBaseline(saved); setValues(saved);
      setNotice('Absender, Signatur und Abrufintervall gespeichert.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Die Kontoeinstellungen konnten nicht gespeichert werden.'); }
    finally { setBusy(false); }
  }
  const id = `preferences-${account.id}`;
  const intervalLabel = intervals.find(([value]) => value === baseline.pollIntervalSeconds)?.[1] ?? 'Alle 5 Minuten';
  return <details className="mail-connection-group mail-preferences-group" open={!!searchQuery.trim() || open} onToggle={event => { if (event.target === event.currentTarget && !searchQuery.trim()) setOpen(event.currentTarget.open); }}>
    <summary><span><strong>Absender, Signatur & Abruf</strong><small>{baseline.senderName || 'Absender ohne Anzeigenamen'} · {baseline.signature ? 'Signatur eingerichtet' : 'Ohne Signatur'} · {intervalLabel}{dirty ? ' · Änderungen offen' : ''}</small></span><ChevronDown size={16} aria-hidden="true" /></summary>
    <form ref={form} className="mail-preferences-form" data-protocol="preferences" data-status={status} onSubmit={event => void save(event)}>
      <SettingsPreparationNotice suggestion={prepared.pending} blocked={dirty || locked || peerDirty} onApply={prepared.accept} onDismiss={prepared.dismiss} />
      <fieldset disabled={locked}>
        <div className="mail-account-field"><label htmlFor={`${id}-sender`}>Absendername</label><input id={`${id}-sender`} maxLength={120} autoComplete="name" value={values.senderName} onChange={event => update({ senderName: event.target.value })} placeholder="Zum Beispiel Alex vom Atlas Studio" /><p>Wird beim Versand zusammen mit {account.email} angezeigt. Leer bedeutet: nur die E-Mail-Adresse.</p></div>
        <div className="mail-account-field"><label htmlFor={`${id}-signature`}>Signatur</label><textarea id={`${id}-signature`} rows={4} maxLength={5000} value={values.signature} onChange={event => update({ signature: event.target.value })} placeholder={'Viele Grüße\nAlex'} /><p>Wird als bearbeitbarer Text in neue Nachrichten und Antwortentwürfe eingefügt. Bestehende Entwürfe bleiben erhalten.</p></div>
        <div className="mail-account-field mail-retrieval-field"><label htmlFor={`${id}-interval`}>Neue Mails abrufen</label><select id={`${id}-interval`} value={values.pollIntervalSeconds} onChange={event => update({ pollIntervalSeconds: Number(event.target.value) })}>{intervals.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><p>Prüft dieses Postfach im Hintergrund auf neue Nachrichten. „Nur manuell“ deaktiviert den automatischen Abruf; „Aktualisieren“ bleibt verfügbar.</p></div>
        {dirty && <p className="mail-account-unsaved">Änderungen noch nicht gespeichert.</p>}
        <div className="mail-account-actions">{dirty && <button className="mail-account-check" type="button" onClick={() => { setValues(baseline); setError(''); setNotice('Änderungen verworfen.'); }}>Änderungen verwerfen</button>}<button className="mail-account-save" type="submit" disabled={!dirty}>{busy ? 'Wird gespeichert …' : 'Einstellungen speichern'}</button></div>
      </fieldset>
      {error && <p className="mail-account-feedback error" role="alert">{error}</p>}{notice && <p className="mail-account-feedback success" role="status">{notice}</p>}
    </form>
  </details>;
}

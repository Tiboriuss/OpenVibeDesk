import { formDetail } from '../../../src/form-feedback';
import { useUiLocale } from '../../../src/locale';
import type { UiLocale } from '../../../shared/locale';

export const accountText = {
  en: {
    suggestion: 'Assistant suggestion', apply: 'Apply to form', dismiss: 'Dismiss', same: 'The form already has these values.',
    current: 'In form', proposed: 'Suggested', edited: 'Your edit', empty: 'Empty', yes: 'On', no: 'Off',
    fields: { name: 'Account name', email: 'Email address', host: 'Server', port: 'Port', security: 'Encryption', username: 'Username', useImapCredentials: 'Use IMAP credentials', senderName: 'Sender name', signature: 'Signature', pollIntervalSeconds: 'Check for new mail' },
    invalidSuggestion: 'The suggested settings could not be read.', next: (n: number) => `${n} more`,
    account: 'Account & incoming mail · IMAP', outgoing: 'Outgoing mail · SMTP', preferences: 'Sender, signature & mail checks', general: 'General',
    nameExample: 'e.g. Workshop', imapHost: 'IMAP server', smtpHost: 'SMTP server', directTls: 'Direct TLS', imapUser: 'IMAP username', smtpUser: 'SMTP username',
    imapPassword: 'IMAP password or app password', smtpPassword: 'SMTP password or app password', enterPassword: 'Enter password', keepPassword: 'Leave blank to keep the saved password',
    newPassword: 'Enter the password for the new server or login.', appPassword: 'Use an app password if your provider requires one.',
    smtpUnset: 'Not configured', incomingHint: 'Incoming server and login', imapPending: 'Unsaved account or IMAP changes', smtpPending: 'Unsaved SMTP changes',
    discard: 'Discard changes', discarded: 'Changes discarded.', checkingImap: 'Checking IMAP…', checkImap: 'Test IMAP', checkingSmtp: 'Checking SMTP…', checkSmtp: 'Test SMTP',
    saving: 'Saving…', saveImap: 'Save account & IMAP', saveSmtp: 'Save SMTP', savePreferences: 'Save settings', create: 'Create account',
    created: 'Account created.', imapSaved: 'Account and IMAP settings saved.', smtpSaved: 'SMTP settings saved.', preferencesSaved: 'Sender, signature and mail checks saved.',
    imapTested: 'IMAP connection verified.', smtpTested: 'SMTP connection verified.', imapFail: 'Could not check the IMAP connection.', smtpFail: 'Could not check the SMTP connection.',
    accountSaveFail: 'Could not save the account.', smtpSaveFail: 'Could not save SMTP settings.', preferencesFail: 'Could not save account preferences.',
    checkPreferences: 'Check the sender name, signature and mail interval.', saveLoginFirst: 'Save the updated IMAP login first.',
    senderEmpty: 'No sender name', signatureSet: 'Signature configured', signatureEmpty: 'No signature',
    senderExample: 'e.g. Alex at the workshop', emailOnly: (email: string) => `If empty, recipients see ${email}.`, signatureExample: 'Kind regards,\nAlex', signatureHint: 'Used for new messages and replies.',
    backgroundHint: 'Mail checks continue when the Mail window is closed.', manual: 'Manual', minute: 'Every minute', hour: 'Every hour', minutes: (n: number) => `Every ${n} minutes`,
    pending: 'Unsaved changes', busy: 'In progress', receiving: 'Incoming ready', sending: 'Outgoing ready', noSending: 'Outgoing not configured',
    remove: 'Remove account', removeNamed: (name: string) => `Remove account ${name}`, finishFirst: 'Save or discard your changes first.', removeHint: 'Remove the account and its saved credentials', removeFail: 'Could not remove the account.',
    missing: 'The account for this suggestion is no longer available.', accounts: 'Mail accounts', add: 'Add account', setUpOutgoing: 'Account created. Set up outgoing mail under SMTP.'
  },
  de: {
    suggestion: 'Vorschlag des Assistenten', apply: 'Ins Formular übernehmen', dismiss: 'Verwerfen', same: 'Diese Werte stehen bereits im Formular.',
    current: 'Im Formular', proposed: 'Vorschlag', edited: 'Eigene Eingabe', empty: 'Leer', yes: 'Ein', no: 'Aus',
    fields: { name: 'Kontoname', email: 'E-Mail-Adresse', host: 'Server', port: 'Port', security: 'Verschlüsselung', username: 'Benutzername', useImapCredentials: 'IMAP-Zugangsdaten verwenden', senderName: 'Absendername', signature: 'Signatur', pollIntervalSeconds: 'Neue Mails abrufen' },
    invalidSuggestion: 'Der Vorschlag konnte nicht gelesen werden.', next: (n: number) => `${n} weitere`,
    account: 'Konto & Posteingang · IMAP', outgoing: 'Postausgang · SMTP', preferences: 'Absender, Signatur & Abruf', general: 'Allgemein',
    nameExample: 'Zum Beispiel Werkstatt', imapHost: 'IMAP-Serveradresse', smtpHost: 'SMTP-Serveradresse', directTls: 'TLS direkt', imapUser: 'IMAP-Benutzername', smtpUser: 'SMTP-Benutzername',
    imapPassword: 'IMAP-Passwort oder App-Passwort', smtpPassword: 'SMTP-Passwort oder App-Passwort', enterPassword: 'Passwort eingeben', keepPassword: 'Leer lassen, um das gespeicherte Passwort zu behalten',
    newPassword: 'Bitte das Passwort für den neuen Server oder die neue Anmeldung eingeben.', appPassword: 'Falls der Anbieter es verlangt, ein App-Passwort verwenden.',
    smtpUnset: 'Noch nicht eingerichtet', incomingHint: 'Server und Zugangsdaten für den Empfang', imapPending: 'Kontodaten oder IMAP-Änderungen noch nicht gespeichert', smtpPending: 'SMTP-Änderungen noch nicht gespeichert',
    discard: 'Änderungen verwerfen', discarded: 'Änderungen verworfen.', checkingImap: 'IMAP wird geprüft …', checkImap: 'IMAP prüfen', checkingSmtp: 'SMTP wird geprüft …', checkSmtp: 'SMTP prüfen',
    saving: 'Wird gespeichert …', saveImap: 'Konto & IMAP speichern', saveSmtp: 'SMTP speichern', savePreferences: 'Einstellungen speichern', create: 'Konto anlegen',
    created: 'Mailkonto angelegt.', imapSaved: 'Kontodaten und IMAP-Einstellungen gespeichert.', smtpSaved: 'SMTP-Einstellungen gespeichert.', preferencesSaved: 'Absender, Signatur und Abrufintervall gespeichert.',
    imapTested: 'IMAP-Verbindung geprüft.', smtpTested: 'SMTP-Verbindung geprüft.', imapFail: 'Die IMAP-Verbindung konnte nicht geprüft werden.', smtpFail: 'Die SMTP-Verbindung konnte nicht geprüft werden.',
    accountSaveFail: 'Die Kontodaten konnten nicht gespeichert werden.', smtpSaveFail: 'Die SMTP-Einstellungen konnten nicht gespeichert werden.', preferencesFail: 'Die Kontoeinstellungen konnten nicht gespeichert werden.',
    checkPreferences: 'Bitte Absender, Signatur und Abrufintervall prüfen.', saveLoginFirst: 'Änderungen der IMAP-Zugangsdaten zuerst speichern.',
    senderEmpty: 'Absender ohne Anzeigenamen', signatureSet: 'Signatur eingerichtet', signatureEmpty: 'Ohne Signatur',
    senderExample: 'Zum Beispiel Alex aus der Werkstatt', emailOnly: (email: string) => `Bei leerem Feld sehen Empfänger ${email}.`, signatureExample: 'Viele Grüße\nAlex', signatureHint: 'Für neue Nachrichten und Antworten.',
    backgroundHint: 'Automatischer Abruf auch bei geschlossenem Mailfenster.', manual: 'Nur manuell', minute: 'Jede Minute', hour: 'Jede Stunde', minutes: (n: number) => `Alle ${n} Minuten`,
    pending: 'Änderungen offen', busy: 'Vorgang läuft', receiving: 'Empfang eingerichtet', sending: 'Versand eingerichtet', noSending: 'Versand fehlt',
    remove: 'Konto entfernen', removeNamed: (name: string) => `Konto ${name} entfernen`, finishFirst: 'Änderungen zuerst speichern oder verwerfen.', removeHint: 'Konto und gespeicherte Zugangsdaten entfernen', removeFail: 'Das Konto konnte nicht entfernt werden.',
    missing: 'Das Konto für diesen Vorschlag ist nicht mehr verfügbar.', accounts: 'Eingerichtete Mailkonten', add: 'Konto hinzufügen', setUpOutgoing: 'Mailkonto angelegt. Richte den Postausgang unter SMTP ein.'
  }
};
export function useAccountText() { return accountText[useUiLocale()]; }
export function intervalText(copy: typeof accountText[UiLocale], seconds: number) {
  if (!seconds) return copy.manual;
  if (seconds === 60) return copy.minute;
  if (seconds === 3600) return copy.hour;
  return copy.minutes(seconds / 60);
}

const englishErrors: Record<string, string> = {
  'Bitte gültige Kontodaten, Serveradresse und Port eingeben.': 'Check the account details, server and port.',
  'Bitte gültige SMTP-Einstellungen eingeben.': 'Check the SMTP settings.',
  'Die IMAP-Anmeldung ist fehlgeschlagen. Bitte Zugangsdaten prüfen.': 'IMAP sign-in failed. Check the username and password.',
  'Die SMTP-Anmeldung ist fehlgeschlagen. Bitte Zugangsdaten prüfen.': 'SMTP sign-in failed. Check the username and password.',
  'Das Zertifikat des IMAP-Servers ist ungültig oder passt nicht zum Servernamen.': 'Check the IMAP server name and its certificate.',
  'Die verschlüsselte SMTP-Verbindung konnte nicht sicher hergestellt werden. Bitte Zertifikat und Servernamen prüfen.': 'Check the SMTP server name and its certificate.',
  'Die Verbindung zum IMAP-Server hat zu lange gedauert.': 'The IMAP connection timed out.',
  'Die Verbindung zum SMTP-Server hat zu lange gedauert.': 'The SMTP connection timed out.',
  'Die IMAP-Verbindung ist fehlgeschlagen. Bitte Server, Verschlüsselung und Zugangsdaten prüfen.': 'IMAP connection failed. Check the server, encryption and login.',
  'Die SMTP-Verbindung ist fehlgeschlagen. Bitte Server und Zugangsdaten prüfen.': 'SMTP connection failed. Check the server and login.',
  'Für dieses Konto ist kein IMAP-Passwort gespeichert.': 'Enter an IMAP password for this account.',
  'Für dieses Konto ist kein SMTP-Passwort gespeichert.': 'Enter an SMTP password for this account.',
  'Bei geändertem IMAP-Server, Port, Verschlüsselung oder Benutzernamen bitte das Passwort erneut eingeben.': 'Re-enter the password for the updated IMAP connection.',
  'Bitte ein Passwort für das neue Mailkonto eingeben.': 'Enter a password for the new account.',
  'Die Kontoeinstellungen werden gerade gespeichert. Bitte kurz warten.': 'The account settings are being saved.',
  'Das Mailkonto konnte nicht gespeichert werden. Die bisherigen Einstellungen wurden beibehalten.': 'Could not save the account. Your previous settings are intact.',
  'Das Mailkonto konnte nicht gespeichert und das Passwort nicht vollständig wiederhergestellt werden. Bitte die Zugangsdaten prüfen.': 'Could not save the account or fully restore the password. Check your login details.',
  'Die SMTP-Einstellungen konnten nicht gespeichert werden.': 'Could not save SMTP settings.',
  'Die SMTP-Einstellungen konnten nicht geladen werden. Ihre Datei wurde nicht verändert.': 'Could not load SMTP settings. The saved file is intact.',
  'Das Konto konnte nicht vollständig entfernt oder wiederhergestellt werden. Bitte Zugangsdaten und SMTP-Einstellungen prüfen.': 'Could not fully remove or restore the account. Check its credentials and SMTP settings.',
  'Das Mailkonto konnte nicht entfernt werden.': 'Could not remove the account.',
  'Mailkonto nicht gefunden.': 'Mail account not found.',
  'Dieses Mailkonto existiert bereits.': 'This mail account already exists.'
};
export function accountIssue(reason: unknown, locale: UiLocale) {
  const detail = formDetail(reason, locale);
  return locale === 'en' && Object.hasOwn(englishErrors, detail) ? englishErrors[detail] : detail;
}

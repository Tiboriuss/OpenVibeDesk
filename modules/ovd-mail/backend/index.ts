import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import addressParser from 'nodemailer/lib/addressparser';
import { applyUiAction, type UiAction } from '../../../shared/actions';
import type { Draft, EmailReference, EmailReferenceSummary, Folder, Mail, MailViewContext, WindowKind, WorkspaceState } from '../../../shared/model';
import type { ImapMessage, MailSendResult } from '../../../shared/mail';
import type { WorkspaceCapabilityRegistry, CapabilityContext } from '../../../electron/workspace-capabilities';
import { mailCapabilitySchemas, mailCapabilityDefinitions, type MailCapabilityArgs } from './capabilities';
import { validateMailAccount, testImapConnection, saveMailPassword, readMailPassword, deleteMailPassword, listImapFolders, fetchImapMessages, searchImapMessages, fetchImapMessageBody, downloadImapAttachment, setImapMessageRead, imapConnectionIdentity, invalidateMailAccountConnections, resumeMailAccountConnections, type MailAccountConfig } from './mail-service';
import { initializeMailAccounts, getMailAccounts, addMailAccount, updateMailAccount, removeMailAccount } from './mail-store';
import { validateSmtpSettings, testSmtpConnection, saveSmtpPassword, readSmtpPassword, deleteSmtpPassword, sendSmtpMail, type SmtpSettings } from './smtp-service';
import { initializeSmtpSettings, getSmtpSettings, listSmtpSettings, writeSmtpSettings } from './smtp-store';
import { createMailQueryHost } from './mail-query-host';

export type MailOperationContext = CapabilityContext & { grantMailIds?(ids: string[]): void; primaryEmailId?: string };
type OperationContext = MailOperationContext;
type LiveMail = { accountId: string; folder: string; message: ImapMessage; epoch: number };
type AccountSnapshot = { account: MailAccountConfig; epoch: number };
export type { MailSendResult } from '../../../shared/mail';
export interface MailModuleHost {
  getState(): WorkspaceState;
  commit(state: WorkspaceState): void;
  saveState(state: WorkspaceState): Promise<void>;
  panels: ReadonlyMap<WindowKind, BrowserWindow>;
  openPanel(kind: WindowKind): Promise<void>;
  dispatchAction(action: unknown): Promise<void>;
  prepareSettings(kind: 'account' | 'smtp', values: Record<string, unknown>, accountId?: string): Promise<unknown>;
  confirmCapability(context: OperationContext, message: string, detail: string): Promise<boolean>;
  operationOwner(context: OperationContext): BrowserWindow | undefined;
  uiOperationContext(event: Electron.IpcMainInvokeEvent): OperationContext;
  verifyPanel(event: Electron.IpcMainInvokeEvent, kinds: WindowKind[]): void;
  verifySender(event: Electron.IpcMainInvokeEvent): void;
  boundedEmailReference(mail: Pick<Mail, 'id' | 'from' | 'to' | 'subject' | 'date' | 'bodyText' | 'attachments' | 'accountName'> & Partial<EmailReference>, truncated?: boolean): EmailReference;
  savedEmailReference(id: string, sessionId?: string): EmailReference | undefined;
  snapshotEmailReference(id: unknown, sessionId: string, signal: AbortSignal): Promise<EmailReference>;
  emailReferenceSummary(id: unknown): EmailReferenceSummary;
  selectedLocalFiles: ReadonlySet<string>;
}

/** Optional trusted Mail adapter. Nothing is loaded or registered before the host activates it. */
export function createMailModule(host: MailModuleHost) {
  const { getState, commit, saveState, panels, openPanel, dispatchAction, prepareSettings, confirmCapability, operationOwner, uiOperationContext, verifyPanel, verifySender, boundedEmailReference, savedEmailReference, snapshotEmailReference, emailReferenceSummary, selectedLocalFiles } = host;
  let mailSettingsStatus: 'clean' | 'dirty' | 'busy' = 'clean';
  let mailAccountsUnavailable = false;
  let smtpSettingsUnavailable = false;
  const sendingDrafts = new Set<string>();
  const liveMail = new Map<string, LiveMail>();
  const recentMailSearches = new Map<string, string[]>();
  let activeMailView: MailViewContext | null = null;
  const knownMailFolders = new Map<string, Set<string>>();
  const accountEpochs = new Map<string, number>();
  const mutatingAccounts = new Set<string>();
  const smtpOperations = new Map<string, number>();
  const queryHost = createMailQueryHost({
    accounts: getMailAccounts, activeAccountId: () => activeMailView?.accountId,
    snapshot: accountSnapshot, assertCurrent, folders: loadMailFolders, cache: cacheMailMessages,
    grant: grantMailResults, mailAllowed: realMailAllowed, confirm: confirmCapability,
    provider: () => getState().ai?.baseUrl ? new URL(getState().ai!.baseUrl).hostname : 'den gewählten KI-Anbieter',
    present: async (result, request) => { await dispatchAction({ type: 'open_window', kind: 'mail' }); panels.get('mail')?.webContents.send('mail:query-results', { result, request }); }
  });
  let accountWrites: Promise<unknown> = Promise.resolve();
function queueAccountWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = accountWrites.then(operation);
  accountWrites = result.catch(() => {});
  return result;
}
function ensureAccountIdle(id: string): void {
  if (mutatingAccounts.has(id)) throw new Error('Die Kontoeinstellungen werden gerade gespeichert. Bitte kurz warten.');
}
function accountSnapshot(id: unknown): AccountSnapshot {
  const account = mailAccount(id);
  ensureAccountIdle(account.id);
  return { account, epoch: accountEpochs.get(account.id) ?? 0 };
}
function assertCurrent(snapshot: AccountSnapshot): void {
  if (snapshot.epoch !== (accountEpochs.get(snapshot.account.id) ?? 0) || !getMailAccounts().some(account => account.id === snapshot.account.id)) throw new Error('Die Kontoeinstellungen wurden geändert. Bitte das Postfach aktualisieren.');
}
function assertCachedCurrent(entry: LiveMail): void {
  assertCurrent({ account: mailAccount(entry.accountId), epoch: entry.epoch });
  if (!liveMail.has(entry.message.id)) throw new Error('Die Nachricht ist nicht mehr geladen. Bitte das Postfach aktualisieren.');
}
function invalidateAccountCache(id: string): void {
  accountEpochs.set(id, (accountEpochs.get(id) ?? 0) + 1);
  knownMailFolders.delete(id);
  if (activeMailView?.accountId === id) activeMailView = null;
  const removed = new Set<string>();
  for (const [mailId, entry] of liveMail) if (entry.accountId === id) { liveMail.delete(mailId); removed.add(mailId); }
  for (const [sessionId, ids] of recentMailSearches) { const next = ids.filter(mailId => !removed.has(mailId)); if (next.length) recentMailSearches.set(sessionId, next); else recentMailSearches.delete(sessionId); }
}
function ensureAccountCanChange(id: string): void {
  ensureAccountIdle(id);
  if ((smtpOperations.get(id) ?? 0) || getState().drafts.some(draft => draft.accountId === id && sendingDrafts.has(draft.id))) throw new Error('Für dieses Konto läuft noch ein Versand- oder Verbindungsvorgang. Bitte warte auf dessen Abschluss.');
}
function effectiveSmtp(config: SmtpSettings): SmtpSettings {
  return config.useImapCredentials ? { ...config, username: mailAccount(config.accountId).username } : config;
}
async function withSmtpOperation<T>(config: SmtpSettings, work: (effective: SmtpSettings) => Promise<T>): Promise<T> {
  ensureAccountIdle(config.accountId);
  const effective = effectiveSmtp(config);
  smtpOperations.set(config.accountId, (smtpOperations.get(config.accountId) ?? 0) + 1);
  try { return await work(effective); }
  finally { const count = (smtpOperations.get(config.accountId) ?? 1) - 1; if (count) smtpOperations.set(config.accountId, count); else smtpOperations.delete(config.accountId); }
}
function mailAccount(id: unknown) {
  ensureMailAccountsAvailable();
  if (typeof id !== 'string') throw new Error('Ungültiges Mailkonto.');
  const account = getMailAccounts().find(item => item.id === id);
  if (!account) throw new Error('Mailkonto nicht gefunden.');
  return account;
}
function ensureMailAccountsAvailable(): void {
  if (mailAccountsUnavailable) throw new Error('Die gespeicherten Mailkonten konnten nicht geladen werden. Ihre Datei wurde nicht verändert.');
}
function ensureSmtpSettingsAvailable(): void {
  if (smtpSettingsUnavailable) throw new Error('Die SMTP-Einstellungen konnten nicht geladen werden. Ihre Datei wurde nicht verändert.');
}
function smtpInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Bitte gültige SMTP-Einstellungen eingeben.');
  const { password, ...rawSettings } = input as Record<string, unknown>;
  if (password !== undefined && (typeof password !== 'string' || !password || password.length > 4096)) throw new Error('Bitte ein gültiges SMTP-Passwort eingeben.');
  const config = effectiveSmtp(validateSmtpSettings(rawSettings));
  mailAccount(config.accountId);
  if (config.useImapCredentials && password !== undefined) throw new Error('Bei gemeinsamen Zugangsdaten ist kein separates SMTP-Passwort erforderlich.');
  return { config, password: password as string | undefined };
}
function notifyMailAccountsChanged(): void {
  for (const kind of ['settings', 'mail', 'draft'] as const) {
    const win = panels.get(kind);
    if (win && !win.isDestroyed()) win.webContents.send('mail:accounts:changed');
  }
}
function cachedMail(id: unknown) {
  if (typeof id !== 'string') throw new Error('Ungültige Nachricht.');
  const entry = liveMail.get(id);
  if (!entry) throw new Error('Die Nachricht ist nicht mehr geladen. Bitte das Postfach aktualisieren.');
  assertCachedCurrent(entry);
  return entry;
}
function realMailAllowed(): boolean {
  return getState().ai?.workspaceTools !== false && getState().ai?.realMailAccess === true;
}
function externalMail(entry: { accountId: string; folder: string; message: ImapMessage }): Mail & Partial<EmailReference> {
  const m = entry.message;
  return { id: m.id, folder: 'Inbox', threadId: m.id, from: m.from, to: m.to, subject: m.subject,
    date: m.date, bodyText: m.bodyText, attachments: m.attachments.map(({ name, size }) => ({ name, size })),
    read: m.read, bodyLoaded: m.bodyLoaded, accountName: mailAccount(entry.accountId).name, externalFolder: entry.folder, accountId: entry.accountId, fromAddresses: m.fromAddresses, replyToAddresses: m.replyToAddresses, messageId: m.messageId, references: m.references };
}
async function readSmtpSettings(context: OperationContext) {

    ensureMailAccountsAvailable(); ensureSmtpSettingsAvailable();
    const validIds = new Set(getMailAccounts().map(account => account.id));
    const configs = listSmtpSettings().filter(config => validIds.has(config.accountId));
    return Promise.all(configs.map(async config => ({ ...effectiveSmtp(config), hasPassword: !!(await readSmtpPassword(config.accountId)) })));
}
async function checkSmtpSettings(input: unknown, context: OperationContext) {
     ensureSmtpSettingsAvailable();
    const { config, password } = smtpInput(input);
    await withSmtpOperation(config, effective => testSmtpConnection(effective, password));
}
async function saveSmtpSettings(input: unknown, context: OperationContext) {
     ensureSmtpSettingsAvailable();
    const { config, password } = smtpInput(input);
    if (getState().drafts.some(draft => draft.accountId === config.accountId && sendingDrafts.has(draft.id))) throw new Error('Für dieses Konto läuft noch ein Versand. Bitte warte auf dessen Abschluss.');
    return withSmtpOperation(config, async effective => {
    await testSmtpConnection(effective, password);
    const oldPassword = password ? await readSmtpPassword(config.accountId) : null;
    if (password) await saveSmtpPassword(config.accountId, password);
    try { await writeSmtpSettings(effective); }
    catch {
      if (password) {
        if (oldPassword) await saveSmtpPassword(config.accountId, oldPassword).catch(() => {});
        else await deleteSmtpPassword(config.accountId).catch(() => {});
      }
      throw new Error('Die SMTP-Einstellungen konnten nicht gespeichert werden.');
    }
    notifyMailAccountsChanged();
    });
}
function sendResult(draftId: string, status: MailSendResult['status'], deliveryStatus: MailSendResult['deliveryStatus'], details: Partial<Omit<MailSendResult, 'draftId' | 'status' | 'outcome' | 'ok' | 'sent' | 'deliveryStatus'>> = {}): MailSendResult {
  return { draftId, status, outcome: status === 'sent' ? 'completed' : status, ok: status === 'sent', sent: status === 'sent', deliveryStatus, ...details };
}
function existingSendResult(draft: Draft): MailSendResult | undefined {
  if (draft.deliveryStatus === 'sent') return sendResult(draft.id, 'sent', 'sent', { message: 'Die Nachricht wurde bereits vom SMTP-Server angenommen. Es wurde kein weiterer Versand gestartet.', alreadySent: true, duplicatePrevented: true, retryBlocked: true, ...(draft.deliveryError ? { warning: draft.deliveryError } : {}), ...(draft.rejectedRecipients?.length ? { rejectedRecipients: draft.rejectedRecipients } : {}) });
  if (draft.deliveryStatus === 'uncertain' || draft.deliveryStatus === 'sending' || sendingDrafts.has(draft.id)) return sendResult(draft.id, 'uncertain', draft.deliveryStatus ?? 'sending', { message: draft.deliveryStatus === 'uncertain' ? 'Der Versandstatus ist unklar. Die Nachricht könnte bereits angenommen worden sein. Bitte vor einem weiteren Versand prüfen.' : 'Der Versand läuft bereits. Es wurde kein weiterer Versand gestartet.', duplicatePrevented: true, retryBlocked: true });
  return undefined;
}
function safeSendMessage(error: unknown, fallback = 'Der Versand konnte nicht vorbereitet werden.'): string {
  const message = error instanceof Error ? error.message.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').slice(0, 600) : '';
  return /^(Bitte |Der Entwurf |Dieser Entwurf |Die SMTP-|Die Kontoeinstellungen |Das Mailkonto |Die gespeicherten |Für dieses Konto |Der Anhang |Die Anhänge |Ein Anhang |Die Versandkonfiguration |Die Kontoeinstellungen werden)/.test(message) ? message : fallback;
}
async function sendDraft(draftId: unknown, context: OperationContext): Promise<MailSendResult> {
  if (typeof draftId !== 'string' || !draftId) throw new Error('Ungültiger Entwurf.');
  const original = getState().drafts.find(item => item.id === draftId);
  if (!original) return sendResult(draftId, 'failed', 'draft', { error: 'Der Entwurf wurde nicht gefunden.' });
  const known = existingSendResult(original);
  if (known) return known;
  const draft = structuredClone(original), draftVersion = JSON.stringify(original);
  const setStatus = (patch: Partial<Draft>) => commit({ ...getState(), drafts: getState().drafts.map(item => item.id === draftId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item) });
  const failed = (message: string): MailSendResult => {
    setStatus({ deliveryStatus: 'draft', deliveryError: message });
    return sendResult(draftId, 'failed', 'draft', { error: message });
  };
  let account: MailAccountConfig, config: SmtpSettings;
  try {
    ensureSmtpSettingsAvailable();
    if (!draft.accountId) throw new Error('Bitte zuerst ein Sendekonto auswählen.');
    const snapshot = accountSnapshot(draft.accountId);
    account = snapshot.account;
    const saved = getSmtpSettings(account.id);
    if (!saved) throw new Error('Bitte zuerst SMTP für dieses Konto in den E-Mail-Einstellungen einrichten.');
    config = effectiveSmtp(saved);
    const confirmed = await confirmCapability(context, 'Diese E-Mail jetzt senden?', [`Von: ${account.email}`, `An: ${draft.to || '(keine direkten Empfänger)'}`, `CC: ${draft.cc || '–'}`, `BCC: ${draft.bcc || '–'}`, `Betreff: ${draft.subject || '(Kein Betreff)'}`, `Anhänge: ${draft.attachments.length ? draft.attachments.map(file => file.name).join(', ') : 'keine'}`].join('\n'));
    context.signal.throwIfAborted();
    const current = getState().drafts.find(item => item.id === draftId);
    if (current) { const existing = existingSendResult(current); if (existing) return existing; }
    if (!confirmed) return sendResult(draftId, 'cancelled', 'draft', { cancelled: true, message: 'Der Versand wurde abgebrochen. Es wurde keine Nachricht gesendet.' });
    if (!current || JSON.stringify(current) !== draftVersion) throw new Error('Der Entwurf wurde geändert. Bitte prüfe ihn vor dem Senden erneut.');
    ensureAccountIdle(account.id); assertCurrent(snapshot);
    const currentSmtp = getSmtpSettings(account.id);
    if ((smtpOperations.get(account.id) ?? 0) || !currentSmtp || JSON.stringify(effectiveSmtp(currentSmtp)) !== JSON.stringify(config)) throw new Error('Die Versandkonfiguration wurde geändert oder wird gerade geprüft. Bitte erneut prüfen.');
  } catch (error) {
    // Another confirmed call may have completed while this call's dialog was open.
    const current = getState().drafts.find(item => item.id === draftId);
    if (current) { const existing = existingSendResult(current); if (existing) return existing; }
    if (context.signal.aborted) return sendResult(draftId, 'cancelled', 'draft', { cancelled: true, message: 'Der Versand wurde vor der Übergabe an den SMTP-Server gestoppt.' });
    return failed(safeSendMessage(error));
  }
  sendingDrafts.add(draftId);
  try {
    setStatus({ deliveryStatus: 'sending', deliveryError: undefined, rejectedRecipients: undefined });
    try { await saveState(getState()); }
    catch { return { ...failed('Der Versand wurde nicht begonnen, weil der Entwurf nicht gespeichert werden konnte.'), persisted: false }; }
    if (context.signal.aborted) {
      setStatus({ deliveryStatus: 'draft', deliveryError: undefined });
      let persisted = true;
      try { await saveState(getState()); } catch { persisted = false; }
      return sendResult(draftId, 'cancelled', 'draft', { cancelled: true, message: 'Der Versand wurde vor der Übergabe an den SMTP-Server gestoppt.', persisted });
    }
    let result: Awaited<ReturnType<typeof sendSmtpMail>>;
    try {
      result = await sendSmtpMail(config, { from: account.email, to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, text: draft.body, attachments: draft.attachments.map(file => ({ path: file.path, name: file.name })), inReplyTo: draft.inReplyTo, references: draft.references });
    } catch (error) {
      const outcome = failed(safeSendMessage(error));
      try { await saveState(getState()); return { ...outcome, persisted: true }; }
      catch { return { ...outcome, persisted: false, warning: 'Der lokale Versandstatus konnte nicht gespeichert werden.' }; }
    }
    let outcome: MailSendResult;
    if (result.status === 'sent') {
      const warning = result.rejected.length ? 'Einige Empfänger wurden vom Server abgelehnt; an die übrigen wurde die Nachricht übergeben.' : undefined;
      setStatus({ deliveryStatus: 'sent', rejectedRecipients: result.rejected, deliveryError: warning });
      outcome = sendResult(draftId, 'sent', 'sent', { message: 'Die Nachricht wurde vom SMTP-Server angenommen.', acceptedRecipients: result.accepted, rejectedRecipients: result.rejected, retryBlocked: true, ...(warning ? { warning } : {}) });
    } else if (result.status === 'failed') {
      setStatus({ deliveryStatus: 'draft', deliveryError: result.message, rejectedRecipients: result.rejected });
      outcome = sendResult(draftId, 'failed', 'draft', { error: result.message, rejectedRecipients: result.rejected });
    } else {
      setStatus({ deliveryStatus: 'uncertain', deliveryError: result.message });
      outcome = sendResult(draftId, 'uncertain', 'uncertain', { message: result.message, retryBlocked: true });
    }
    try { await saveState(getState()); return { ...outcome, persisted: true }; }
    catch {
      const warning = result.status === 'sent' ? 'Der Server hat die Nachricht angenommen, aber der Status konnte lokal nicht gespeichert werden. Bitte den Gesendet-Ordner prüfen; nicht erneut senden.' : 'Der lokale Versandstatus konnte nicht gespeichert werden. Bitte vor einem weiteren Versand den Gesendet-Ordner prüfen.';
      if (result.status !== 'failed') setStatus({ deliveryError: warning });
      return { ...outcome, persisted: false, warning: [outcome.warning, warning].filter(Boolean).join(' ') };
    }
  } finally { sendingDrafts.delete(draftId); }
}
function accountInput(input: unknown) {
  ensureMailAccountsAvailable();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Bitte gültige Kontodaten eingeben.');
  const { accountId, password: rawPassword, ...fields } = input as Record<string, unknown>;
  const previous = accountId === undefined ? undefined : mailAccount(accountId);
  const password = rawPassword === '' ? undefined : rawPassword;
  const parsed = validateMailAccount({ ...fields, id: previous?.id ?? randomUUID(), ...(password === undefined ? {} : { password }) });
  const { password: suppliedPassword, ...account } = parsed;
  if (!suppliedPassword && !previous) throw new Error('Bitte ein Passwort für das neue Mailkonto eingeben.');
  if (!suppliedPassword && previous && imapConnectionIdentity(previous) !== imapConnectionIdentity(account)) throw new Error('Bei geändertem IMAP-Server, Port, Verschlüsselung oder Benutzernamen bitte das Passwort erneut eingeben.');
  return { account, password: suppliedPassword, previous };
}
async function checkMailAccount(input: unknown, context: OperationContext) {
  const { account, password, previous } = accountInput(input);
  const snapshot = previous ? accountSnapshot(previous.id) : undefined;
  await testImapConnection(account, password);
  context.signal.throwIfAborted();
  if (snapshot) assertCurrent(snapshot);
}
async function saveMailAccount(input: unknown, context: OperationContext) {
  return queueAccountWrite(async () => {
    const { account, password, previous } = accountInput(input);
    ensureAccountCanChange(account.id);
    mutatingAccounts.add(account.id);
    let paused = false;
    try {
      await testImapConnection(account, password);
      context.signal.throwIfAborted();
      const oldPassword = password ? await readMailPassword(account.id) : null;
      context.signal.throwIfAborted();
      // Pause before changing credentials: pending keyring reads must not connect to an old endpoint.
      invalidateMailAccountConnections(account.id, true); paused = true;
      invalidateAccountCache(account.id);
      try {
        if (password) await saveMailPassword(account.id, password);
        if (previous) await updateMailAccount(account); else await addMailAccount(account);
      } catch {
        let recovered = true;
        if (password) {
          if (oldPassword) await saveMailPassword(account.id, oldPassword).catch(() => { recovered = false; });
          else await deleteMailPassword(account.id).catch(() => { recovered = false; });
        }
        throw new Error(recovered ? 'Das Mailkonto konnte nicht gespeichert werden. Die bisherigen Einstellungen wurden beibehalten.' : 'Das Mailkonto konnte nicht gespeichert und das Passwort nicht vollständig wiederhergestellt werden. Bitte die Zugangsdaten prüfen.');
      }
    } finally {
      if (paused) resumeMailAccountConnections(account.id);
      mutatingAccounts.delete(account.id);
      if (paused) notifyMailAccountsChanged();
    }
  });
}
async function deleteMailAccount(accountId: unknown, context: OperationContext) {
  return queueAccountWrite(async () => {
     ensureSmtpSettingsAvailable();
    const account = mailAccount(accountId);
    const confirmed = await confirmCapability(context, `„${account.name}“ aus OpenVibeDesk entfernen?`, 'Das Mailkonto auf dem Server und seine Nachrichten bleiben erhalten.');
    context.signal.throwIfAborted();
    if (!confirmed) return false;
    ensureAccountCanChange(account.id);
    mutatingAccounts.add(account.id);
    try {
    const password = await readMailPassword(account.id);
    const smtp = getSmtpSettings(account.id);
    const smtpPassword = await readSmtpPassword(account.id);
    invalidateMailAccountConnections(account.id, true);
    invalidateAccountCache(account.id);
    try {
      if (smtp) await writeSmtpSettings({ accountId: account.id, remove: true });
      if (smtpPassword) await deleteSmtpPassword(account.id);
      if (password) await deleteMailPassword(account.id);
      await removeMailAccount(account.id);
    } catch {
      let recovered = true;
      if (password) await saveMailPassword(account.id, password).catch(() => { recovered = false; });
      if (smtpPassword) await saveSmtpPassword(account.id, smtpPassword).catch(() => { recovered = false; });
      if (smtp) await writeSmtpSettings(smtp).catch(() => { recovered = false; });
      throw new Error(recovered ? 'Das Mailkonto konnte nicht entfernt werden.' : 'Das Konto konnte nicht vollständig entfernt oder wiederhergestellt werden. Bitte Zugangsdaten und SMTP-Einstellungen prüfen.');
    }
    notifyMailAccountsChanged();
    return true;
    } finally { resumeMailAccountConnections(account.id); mutatingAccounts.delete(account.id); }
  });
}
function cacheMailMessages(snapshot: AccountSnapshot, folder: string, messages: Awaited<ReturnType<typeof fetchImapMessages>>['messages'], uidValidity: string): ImapMessage[] {
  assertCurrent(snapshot);
  const { account, epoch } = snapshot, accountId = account.id;
  for (const [id, entry] of liveMail) if (entry.accountId === accountId && entry.folder === folder && entry.message.uidValidity !== uidValidity) liveMail.delete(id);
  const result = messages.map(message => {
    const id = createHash('sha256').update(JSON.stringify([accountId, imapConnectionIdentity(account), folder, message.uidValidity, message.uid])).digest('hex');
    const previous = liveMail.get(id)?.message;
    const merged: ImapMessage = { ...message, id, accountId, accountName: account.name, folder, ...(previous?.bodyLoaded ? { bodyText: previous.bodyText, bodyLoaded: true, truncated: previous.truncated } : {}) };
    liveMail.delete(id); liveMail.set(id, { accountId, folder, message: merged, epoch });
    return merged;
  });
  while (liveMail.size > 1000) liveMail.delete(liveMail.keys().next().value!);
  return result;
}
async function searchWorkspaceMail(request: import('../../../shared/mail').MailSearchRequest, context: OperationContext): Promise<import('../../../shared/mail').MailSearchResults> {
  const args = mailCapabilitySchemas['mail.search'].parse(request);
  ensureMailAccountsAvailable();
  const accounts = args.accountId ? [mailAccount(args.accountId)] : activeMailView?.accountId ? [mailAccount(activeMailView.accountId)] : getMailAccounts();
  const snapshots = new Map(accounts.map(account => [account.id, accountSnapshot(account.id)]));
  const assertSearchCurrent = () => { for (const snapshot of snapshots.values()) assertCurrent(snapshot); };
  if (!accounts.length) throw new Error('Bitte zuerst ein Mailkonto einrichten.');
  if (context.origin === 'agent' && !realMailAllowed()) {
    const baseUrl = getState().ai?.baseUrl;
    const provider = baseUrl ? new URL(baseUrl).hostname : 'den gewählten KI-Anbieter';
    const allowed = await confirmCapability(context, 'Diese Postfachsuche einmalig erlauben?', `Suchbegriff: ${args.query}\nKonten: ${accounts.map(account => account.name).join(', ')}\n\nPassende Treffer und bei Bedarf deren Mailtext können an ${provider} übermittelt werden. Antworten werden lokal im Chat gespeichert; Anhangdateien werden nicht übertragen. Die allgemeine Mailfreigabe bleibt unverändert.`);
    if (!allowed) throw new Error('Die Postfachsuche wurde nicht freigegeben.');
  }
  const targets: { accountId: string; folder: string }[] = [];
  for (const account of accounts) {
    context.signal.throwIfAborted();
    assertSearchCurrent();
    const folders = await loadMailFolders(account.id);
    if (args.folder && !folders.some(folder => folder.path === args.folder && folder.selectable)) throw new Error('Der Suchordner wurde nicht gefunden.');
    for (const folder of folders.filter(item => item.selectable && (!args.folder || item.path === args.folder))) targets.push({ accountId: account.id, folder: folder.path });
  }
  targets.sort((a, b) => Number(b.folder.toLowerCase() === 'inbox') - Number(a.folder.toLowerCase() === 'inbox'));
  const selected = targets.slice(0, 10), limit = args.limit ?? 50;
  const messages: ImapMessage[] = [], warnings: string[] = [];
  let total = 0, foldersSearched = 0, hasMore = targets.length > selected.length;
  for (let offset = 0; offset < selected.length; offset += 2) {
    context.signal.throwIfAborted();
    const batch = await Promise.allSettled(selected.slice(offset, offset + 2).map(async target => {
      const snapshot = snapshots.get(target.accountId)!;
      assertCurrent(snapshot);
      const page = await searchImapMessages(snapshot.account, target.folder, args.query, limit);
      context.signal.throwIfAborted();
      assertCurrent(snapshot);
      return { target, page, snapshot };
    }));
    for (const result of batch) {
      if (result.status === 'rejected') { if (context.signal.aborted) context.signal.throwIfAborted(); warnings.push('Ein Mailordner konnte nicht durchsucht werden.'); continue; }
      foldersSearched++; total += result.value.page.total; hasMore ||= result.value.page.hasMore;
      messages.push(...cacheMailMessages(result.value.snapshot, result.value.target.folder, result.value.page.messages, result.value.page.uidValidity));
    }
  }
  assertSearchCurrent();
  if (!foldersSearched && selected.length) throw new Error('Die Server-Suche konnte nicht ausgeführt werden. Bitte die Mailverbindung prüfen.');
  const unique = [...new Map(messages.map(message => [message.id, message])).values()].sort((a, b) => b.date.localeCompare(a.date));
  hasMore ||= unique.length > limit || warnings.length > 0;
  const results: import('../../../shared/mail').MailSearchResults = { query: args.query, messages: unique.slice(0, limit), total, hasMore, scope: `Serversuche · ${foldersSearched} ${foldersSearched === 1 ? 'Ordner' : 'Ordner'} · ${accounts.map(account => account.name).join(', ')}`, foldersSearched, foldersRemaining: Math.max(0, targets.length - foldersSearched), ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}) };
  grantMailResults(results.messages.slice(0, 20), context);
  context.signal.throwIfAborted();
  await dispatchAction({ type: 'open_window', kind: 'mail' });
  assertSearchCurrent();
  panels.get('mail')?.webContents.send('mail:search-results', results);
  return results;
}

async function loadMailMessages(accountId: unknown, folder: unknown, cursor: unknown, context: OperationContext) {
  if (typeof folder !== 'string') throw new Error('Ungültiger Mail-Ordner.');
  const snapshot = accountSnapshot(accountId);
  const page = await fetchImapMessages(snapshot.account, folder, cursor);
  context.signal.throwIfAborted();
  return { messages: cacheMailMessages(snapshot, folder, page.messages, page.uidValidity), total: page.total, hasMore: page.hasMore, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
}

function grantMailResults(messages: readonly ImapMessage[], context: OperationContext): void {
  const ids = messages.map(message => message.id);
  context.grantMailIds?.(ids);
  if (context.origin === 'agent' && context.sessionId) {
    recentMailSearches.delete(context.sessionId); recentMailSearches.set(context.sessionId, ids);
    while (recentMailSearches.size > 100) recentMailSearches.delete(recentMailSearches.keys().next().value!);
  }
}

async function listWorkspaceMail(args: MailCapabilityArgs<'mail.list_messages'>, context: OperationContext) {
  ensureMailAccountsAvailable();
  const accounts = getMailAccounts();
  if (!accounts.length) throw new Error('Bitte zuerst ein Mailkonto einrichten.');
  const snapshot = accountSnapshot(args.accountId ?? activeMailView?.accountId ?? accounts[0].id);
  const limit = args.limit ?? 10;
  context.signal.throwIfAborted();
  if (context.origin === 'agent' && !realMailAllowed()) {
    const baseUrl = getState().ai?.baseUrl;
    const provider = baseUrl ? new URL(baseUrl).hostname : 'den gewählten KI-Anbieter';
    const allowed = await confirmCapability(context, 'Diese Mailauflistung einmalig erlauben?', `Konto: ${snapshot.account.name}\nOrdner: ${args.folder ?? 'Posteingang'}\nHöchstens ${limit} Nachrichten${args.cursor ? ' vor der angegebenen Position' : ', neueste zuerst'}. Frühere Suchfilter gelten nicht.\n\nMetadaten dieser Mails und bei gezieltem Nachfragen deren Mailtext können an ${provider} übermittelt werden. Antworten werden lokal im Chat gespeichert; Anhangdateien werden nicht übertragen. Die allgemeine Mailfreigabe bleibt unverändert.`);
    if (!allowed) return { outcome: 'cancelled' as const, cancelled: true, message: 'Die Mailauflistung wurde nicht freigegeben. Es wurden keine Nachrichten abgerufen.' };
  }
  context.signal.throwIfAborted(); assertCurrent(snapshot);
  const folders = await loadMailFolders(snapshot.account.id);
  context.signal.throwIfAborted(); assertCurrent(snapshot);
  const target = args.folder ? folders.find(item => item.path === args.folder && item.selectable) : folders.find(item => item.selectable && (item.specialUse?.toLowerCase() === '\\inbox' || item.path.toLowerCase() === 'inbox'));
  if (!target) throw new Error(args.folder ? 'Der angegebene Mailordner wurde nicht gefunden.' : 'Für dieses Konto wurde kein Posteingang gefunden. Bitte einen Ordner aus mail.list_folders angeben.');
  const page = await fetchImapMessages(snapshot.account, target.path, args.cursor, limit);
  context.signal.throwIfAborted(); assertCurrent(snapshot);
  const messages = cacheMailMessages(snapshot, target.path, page.messages, page.uidValidity);
  grantMailResults(messages, context);
  return {
    accountId: snapshot.account.id, accountName: snapshot.account.name.slice(0, 80), folder: target.path,
    scope: `${snapshot.account.name} · ${target.name || target.path} · ohne Suchfilter`,
    order: 'server_uid_desc', orderDescription: 'Neueste Server-UID zuerst (Reihenfolge der Aufnahme in diesen Ordner). date ist das Absenderdatum, receivedAt die Serverzeit; keine globale Datumsrangliste aller Konten oder Ordner.',
    returnedCount: messages.length, requestedLimit: limit, total: page.total, totalScope: args.cursor ? 'before_cursor' : 'folder', hasMore: page.hasMore,
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    messages: messages.map(({ id, from, to, subject, date, receivedAt, read, attachments }) => ({ id, from: from.slice(0, 240), to: to.slice(0, 240), subject: subject.slice(0, 240), date, receivedAt, read, attachmentCount: attachments.length }))
  };
}

async function loadMailMessage(messageId: unknown, context: OperationContext) {

    const entry = cachedMail(messageId);
    const body = await fetchImapMessageBody(mailAccount(entry.accountId), entry.folder, entry.message.uidValidity, entry.message.uid);
    context.signal.throwIfAborted(); assertCachedCurrent(entry);
    entry.message = { ...entry.message, ...body };
    panels.get('mail')?.webContents.send('mail:message-changed', entry.message);
    return entry.message;
}
async function saveMailAttachment(messageId: unknown, index: unknown, context: OperationContext) {

    const entry = cachedMail(messageId);
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= entry.message.attachments.length) throw new Error('Anhang nicht gefunden.');
    const attachment = entry.message.attachments[index as number];
    const owner = operationOwner(context);
    if (!owner) throw new Error('Mailfenster nicht gefunden.');
    const suggested = path.basename(attachment.name.replace(/[\\/\x00-\x1f\x7f]/g, '_')).slice(0, 180) || 'Anhang';
    const choice = await dialog.showSaveDialog(owner, { title: 'Anhang speichern', defaultPath: suggested });
    context.signal.throwIfAborted();
    if (choice.canceled || !choice.filePath) return false;
    assertCachedCurrent(entry);
    const data = await downloadImapAttachment(mailAccount(entry.accountId), entry.folder, entry.message.uidValidity, entry.message.uid, attachment.part);
    context.signal.throwIfAborted(); assertCachedCurrent(entry);
    await fs.writeFile(choice.filePath, data.content);
    return true;
}
async function changeMailRead(messageId: unknown, read: unknown, context: OperationContext) {

    if (typeof read !== 'boolean') throw new Error('Ungültiger Nachrichtenstatus.');
    const entry = cachedMail(messageId);
    await setImapMessageRead(mailAccount(entry.accountId), entry.folder, entry.message.uidValidity, entry.message.uid, read);
    context.signal.throwIfAborted(); assertCachedCurrent(entry);
    entry.message = { ...entry.message, read };
    panels.get('mail')?.webContents.send('mail:message-changed', entry.message);
}
function requireMailboxAccess(context: OperationContext): void {
  if (context.origin === 'agent' && !realMailAllowed()) throw new Error('Für das Durchsuchen weiterer Postfachinhalte ist die allgemeine Mailfreigabe erforderlich. Eine ausdrücklich referenzierte oder aktuell ausgewählte Mail kann direkt verwendet werden.');
}
function authorizedMailId(raw: string | undefined, context: OperationContext): string {
  const refs = [...(context.referenceIds ?? [])];
  const id = raw ?? context.primaryEmailId ?? activeMailView?.messageId ?? (refs.length === 1 ? refs[0] : undefined);
  if (!id && refs.length > 1) throw new Error('Mehrere Mailreferenzen sind verfügbar. Bitte eine konkrete Mail-ID aus dem aktuellen Kontext auswählen.');
  if (!id) throw new Error('Bitte eine Mail referenzieren oder im Mailfenster auswählen.');
  if (context.origin === 'agent' && !realMailAllowed() && !context.referenceIds?.includes(id) && activeMailView?.messageId !== id) throw new Error('Diese Mail wurde für diesen Auftrag nicht ausgewählt oder freigegeben.');
  if (!liveMail.has(id) && !savedEmailReference(id, context.sessionId)) throw new Error('Die Mail ist nicht mehr verfügbar. Bitte erneut im Mailfenster laden.');
  return id;
}
function referenceFor(id: string, context: OperationContext): EmailReference {
  const live = liveMail.get(id);
  const reference = live ? boundedEmailReference(externalMail(live), live.message.truncated) : savedEmailReference(id, context.sessionId);
  if (!reference) throw new Error('Mailreferenz nicht gefunden.');
  return reference;
}
async function openRealMail(id: string): Promise<{ openRequested: true; emailId: string }> {
  const entry = cachedMail(id);
  await dispatchAction({ type: 'open_window', kind: 'mail' });
  assertCachedCurrent(entry);
  panels.get('mail')?.webContents.send('mail:show-real', { accountId: entry.accountId, folder: entry.folder, messageId: id });
  return { openRequested: true, emailId: id };
}
async function loadMailFolders(accountId: unknown) {
  const snapshot = accountSnapshot(accountId);
  const folders = await listImapFolders(snapshot.account);
  assertCurrent(snapshot);
  knownMailFolders.set(snapshot.account.id, new Set(folders.filter(item => item.selectable).map(item => item.path)));
  return folders;
}
function activeDraftId(id?: string): string {
  const chosen = id ?? getState().activeDraftId;
  if (!chosen || !getState().drafts.some(item => item.id === chosen)) throw new Error('Bitte zuerst einen Entwurf erstellen oder auswählen.');
  return chosen;
}
async function openDraft(id?: string) {
  const draftId = activeDraftId(id);
  commit({ ...getState(), activeDraftId: draftId });
  await openPanel('draft');
  return { draftId, opened: true };
}
async function createWorkspaceDraft(args: MailCapabilityArgs<'drafts.create'>, context: OperationContext) {
  const usesSource = !!args.sourceEmailId || !!args.recipientFromSource || args.mode === 'reply';
  const sourceId = usesSource ? authorizedMailId(args.sourceEmailId, context) : undefined;
  const source = sourceId ? referenceFor(sourceId, context) : undefined;
  const accounts = getMailAccounts();
  const candidate = args.accountId ?? source?.accountId ?? activeMailView?.accountId ?? (accounts.length === 1 ? accounts[0].id : undefined);
  const account = candidate ? mailAccount(candidate) : undefined;
  let to = args.to ?? '';
  if (source && (args.recipientFromSource || args.mode === 'reply')) {
    const parsed = addressParser(source.from, { flatten: true }).map(item => item.address);
    const addresses = args.recipientFromSource === 'sender' ? source.fromAddresses ?? parsed : source.replyToAddresses?.length ? source.replyToAddresses : source.fromAddresses ?? parsed;
    if (addresses.length !== 1 || !addresses[0] || /[\r\n]/.test(addresses[0])) throw new Error('Für die ausgewählte Mail konnte keine eindeutige Empfängeradresse ermittelt werden.');
    to = addresses[0];
  }
  const reply = args.mode === 'reply';
  const safeMessageId = (value: string) => /^<[^<>\s]+@[^<>\s]+>$/.test(value) && value.length <= 500;
  const originalId = reply && source?.messageId && safeMessageId(source.messageId) ? source.messageId : undefined;
  const references = reply ? [...(source?.references ?? []).filter(safeMessageId), ...(originalId ? [originalId] : [])].slice(-20) : [];
  const quote = reply && source?.bodyText ? `\n\n${source.bodyText.slice(0, 20000).split('\n').map(line => `> ${line}`).join('\n')}` : '';
  const draft: Draft = { id: randomUUID(), ...(account ? { accountId: account.id } : {}), to, cc: args.cc ?? '', bcc: args.bcc ?? '', subject: args.subject ?? (reply && source ? `Re: ${source.subject.replace(/^Re:\s*/i, '')}`.slice(0, 1000) : ''), body: `${args.body ?? ''}${quote}`.slice(0, 100000), attachments: [], updatedAt: new Date().toISOString(), ...(originalId ? { inReplyTo: originalId } : {}), ...(references.length ? { references } : {}) };
  context.signal.throwIfAborted();
  const previousDraftId = getState().activeDraftId;
  commit({ ...applyUiAction(getState(), { type: 'open_window', kind: 'draft' }).state, drafts: [...getState().drafts, draft], activeDraftId: draft.id });
  try { await saveState(getState()); } catch { commit({ ...getState(), drafts: getState().drafts.filter(item => item.id !== draft.id), activeDraftId: previousDraftId }); throw new Error('Der Entwurf konnte nicht lokal gespeichert werden und wurde nicht geöffnet.'); }
  try { await openPanel('draft'); return { draftId: draft.id, accountId: account?.id, to: draft.to, subject: draft.subject, opened: true, sent: false }; }
  catch { return { draftId: draft.id, accountId: account?.id, to: draft.to, opened: false, created: true, sent: false }; }
}
async function snapshotLiveReference(id: string, signal: AbortSignal): Promise<EmailReference | undefined> {
  const live = liveMail.get(id);
  if (!live) return undefined;
  if (!live.message.bodyLoaded) {
    const body = await fetchImapMessageBody(mailAccount(live.accountId), live.folder, live.message.uidValidity, live.message.uid);
    signal.throwIfAborted();
    assertCachedCurrent(live);
    const current = liveMail.get(id);
    if (!current || current.accountId !== live.accountId || current.folder !== live.folder || current.message.uidValidity !== live.message.uidValidity || current.message.uid !== live.message.uid) throw new Error('Die Mail ist nicht mehr geladen. Bitte erneut in den Chat ziehen.');
    current.message = { ...current.message, ...body };
    panels.get('mail')?.webContents.send('mail:message-changed', current.message);
    return boundedEmailReference(externalMail(current), current.message.truncated);
  }
  return boundedEmailReference(externalMail(live), live.message.truncated);
}
async function initialize(): Promise<void> {
  try { await initializeMailAccounts(); }
  catch { mailAccountsUnavailable = true; dialog.showErrorBox('Mailkonten', 'Die gespeicherten Mailkonten konnten nicht geladen werden. Die Kontodatei wurde nicht verändert.'); }
  try { await initializeSmtpSettings(); }
  catch { smtpSettingsUnavailable = true; dialog.showErrorBox('SMTP-Einstellungen', 'Die gespeicherten SMTP-Einstellungen konnten nicht geladen werden. Die Datei wurde nicht verändert.'); }
  let state = getState();
  if ((state.mailLayoutRevision ?? 0) < 2) state = { ...state, mailLayoutRevision: 2, windows: state.windows.map(win => win.kind === 'mail' ? { ...win, width: Math.max(win.width, 1070), height: Math.max(win.height, 720) } : win) };
  state = { ...state, drafts: state.drafts.map(draft => draft.deliveryStatus === 'sending' ? { ...draft, deliveryStatus: 'uncertain', deliveryError: 'Der Versandstatus ist nach einem Neustart unklar. Bitte vor einem erneuten Versand prüfen.' } : draft) };
  commit(state);
}
function registerCapabilities(workspaceCapabilities: WorkspaceCapabilityRegistry): void {
  const querySummary = (result: Extract<Awaited<ReturnType<typeof queryHost.count>>, { count: number }>) => ({
    count: result.count, countExact: result.countExact, complete: result.complete,
    scope: result.scope.slice(0, 1200), observedAt: result.observedAt,
    filter: result.filter, resolvedRange: result.resolvedRange, scannedCount: result.scannedCount, candidateCount: result.candidateCount,
    warnings: result.warnings?.slice(0, 5).map(value => value.slice(0, 160)),
    scopeDetails: { ...result.scopeDetails, accounts: result.scopeDetails.accounts.map(({ id, name }) => ({ id, name: name.slice(0, 80) })) }
  });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.count'], async (args, context) => {
    const result = await queryHost.count(args, context as OperationContext);
    return 'cancelled' in result ? result : querySummary(result);
  });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.query'], async (args, context) => {
    const result = await queryHost.query(args, context as OperationContext);
    if ('cancelled' in result) return result;
    return { ...querySummary(result), hasMore: result.hasMore, nextCursor: result.nextCursor, messages: result.messages.map(({ id, from, to, subject, date, receivedAt, accountId, accountName, folder, read, attachments }) => ({ id, from: from.slice(0, 160), to: to.slice(0, 160), subject: subject.slice(0, 200), date, receivedAt, accountId, accountName: accountName?.slice(0, 80), folder: folder?.slice(0, 120), ...(folder && folder.length > 120 ? { folderTruncated: true } : {}), read, attachmentCount: attachments.length })) };
  });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['drafts.list'], ({ limit }) => ({ drafts: [...getState().drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit ?? 20).map(({ id, accountId, to, cc, bcc, subject, updatedAt, deliveryStatus, attachments }) => ({ id, accountId, to, cc, bcc, subject, updatedAt, deliveryStatus: deliveryStatus ?? 'draft', attachments: attachments.map(({ name, size }, index) => ({ index, name, size })) })), activeDraftId: getState().activeDraftId }));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['drafts.create'], (args, context) => createWorkspaceDraft(args, context as OperationContext));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['drafts.get'], ({ draftId }) => { const draft = getState().drafts.find(item => item.id === activeDraftId(draftId))!; return { ...draft, body: draft.body.slice(0, 12000), bodyTruncated: draft.body.length > 12000, attachments: draft.attachments.map(({ name, size }, index) => ({ index, name, size })) }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['drafts.open'], ({ draftId }) => openDraft(draftId));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['drafts.update'], async ({ draftId, patch }) => { const id = activeDraftId(draftId); await dispatchAction({ type: 'update_draft', draftId: id, patch }); await saveState(getState()); return { draftId: id, updated: true }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['drafts.send'], ({ draftId }, context) => sendDraft(draftId ?? getState().activeDraftId, context));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.search'], async (args, context) => {
    const result = await searchWorkspaceMail(args, context as OperationContext);
    return { matches: result.messages.slice(0, 20).map(({ id, from, to, subject, date, accountId, accountName, folder, read, attachments }) => ({ id, from: from.slice(0, 240), to: to.slice(0, 240), subject: subject.slice(0, 240), date, accountId, accountName: accountName?.slice(0, 80), folder: folder?.slice(0, 120), read, attachmentCount: attachments.length, attachments: attachments.slice(0, 3).map(({ name, size }) => ({ name: name.slice(0, 80), size })) })), scope: result.scope, total: result.total, hasMore: result.hasMore || result.messages.length > 20, foldersSearched: result.foldersSearched, foldersRemaining: result.foldersRemaining, warnings: result.warnings, displayedResults: result.messages.length, searchViewRequested: true };
  });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.accounts'], () => { ensureMailAccountsAvailable(); return getMailAccounts(); });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.list_folders'], ({ accountId }, context) => { requireMailboxAccess(context); return loadMailFolders(accountId); });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.list_messages'], (args, context) => listWorkspaceMail(args, context as OperationContext));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.open_folder'], async ({ accountId, folder, refresh }, context) => { requireMailboxAccess(context); const snapshot = accountSnapshot(accountId); const folders = await loadMailFolders(accountId); if (!folders.some(item => item.path === folder && item.selectable)) throw new Error('Mailordner nicht gefunden.'); await dispatchAction({ type: 'open_window', kind: 'mail' }); assertCurrent(snapshot); panels.get('mail')?.webContents.send('mail:show-real', { accountId, folder, refresh }); return { accountId, folder, openRequested: true }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.filter'], async args => { await dispatchAction({ type: 'open_window', kind: 'mail' }); if (activeMailView) panels.get('mail')?.webContents.send('mail:show-real', { accountId: activeMailView.accountId, folder: activeMailView.folder }); panels.get('mail')?.webContents.send('mail:filter', args); return { viewUpdateRequested: true, ...args }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.read'], async ({ emailId }, rawContext) => { const context = rawContext as OperationContext; const id = authorizedMailId(emailId, context); return { untrusted: true, email: await snapshotEmailReference(id, context.sessionId ?? getState().activeSessionId, context.signal) }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.open'], ({ emailId }, context) => openRealMail(authorizedMailId(emailId, context as OperationContext)));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.set_read'], async ({ emailId, read }, context) => { const id = authorizedMailId(emailId, context as OperationContext); await changeMailRead(id, read, context); return { emailId: id, read }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['mail.download_attachment'], ({ emailId, index }, context) => saveMailAttachment(authorizedMailId(emailId, context as OperationContext), index, context));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['files.attach'], async ({ draftId, path: requested }) => {
    const resolved = await fs.realpath(requested); const root = await fs.realpath(app.getPath('documents')); const relative = path.relative(root, resolved);
    if ((relative.startsWith('..') || path.isAbsolute(relative)) && !selectedLocalFiles.has(resolved)) throw new Error('Diese Datei bitte zuerst über files.choose ausdrücklich auswählen.');
    const stat = await fs.stat(resolved); if (!stat.isFile()) throw new Error('Bitte eine Datei auswählen.');
    const id = activeDraftId(draftId); await dispatchAction({ type: 'attach_file', draftId: id, file: { path: resolved, name: path.basename(resolved), size: stat.size } }); return { draftId: id, attached: path.basename(resolved), size: stat.size };
  });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['files.remove_attachment'], async ({ draftId, index }) => { const id = activeDraftId(draftId); await dispatchAction({ type: 'remove_attachment', draftId: id, index }); return { draftId: id, removed: index }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['accounts.test'], async ({ accountId }) => { const snapshot = accountSnapshot(accountId); await testImapConnection(snapshot.account); assertCurrent(snapshot); return { connected: true }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['accounts.save'], ({ accountId, ...values }) => { if (accountId) mailAccount(accountId); return prepareSettings('account', values, accountId); });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['accounts.remove'], ({ accountId }, context) => deleteMailAccount(accountId, context));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['smtp.list'], (_args, context) => readSmtpSettings(context));
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['smtp.test'], async ({ accountId }) => { const saved = getSmtpSettings(accountId); if (!saved) throw new Error('SMTP bitte zuerst im Einstellungsformular einrichten.'); await withSmtpOperation(saved, effective => testSmtpConnection(effective)); return { connected: true, sent: false }; });
  workspaceCapabilities.registerDefinition(mailCapabilityDefinitions['smtp.save'], ({ accountId, ...values }) => { mailAccount(accountId); return prepareSettings('smtp', values, accountId); });
}
function registerIpc(): void {
  ipcMain.on('mail:view-context', (event, input: unknown) => {
    const win = panels.get('mail');
    if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) return;
    if (input === null) { activeMailView = null; return; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return;
    const value = input as Record<string, unknown>;
    if (typeof value.accountId !== 'string' || typeof value.folder !== 'string' || !getMailAccounts().some(account => account.id === value.accountId)) return;
    if (!knownMailFolders.get(value.accountId)?.has(value.folder)) return;
    const entry = typeof value.messageId === 'string' ? liveMail.get(value.messageId) : undefined;
    activeMailView = { accountId: value.accountId, folder: value.folder, ...(entry && entry.accountId === value.accountId && entry.folder === value.folder ? { messageId: entry.message.id } : {}) };
  });

  ipcMain.on('mail:settings:status', (event, status: unknown) => {
    const settings = panels.get('settings');
    if (!settings || settings.isDestroyed() || event.sender !== settings.webContents || event.senderFrame !== event.sender.mainFrame) return;
    if (status === 'clean' || status === 'dirty' || status === 'busy') mailSettingsStatus = status;
  });
  ipcMain.handle('smtp:settings:list', (event) => { verifyPanel(event, ['settings', 'draft']); return readSmtpSettings(uiOperationContext(event)); });
  ipcMain.handle('smtp:settings:test', (event, input: unknown) => { verifyPanel(event, ['settings']); return checkSmtpSettings(input, uiOperationContext(event)); });
  ipcMain.handle('smtp:settings:save', (event, input: unknown) => { verifyPanel(event, ['settings']); return saveSmtpSettings(input, uiOperationContext(event)); });
  ipcMain.handle('smtp:draft:send', (event, draftId: unknown) => { verifyPanel(event, ['draft']); return sendDraft(draftId, uiOperationContext(event)); });
  ipcMain.handle('mail:accounts:list', event => { verifyPanel(event, ['settings', 'mail', 'draft']); ensureMailAccountsAvailable(); return getMailAccounts(); });
  ipcMain.handle('mail:accounts:test', (event, input: unknown) => { verifyPanel(event, ['settings']); return checkMailAccount(input, uiOperationContext(event)); });
  ipcMain.handle('mail:accounts:save', (event, input: unknown) => { verifyPanel(event, ['settings']); return saveMailAccount(input, uiOperationContext(event)); });
  ipcMain.handle('mail:accounts:remove', (event, accountId: unknown) => { verifyPanel(event, ['settings']); return deleteMailAccount(accountId, uiOperationContext(event)); });
  ipcMain.handle('mail:search', (event, request: import('../../../shared/mail').MailSearchRequest) => { verifyPanel(event, ['mail']); return searchWorkspaceMail(request, uiOperationContext(event)); });
  ipcMain.handle('mail:query', async (event, request: unknown) => { verifyPanel(event, ['mail']); const result = await queryHost.query(request, uiOperationContext(event)); if ('cancelled' in result) throw new Error(result.message); return result; });
  ipcMain.handle('mail:count', async (event, request: unknown) => { verifyPanel(event, ['mail']); const result = await queryHost.count(request, uiOperationContext(event)); if ('cancelled' in result) throw new Error(result.message); return result; });
  ipcMain.handle('mail:folders:list', (event, accountId: unknown) => { verifyPanel(event, ['mail']); return loadMailFolders(accountId); });
  ipcMain.handle('mail:messages:list', (event, accountId: unknown, folder: unknown, cursor: unknown) => { verifyPanel(event, ['mail']); return loadMailMessages(accountId, folder, cursor, uiOperationContext(event)); });
  ipcMain.handle('mail:message:cached', (event, accountId: unknown, folder: unknown, messageId: unknown) => {
    verifyPanel(event, ['mail']);
    const entry = cachedMail(messageId);
    if (entry.accountId !== accountId || entry.folder !== folder) throw new Error('Die Nachricht gehört zu einem anderen Mailordner.');
    return entry.message;
  });
  ipcMain.handle('mail:message:body', (event, messageId: unknown) => { verifyPanel(event, ['mail']); return loadMailMessage(messageId, uiOperationContext(event)); });
  ipcMain.handle('mail:draft:create', async (event, accountId: unknown, messageId: unknown) => {
    verifyPanel(event, ['mail']);
    const result = await createWorkspaceDraft({ ...(typeof accountId === 'string' ? { accountId } : {}), ...(typeof messageId === 'string' ? { sourceEmailId: messageId, mode: 'reply' as const } : {}) }, uiOperationContext(event));
    if (!result.opened) throw new Error('Der Entwurf wurde erstellt, aber das Fenster konnte nicht geöffnet werden.');
  });
  ipcMain.handle('mail:attachment:download', (event, messageId: unknown, index: unknown) => { verifyPanel(event, ['mail']); return saveMailAttachment(messageId, index, uiOperationContext(event)); });
  ipcMain.handle('mail:message:set-read', (event, messageId: unknown, read: unknown) => { verifyPanel(event, ['mail']); return changeMailRead(messageId, read, uiOperationContext(event)); });
  ipcMain.handle('mail:open-settings', async event => {
    verifyPanel(event, ['mail']);
    await dispatchAction({ type: 'open_window', kind: 'settings' });
    panels.get('settings')?.webContents.send('settings:show-mail');
  });
  ipcMain.handle('workspace:folder', (event, folder: Folder) => { verifySender(event); if (!['Inbox', 'Sent', 'Drafts', 'Archive'].includes(folder)) throw new Error('Invalid folder'); commit({ ...getState(), folder }); });
  ipcMain.handle('workspace:active-draft', (event, id: string) => { verifySender(event); return openDraft(id).then(() => {}); });
}
function validateAction(action: UiAction): void {
  if (action.type === 'update_draft' || action.type === 'attach_file' || action.type === 'remove_attachment') {
    const draft = getState().drafts.find(item => item.id === action.draftId);
    if (draft && draft.deliveryStatus && draft.deliveryStatus !== 'draft') throw new Error('Dieser Entwurf kann nach Beginn des Versands nicht mehr verändert werden.');
  }
  if (action.type === 'update_draft' && action.patch.accountId && !getMailAccounts().some(account => account.id === action.patch.accountId)) throw new Error('Das ausgewählte Mailkonto wurde nicht gefunden.');
}
function getContext(context: OperationContext) {
  const ids = new Set([...(context.referenceIds ?? []), ...(activeMailView?.messageId ? [activeMailView.messageId] : [])]);
  return { activeDraftId: getState().activeDraftId, mailView: activeMailView, referencedEmails: [...ids].slice(-20).map(id => { try { return emailReferenceSummary(id); } catch { return { id, unavailable: true }; } }), loadedMailCount: liveMail.size, draftCount: getState().drafts.length, mailToolAccess: realMailAllowed() };
}
return {
  initialize, registerCapabilities, registerIpc, validateAction, getContext,
  createDraft: createWorkspaceDraft, openDraft,
  getAccount: mailAccount, listAccounts: getMailAccounts,
  getLiveMail: (id: string) => liveMail.get(id),
  externalMail, snapshotLiveReference,
  getActiveView: () => activeMailView,
  getRecentSearchIds: (sessionId: string) => recentMailSearches.get(sessionId) ?? [],
  getSettingsStatus: () => mailSettingsStatus,
  getSendingCount: () => sendingDrafts.size,
  onPanelClosed(kind: WindowKind) { if (kind === 'mail') activeMailView = null; if (kind === 'settings') mailSettingsStatus = 'clean'; },
  agentMails(referenceIds: ReadonlySet<string>): Mail[] {
    const mails = new Map<string, Mail>();
    if (realMailAllowed()) for (const [id, entry] of liveMail) mails.set(id, externalMail(entry));
    const ids = [...referenceIds, ...(activeMailView?.messageId ? [activeMailView.messageId] : [])];
    for (const id of ids) { const entry = liveMail.get(id); const saved = savedEmailReference(id); if (entry) mails.set(id, externalMail(entry)); else if (saved) mails.set(id, { ...saved, folder: 'Inbox', threadId: saved.id, read: true, bodyLoaded: true, externalFolder: '__reference__' }); }
    return [...mails.values()];
  },
  openMail: openRealMail,
  authorizedMailId
};
}
export type MailModule = ReturnType<typeof createMailModule>;

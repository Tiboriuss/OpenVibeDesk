import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { ModuleOperationAdapter } from '../../../electron/module-host';
import type { CapabilityContext } from '../../../electron/workspace-capabilities';
import type { Draft, EmailReference, MailViewContext, WorkspaceState } from '../../../shared/model';
import type { DraftSaveState } from '../../../shared/drafts';
import type { ImapMessage, MailSendResult, SentCopyResult, SentCopyState } from '../../../shared/mail';
import type { OperationBinding } from '../../../shared/operations';
import type { MailAccountConfig } from './mail-service';
import type { SmtpSettings } from './smtp-service';

interface Dependencies {
  state(): WorkspaceState;
  accounts(): MailAccountConfig[];
  account(id: unknown): MailAccountConfig;
  smtp(accountId: string): SmtpSettings | undefined;
  activeDraftId(id?: string): string;
  authorizedMailId(id: string | undefined, context: CapabilityContext): string;
  reference(id: string, context: CapabilityContext): EmailReference;
  live(id: string): { accountId: string; folder: string; message: ImapMessage } | undefined;
  activeView(): MailViewContext | null;
  saveStatus(id: string): DraftSaveState;
  existingSendResult(draft: Draft): MailSendResult | undefined;
  filingResult(draftId: string, state: SentCopyState, persisted?: boolean): SentCopyResult;
}

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Explicitly audited business reads: ImapFlow's BODY.PEEK/download path does not
// set \Seen. Search/query may present their results in Mail, but never mutate
// mailbox content or submit mail. This is not a claim that all UI effects vanish.
const reads = new Set(['drafts.list', 'drafts.get', 'drafts.save_status', 'drafts.sent_status', 'mail.accounts', 'mail.list_folders', 'mail.list_messages', 'mail.read', 'mail.previews', 'mail.display_status', 'mail.count', 'mail.search', 'mail.query', 'accounts.test', 'accounts.preferences_get', 'smtp.list', 'smtp.test']);
const draftTargets = new Set(['drafts.get', 'drafts.open', 'drafts.update', 'drafts.save', 'drafts.save_status', 'drafts.file_sent', 'drafts.sent_status', 'drafts.send', 'files.attach', 'files.remove_attachment']);
const mailTargets = new Set(['mail.read', 'mail.set_display', 'mail.display_status', 'mail.open', 'mail.set_read', 'mail.download_attachment']);

/** Freezes mutable selections before hashing. Status hooks never call SMTP or APPEND. */
export function createMailOperationAdapter(deps: Dependencies): ModuleOperationAdapter {
  function publicAccountIdentity(account: MailAccountConfig) {
    const smtp = deps.smtp(account.id);
    // Passwords/keys are never read. Only hashes of ordinary configuration enter bindings.
    return { id: account.id, email: account.email.toLowerCase(), host: account.host.toLowerCase(), port: account.port, security: account.security, username: account.username,
      smtp: smtp ? { host: smtp.host.toLowerCase(), port: smtp.port, security: smtp.security, username: smtp.useImapCredentials ? account.username : smtp.username, useImapCredentials: smtp.useImapCredentials } : null };
  }
  function accountVersion(account: MailAccountConfig) {
    return digest({ identity: publicAccountIdentity(account), name: account.name, senderName: account.senderName ?? '', signature: account.signature ?? '', pollIntervalSeconds: account.pollIntervalSeconds });
  }
  function mailResource(id: string, context: CapabilityContext, liveRequired = false): NonNullable<OperationBinding['resource']> {
    const entry = deps.live(id);
    if (!entry) {
      if (liveRequired) throw new Error('Die Mail ist nicht mehr geladen. Bitte vor der Aktion erneut im Mailfenster auswählen.');
      return { id: `mail-snapshot:${id}`, version: digest(deps.reference(id, context)) };
    }
    const account = deps.account(entry.accountId);
    const locator = { accountId: account.id, connection: publicAccountIdentity(account), folder: entry.folder, uidValidity: entry.message.uidValidity, uid: entry.message.uid };
    return { id: `mail:${id}:${digest(locator)}`, version: digest({ locator, read: entry.message.read, display: entry.message.display ?? null }) };
  }
  async function fileVersion(filePath: string) {
    try { const stat = await fs.stat(filePath); return { path: filePath, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, file: stat.isFile() }; }
    catch { return { path: filePath, unavailable: true }; }
  }
  const adapter: ModuleOperationAdapter = {
    async prepare(action, raw, context) {
      context.signal.throwIfAborted();
      const args = structuredClone(raw);
      const effect = reads.has(action) ? 'read' as const : 'write' as const;
      if (draftTargets.has(action)) {
        const id = deps.activeDraftId(typeof args.draftId === 'string' ? args.draftId : undefined);
        args.draftId = id;
        const draft = deps.state().drafts.find(item => item.id === id)!;
        const account = draft.accountId ? deps.accounts().find(item => item.id === draft.accountId) : undefined;
        const targetAccount = action === 'drafts.update' && args.patch && typeof args.patch === 'object' && typeof (args.patch as Record<string, unknown>).accountId === 'string'
          ? deps.account((args.patch as Record<string, unknown>).accountId) : undefined;
        let file;
        if (action === 'files.attach' && typeof args.path === 'string') { args.path = await fs.realpath(args.path); file = await fileVersion(args.path as string); }
        const attachments = action === 'drafts.send' ? await Promise.all(draft.attachments.map(item => fileVersion(item.path))) : undefined;
        const identity = account ? digest(publicAccountIdentity(account)) : draft.accountId ? `missing-${digest(draft.accountId)}` : 'no-account';
        // Send's generated Message-ID does not exist before SMTP preparation. Filing
        // already has one and remains bound to that exact immutable outgoing copy.
        const copy = action === 'drafts.file_sent' ? `:${digest(draft.sentCopy?.messageId ?? null)}` : '';
        if (action === 'drafts.file_sent' && args.folder === undefined && draft.sentCopy?.folder) args.folder = draft.sentCopy.folder;
        // Delivery attempts update status/error/timestamps themselves. Those are
        // outcome guards, not a change to the immutable business content that an
        // authoritative not_applied result may later permit retrying.
        const sendContent = { id: draft.id, accountId: draft.accountId, to: draft.to, cc: draft.cc ?? '', bcc: draft.bcc ?? '', subject: draft.subject, body: draft.body, inReplyTo: draft.inReplyTo, references: draft.references ?? [], attachments: draft.attachments };
        const version = action === 'drafts.send'
          ? { content: sendContent, account: account ? accountVersion(account) : null, attachments }
          : action === 'drafts.file_sent'
            ? { messageId: draft.sentCopy?.messageId, folder: args.folder ?? null, account: account ? accountVersion(account) : null }
            : { draft, account: account ? accountVersion(account) : null, targetAccount: targetAccount ? accountVersion(targetAccount) : null, file };
        return { args, effect, resource: { id: `draft:${id}:${identity}${copy}`, version: digest(version) } };
      }
      if (mailTargets.has(action)) {
        const id = deps.authorizedMailId(typeof args.emailId === 'string' ? args.emailId : undefined, context);
        args.emailId = id;
        return { args, effect, resource: mailResource(id, context, action !== 'mail.read') };
      }
      if (action === 'mail.previews') {
        const ids = [...new Set((args.emailIds as string[]).map(id => deps.authorizedMailId(id, context)))];
        args.emailIds = ids;
        const resources = ids.map(id => mailResource(id, context, true));
        return { args, effect, resource: { id: `mail-previews:${digest(resources.map(item => item.id))}`, version: digest(resources) } };
      }
      if (action === 'drafts.create') {
        const usesSource = !!args.sourceEmailId || !!args.recipientFromSource || args.mode === 'reply';
        const sourceId = usesSource ? deps.authorizedMailId(typeof args.sourceEmailId === 'string' ? args.sourceEmailId : undefined, context) : undefined;
        if (sourceId) args.sourceEmailId = sourceId;
        const source = sourceId ? deps.reference(sourceId, context) : undefined;
        const accounts = deps.accounts();
        const accountId = typeof args.accountId === 'string' ? args.accountId : source?.accountId ?? deps.activeView()?.accountId ?? (accounts.length === 1 ? accounts[0].id : undefined);
        const account = accountId ? deps.account(accountId) : undefined;
        if (account) args.accountId = account.id;
        return { args, effect, resource: { id: `draft-create:${digest([sourceId ?? null, account ? publicAccountIdentity(account) : null])}`, version: digest({ source, account: account ? accountVersion(account) : null }) } };
      }
      if (action === 'mail.filter') {
        const view = deps.activeView();
        return { args, effect, resource: { id: `mail-view:${digest(view ? [view.accountId, view.folder] : null)}`, version: digest(view ? accountVersion(deps.account(view.accountId)) : null) } };
      }
      if (['mail.list_messages', 'mail.query', 'mail.count'].includes(action) && args.allAccounts !== true && typeof args.accountId !== 'string') {
        const chosen = deps.activeView()?.accountId ?? deps.accounts()[0]?.id;
        if (chosen) args.accountId = chosen;
      }
      if (action === 'mail.search' && typeof args.accountId !== 'string' && deps.activeView()?.accountId) args.accountId = deps.activeView()!.accountId;
      const accounts = typeof args.accountId === 'string' ? [deps.account(args.accountId)] : deps.accounts();
      return { args, effect, resource: { id: `mail-scope:${digest(accounts.map(account => publicAccountIdentity(account)))}`, version: digest(accounts.map(account => accountVersion(account))) } };
    },
    async reconcile(action, args, _operation, context, originalBinding) {
      context.signal.throwIfAborted();
      const prepared = await adapter.prepare(action, args, context);
      if (prepared.resource?.id !== originalBinding.resource?.id) return { state: 'unknown', detail: 'Die frühere Mailaktion gehört nicht mehr zu derselben Ressource oder Kontoverbindung.' };
      if (action === 'drafts.send' || action === 'drafts.file_sent') {
        const draft = deps.state().drafts.find(item => item.id === args.draftId);
        if (!draft) return { state: 'unknown', detail: 'Der ursprüngliche Entwurf ist nicht mehr verfügbar. Es wurde kein Versand oder Ablageversuch gestartet.' };
        if (action === 'drafts.send') {
          const known = deps.existingSendResult(draft);
          if (known?.status === 'sent') return { state: 'completed', result: known, detail: 'Die lokale Versandaufzeichnung bestätigt SMTP-Annahme. Es wurde keine Nachricht erneut gesendet.' };
          if (known) return { state: 'unknown', detail: known.message ?? 'Der SMTP-Ausgang ist unklar. Die Nachricht wird nicht erneut gesendet.' };
          if ((draft.deliveryStatus ?? 'draft') === 'draft' && draft.deliveryError && deps.saveStatus(draft.id).status === 'saved') return { state: 'not_applied', detail: 'Die gespeicherte Versandaufzeichnung bestätigt einen vor der Annahme abgelehnten oder nicht vorbereiteten Versand. Ein neuer Versuch bleibt eine gesondert geprüfte Aktion.' };
          return { state: 'unknown', detail: 'Es liegt keine eindeutige gespeicherte SMTP-Annahme oder Ablehnung dieses Vorgangs vor. Es wird nicht erneut gesendet.' };
        }
        const copy = draft.sentCopy;
        if (draft.deliveryStatus !== 'sent' || !copy) return { state: 'unknown', detail: 'Eine bestätigte Annahme mit zugehöriger lokaler Versandkopie fehlt. Es wurde kein SMTP- oder APPEND-Aufruf gestartet.' };
        if (copy.status === 'filed') return { state: 'completed', result: deps.filingResult(draft.id, copy, deps.saveStatus(draft.id).status === 'saved'), detail: 'Die lokale Aufzeichnung bestätigt die Gesendet-Ablage. Die Statusprüfung hat nichts angehängt und nichts gesendet.' };
        if (!copy.appendAttempted && (copy.status === 'failed' || copy.status === 'pending') && deps.saveStatus(draft.id).status === 'saved') return { state: 'not_applied', detail: 'Die gespeicherte Ablageaufzeichnung enthält keinen APPEND-Versuch. Eine ausdrücklich angeforderte Ablage nutzt weiterhin ihre eigenen Schutzregeln.' };
        return { state: 'unknown', detail: 'Die Gesendet-Ablage ist nicht bestätigt. Diese Statusprüfung führt weder SMTP noch APPEND aus; bei einem früheren APPEND-Versuch bleibt nur der separate Message-ID-Abgleich der Ablagefunktion.' };
      }
      if (reads.has(action)) return { state: 'not_applied', detail: 'Diese geprüfte Lesefunktion verändert keine fachlichen Daten. Ein neuer Abruf muss aktuelle Zugriffsrechte und Ressourcenbindung erneut prüfen.' };
      return { state: 'unknown', detail: 'Für diese Mailaktion gibt es keinen verlässlichen Statusabgleich. Die ursprüngliche Aktion wurde nicht wiederholt.' };
    }
  };
  return adapter;
}

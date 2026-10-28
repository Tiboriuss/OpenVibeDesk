import type { ListResponse, ImapFlow } from 'imapflow';
import { withImap, MailOperationError, type MailAccountConfig } from './mail-service';

export interface SentFilingResult {
  status: 'filed' | 'failed' | 'uncertain';
  folder?: string;
  message?: string;
  error?: string;
  alreadyPresent?: boolean;
  appendAttempted?: boolean;
  uid?: number;
  uidValidity?: string;
}

export interface SentFilingInput {
  messageId: string;
  /** Immutable sender copy, prepared before SMTP submission. Never re-read draft attachments. */
  raw: Buffer;
  /** A previously persisted or explicitly selected target; never switch it after an attempt. */
  folder?: string;
  /** A prior APPEND might have reached the server. Such retries reconcile only. */
  appendAttempted?: boolean;
  /** Must durably record the target and attempted marker before APPEND can start. */
  beforeAppend(folder: string): Promise<void>;
}

const MAX_MESSAGE_BYTES = 40 * 1024 * 1024;
const MAX_FOLDERS = 1000;
const MAX_SEARCH_CANDIDATES = 100;
const validPath = (value: string) => value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
const sentNames = new Set(['sent', 'sent items', 'sent messages', 'gesendet', 'gesendete elemente']);
const hasFlag = (folder: ListResponse, flag: string) => [...folder.flags].some(value => value.toLowerCase() === flag.toLowerCase());

function chooseSentFolder(folders: ListResponse[], requested?: string): string {
  if (folders.length > MAX_FOLDERS) throw new MailOperationError('Zu viele Mailordner für eine eindeutige Gesendet-Zuordnung. Bitte einen Gesendet-Ordner ausdrücklich auswählen.');
  const selectable = folders.filter(folder => validPath(folder.path) && !hasFlag(folder, '\\Noselect'));
  if (requested !== undefined) {
    if (!validPath(requested) || !selectable.some(folder => folder.path === requested)) throw new MailOperationError('Der ausgewählte Gesendet-Ordner ist nicht mehr verfügbar oder nicht auswählbar. Bitte die Ordnerzuordnung prüfen.');
    return requested;
  }
  const special = selectable.filter(folder => folder.specialUse?.toLowerCase() === '\\sent' || hasFlag(folder, '\\Sent'));
  if (special.length === 1) return special[0].path;
  if (special.length > 1) throw new MailOperationError('Mehrere Gesendet-Ordner wurden gemeldet. Bitte den gewünschten Zielordner ausdrücklich auswählen.');
  const named = selectable.filter(folder => {
    const leaf = folder.delimiter ? folder.path.split(folder.delimiter).at(-1) : folder.path;
    return sentNames.has((leaf ?? '').normalize('NFKC').toLowerCase());
  });
  if (named.length === 1) return named[0].path;
  throw new MailOperationError(named.length ? 'Mehrere mögliche Gesendet-Ordner wurden gefunden. Bitte den Zielordner ausdrücklich auswählen.' : 'Kein eindeutiger Gesendet-Ordner wurde gefunden. Bitte einen vorhandenen Zielordner ausdrücklich auswählen.');
}

function validateInput(input: SentFilingInput): void {
  if (!/^<[^<>\s]+@[^<>\s]+>$/.test(input.messageId) || input.messageId.length > 500) throw new MailOperationError('Die gespeicherte Nachrichtenkennung für die Gesendet-Ablage ist ungültig.');
  if (!Buffer.isBuffer(input.raw) || !input.raw.length || input.raw.length > MAX_MESSAGE_BYTES) throw new MailOperationError('Die gespeicherte Nachrichtenkopie fehlt oder überschreitet die zulässige Größe.');
  const separator = input.raw.indexOf('\r\n\r\n');
  if (separator < 0 || separator > 64 * 1024) throw new MailOperationError('Die gespeicherte Nachrichtenkopie enthält keinen gültigen Kopfbereich.');
  const headers = input.raw.subarray(0, separator).toString('utf8').replace(/\r\n[ \t]+/g, ' ');
  const ids = [...headers.matchAll(/^Message-ID:[ \t]*(.+)$/gim)].map(match => match[1].trim());
  if (ids.length !== 1 || ids[0] !== input.messageId) throw new MailOperationError('Die gespeicherte Nachrichtenkopie passt nicht zur Nachrichtenkennung.');
}

async function findExactMessage(client: ImapFlow, messageId: string): Promise<{ uid: number; uidValidity?: string } | undefined> {
  const candidates = await client.search({ header: { 'Message-ID': messageId } }, { uid: true });
  if (!Array.isArray(candidates)) throw new MailOperationError('Der Gesendet-Ordner konnte nicht zuverlässig abgeglichen werden. Es wurde keine weitere Kopie angelegt.');
  if (candidates.length > MAX_SEARCH_CANDIDATES) throw new MailOperationError('Zu viele Treffer für die Nachrichtenkennung. Die Gesendet-Ablage wurde zur Vermeidung doppelter Kopien angehalten.');
  if (!candidates.length) return;
  // IMAP HEADER searches are substring matches. Fetch only envelopes and verify
  // the complete ID, without loading bodies or changing read state.
  const messages = await client.fetchAll(candidates, { envelope: true }, { uid: true });
  const match = messages.find(item => item.envelope?.messageId?.trim() === messageId);
  if (match) return { uid: match.uid, ...(client.mailbox && client.mailbox.uidValidity ? { uidValidity: String(client.mailbox.uidValidity) } : {}) };
  const observed = new Set(messages.map(item => item.uid));
  if (candidates.some(uid => !observed.has(uid))) throw new MailOperationError('Der Gesendet-Abgleich war unvollständig. Bitte erneut abgleichen; es wurde keine zusätzliche Kopie angelegt.');
}

function definitelyRejected(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { responseStatus?: string; serverResponseCode?: string };
  return failure.responseStatus === 'NO' || failure.responseStatus === 'BAD' || failure.serverResponseCode === 'APPENDLIMIT';
}

/** File or reconcile a known SMTP-accepted message. This function never sends SMTP. */
export async function fileSentMessage(account: MailAccountConfig, input: SentFilingInput, signal?: AbortSignal): Promise<SentFilingResult> {
  let folder = input.folder;
  let attempted = input.appendAttempted === true;
  let confirmed: SentFilingResult | undefined;
  try {
    validateInput(input);
    return await withImap(account, undefined, async client => {
      folder = chooseSentFolder(await client.list(), input.folder);
      const lock = await client.getMailboxLock(folder);
      try {
        signal?.throwIfAborted();
        const existing = await findExactMessage(client, input.messageId);
        if (existing) {
          confirmed = { status: 'filed', folder, alreadyPresent: true, appendAttempted: attempted, ...existing,
            message: 'Die Nachricht ist bereits im Gesendet-Ordner vorhanden. Es wurde keine weitere Kopie angelegt.' };
          return confirmed;
        }
        if (attempted) return { status: 'uncertain', folder, appendAttempted: true,
          message: 'Der frühere Ablageversuch konnte noch nicht bestätigt werden. Es wird nur abgeglichen und keine weitere Kopie angelegt. Bitte später erneut prüfen.' };
        await input.beforeAppend(folder);
        signal?.throwIfAborted();
        attempted = true;
        try {
          const result = await client.append(folder, input.raw, ['\\Seen']);
          if (!result) return { status: 'uncertain', folder, appendAttempted: true,
            message: 'Die Ablage konnte nicht bestätigt werden. Bitte erneut abgleichen; es wird keine zweite Kopie angelegt.' };
          confirmed = { status: 'filed', folder, appendAttempted: true,
            ...(result.uid ? { uid: result.uid } : {}), ...(result.uidValidity ? { uidValidity: String(result.uidValidity) } : {}),
            message: 'Die Nachricht wurde im Gesendet-Ordner abgelegt.' };
          return confirmed;
        } catch (error) {
          if (definitelyRejected(error)) {
            attempted = false;
            return { status: 'failed', folder, appendAttempted: false,
              error: 'Der IMAP-Server hat die Ablage abgelehnt. Bitte Berechtigung, Speicherplatz und Nachrichtengröße prüfen; anschließend kann nur die Ablage erneut versucht werden.' };
          }
          throw error;
        }
      } finally { lock.release(); }
    }, signal);
  } catch (error) {
    // Account invalidation or connection cleanup must never overturn an already
    // acknowledged APPEND or a confirmed exact match.
    if (confirmed) return confirmed;
    const detail = error instanceof MailOperationError ? error.message : 'Die Verbindung zum Gesendet-Ordner ist fehlgeschlagen. Bitte Postfach und Zugangsdaten prüfen.';
    return attempted
      ? { status: 'uncertain', ...(folder ? { folder } : {}), appendAttempted: true,
        message: 'Die Ablage ist unklar. Es wurde kein weiterer Versand gestartet. Beim nächsten Versuch wird nur nach der vorhandenen Kopie gesucht.', error: detail }
      : { status: 'failed', ...(folder ? { folder } : {}), appendAttempted: false, error: detail };
  }
}

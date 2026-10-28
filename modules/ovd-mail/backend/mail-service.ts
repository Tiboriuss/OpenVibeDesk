import { isIP } from 'node:net';
import { ImapFlow, type MessageAddressObject, type MessageStructureObject, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AsyncEntry } from '@napi-rs/keyring';
import { z } from 'zod';
import type { ImapPageCursor } from '../../../shared/mail';

/** Passwords are held in the system credential store, never in these account records. */
export type MailAccountConfig = {
  id: string; name: string; email: string; host: string; port: number;
  security: 'tls' | 'starttls'; username: string;
};
export type MailAccountInput = MailAccountConfig & { password?: string };
export type ImapFolder = { path: string; name: string; delimiter: string; specialUse?: string; selectable: boolean };
export type ImapMessage = {
  uid: number; uidValidity: string; from: string; to: string; subject: string; date: string; receivedAt?: string;
  bodyText: string; attachments: { name: string; size: number; part: string }[]; read: boolean;
  messageId?: string; inReplyTo?: string; references?: string[]; replyTo?: string; cc?: string;
  fromAddresses: string[]; replyToAddresses: string[]; toAddresses: string[]; ccAddresses: string[];
  bodyLoaded: boolean; truncated: boolean;
};

const validHost = (host: string) => {
  if (isIP(host)) return true;
  if (host.length > 253 || host.endsWith('.') || !/^[a-z0-9.-]+$/i.test(host)) return false;
  return host.split('.').every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
};
const noControls = (text: string) => !/[\u0000-\u001f\u007f]/.test(text);
const hasFlag = (flags: Set<string> | undefined, flag: string) => !!flags && [...flags].some(value => value.toLowerCase() === flag.toLowerCase());
const textField = (max: number) => z.string().trim().min(1).max(max).refine(noControls);
const accountSchema = z.object({
  id: z.uuid(), name: textField(120), email: textField(320).refine(value => value.includes('@')),
  host: textField(253).refine(validHost), port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls']), username: textField(320),
  password: z.string().min(1).max(4096).optional()
}).strict();
const configSchema = accountSchema.omit({ password: true });
const pathSchema = z.string().min(1).max(1024).refine(noControls);
const PASSWORD_SERVICE = 'OpenVibeDesk Mail IMAP';
const TEXT_BYTE_LIMIT = 128 * 1024;
const ATTACHMENT_LIMIT = 25 * 1024 * 1024;
const MESSAGE_LIMIT = 25;
const OPERATION_TIMEOUT = 45_000;
const accountGenerations = new Map<string, number>();
const pausedAccounts = new Set<string>();
const accountClients = new Map<string, Set<ImapFlow>>();

/** Endpoint and login identify the mailbox independently of editable display fields. */
export function imapConnectionIdentity(config: Pick<MailAccountConfig, 'host' | 'port' | 'security' | 'username'>): string {
  return JSON.stringify([config.host.toLowerCase(), config.port, config.security, config.username]);
}

/** Also invalidates calls still awaiting the credential store before connecting. */
export function invalidateMailAccountConnections(id: string, pause = false): void {
  accountGenerations.set(id, (accountGenerations.get(id) ?? 0) + 1);
  if (pause) pausedAccounts.add(id);
  for (const client of accountClients.get(id) ?? []) { try { client.close(); } catch { /* Already closed. */ } }
}
export function resumeMailAccountConnections(id: string): void { pausedAccounts.delete(id); }

export function validateMailAccount(input: unknown): MailAccountInput {
  const result = accountSchema.safeParse(input);
  if (!result.success) throw new Error('Bitte gültige Kontodaten, Serveradresse und Port eingeben.');
  return result.data;
}

function accountEntry(id: string): AsyncEntry {
  if (!z.uuid().safeParse(id).success) throw new Error('Ungültige Konto-ID.');
  return new AsyncEntry(PASSWORD_SERVICE, id, { linux: { store: 'secret-service' } });
}
export async function saveMailPassword(id: string, password: string): Promise<void> {
  if (typeof password !== 'string' || !password.length || password.length > 4096) throw new Error('Bitte ein gültiges Passwort eingeben.');
  try { await accountEntry(id).setPassword(password); } catch { throw new Error('Das Mail-Passwort konnte nicht sicher gespeichert werden.'); }
}
export async function deleteMailPassword(id: string): Promise<void> {
  try { await accountEntry(id).deletePassword(); } catch { throw new Error('Das Mail-Passwort konnte nicht gelöscht werden.'); }
}
export async function readMailPassword(id: string): Promise<string | null> {
  try { return await accountEntry(id).getPassword(); }
  catch { throw new Error('Der sichere Zugangsdaten-Speicher ist nicht verfügbar.'); }
}
async function storedPassword(id: string): Promise<string> {
  try {
    const password = await accountEntry(id).getPassword();
    if (password) return password;
  } catch { throw new Error('Der sichere Zugangsdaten-Speicher ist nicht verfügbar.'); }
  throw new Error('Für dieses Konto ist kein IMAP-Passwort gespeichert.');
}

export class MailOperationError extends Error {}
function friendlyMailError(error: unknown): Error {
  if (error instanceof MailOperationError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (['AuthenticationFailed', 'EAUTH'].includes(code)) return new Error('Die IMAP-Anmeldung ist fehlgeschlagen. Bitte Zugangsdaten prüfen.');
  if (['CERT_HAS_EXPIRED', 'CERT_UNTRUSTED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code)) return new Error('Das Zertifikat des IMAP-Servers ist ungültig oder passt nicht zum Servernamen.');
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ConnectionTimeout', 'GreetingTimeout', 'MailOperationTimeout'].includes(code)) return new Error('Die Verbindung zum IMAP-Server hat zu lange gedauert.');
  return new Error('Die IMAP-Verbindung ist fehlgeschlagen. Bitte Server, Verschlüsselung und Zugangsdaten prüfen.');
}

export async function withImap<T>(rawConfig: MailAccountConfig, suppliedPassword: string | undefined, work: (client: ImapFlow) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const parsed = configSchema.safeParse(rawConfig);
  if (!parsed.success) throw new Error('Bitte gültige Kontodaten, Serveradresse und Port eingeben.');
  const config = parsed.data;
  const generation = accountGenerations.get(config.id) ?? 0;
  const assertCurrent = () => {
    if (pausedAccounts.has(config.id) || generation !== (accountGenerations.get(config.id) ?? 0)) throw new MailOperationError('Die Kontoeinstellungen wurden geändert. Bitte das Postfach aktualisieren.');
  };
  assertCurrent();
  const password = suppliedPassword === undefined ? await storedPassword(config.id) : suppliedPassword;
  signal?.throwIfAborted();
  assertCurrent();
  if (typeof password !== 'string' || !password.length || password.length > 4096) throw new Error('Bitte ein gültiges Passwort eingeben.');
  const client = new ImapFlow({
    host: config.host, port: config.port, secure: config.security === 'tls',
    ...(config.security === 'starttls' ? { doSTARTTLS: true } : {}),
    auth: { user: config.username, pass: password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    logger: false, disableAutoIdle: true, connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 20_000
  });
  client.on('error', () => { /* Errors are surfaced without including server output or credentials. */ });
  const clients = accountClients.get(config.id) ?? new Set<ImapFlow>();
  accountClients.set(config.id, clients); clients.add(client);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { if (signal) { abort = () => { client.close(); reject(signal.reason ?? new DOMException('Abgebrochen', 'AbortError')); }; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); } });
  try {
    const result = await Promise.race([
      (async () => { signal?.throwIfAborted(); await client.connect(); signal?.throwIfAborted(); return work(client); })(),
      aborted,
      new Promise<never>((_, reject) => { timer = setTimeout(() => { client.close(); reject(Object.assign(new Error('Zeitüberschreitung'), { code: 'MailOperationTimeout' })); }, OPERATION_TIMEOUT); })
    ]);
    assertCurrent();
    return result;
  } catch (error) { signal?.throwIfAborted(); throw friendlyMailError(error); }
  finally { if (abort) signal?.removeEventListener('abort', abort); if (timer) clearTimeout(timer); clients.delete(client); if (!clients.size && accountClients.get(config.id) === clients) accountClients.delete(config.id); client.close(); }
}

export async function testImapConnection(config: MailAccountConfig, password?: string): Promise<void> {
  await withImap(config, password, async () => {});
}

export async function listImapFolders(config: MailAccountConfig): Promise<ImapFolder[]> {
  return withImap(config, undefined, async client => (await client.list()).filter(folder => pathSchema.safeParse(folder.path).success).slice(0, 1000).map(folder => ({
    path: folder.path, name: folder.name.slice(0, 256), delimiter: (folder.delimiter ?? '').slice(0, 10),
    ...(folder.specialUse ? { specialUse: folder.specialUse.slice(0, 80) } : {}), selectable: !hasFlag(folder.flags, '\\Noselect')
  })));
}

const partSchema = z.string().max(80).regex(/^\d+(?:\.\d+)*$/);
const uidSchema = z.number().int().positive().max(0xffffffff);
const uidValiditySchema = z.string().regex(/^\d{1,20}$/);
type Part = { part: string; type: string; disposition: string; name: string; size: number };

function messageParts(root: MessageStructureObject | undefined): Part[] {
  const result: Part[] = [];
  function visit(node: MessageStructureObject, depth: number) {
    if (depth > 20 || result.length >= 200) return;
    const disposition = (node.disposition ?? '').toLowerCase();
    const type = (node.type ?? '').toLowerCase();
    const name = node.dispositionParameters?.filename ?? node.parameters?.name ?? '';
    const part = node.part ?? (!node.childNodes?.length ? '1' : '');
    if (partSchema.safeParse(part).success && (disposition === 'attachment' || !!name || !node.childNodes?.length)) {
      result.push({ part, type, disposition, name: name.slice(0, 200), size: Math.max(0, Number(node.size) || 0) });
    }
    if (disposition !== 'attachment' && !name) for (const child of node.childNodes ?? []) visit(child, depth + 1);
  }
  if (root) visit(root, 0);
  return result;
}

function attachmentParts(root: MessageStructureObject | undefined): Part[] {
  return messageParts(root).filter(part => part.disposition === 'attachment' || (!!part.name && part.disposition !== 'inline'));
}
function addresses(value: MessageAddressObject[] | undefined): string[] {
  return (value ?? []).map(item => item.address?.trim() ?? '').filter(address => address && !/[\r\n]/.test(address)).slice(0, 100).map(address => address.slice(0, 320));
}
function displayAddresses(value: MessageAddressObject[] | undefined): string {
  return (value ?? []).slice(0, 100).map(item => {
    const name = (item.name ?? '').replace(/[\r\n]/g, ' ').trim();
    const address = (item.address ?? '').replace(/[\r\n]/g, '').trim();
    return name && address ? `${name} <${address}>` : name || address;
  }).filter(Boolean).join(', ').slice(0, 1000);
}
async function readPart(client: ImapFlow, uid: number, part: string, limit: number): Promise<{ content: Buffer; truncated: boolean; charset?: string }> {
  const download = await client.download(String(uid), part, { uid: true, maxBytes: limit * 4 + 1 });
  if (!download.content) throw new MailOperationError('Der Nachrichteninhalt ist nicht mehr verfügbar.');
  const chunks: Buffer[] = []; let size = 0, retained = 0;
  for await (const chunk of download.content) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (retained < limit) { const keep = bytes.subarray(0, limit - retained); chunks.push(keep); retained += keep.length; }
  }
  return { content: Buffer.concat(chunks), truncated: size > limit, charset: download.meta?.charset };
}

export async function mapImapMetadata(rows: readonly FetchMessageObject[], uidValidity: string): Promise<ImapMessage[]> {
  const result: ImapMessage[] = [];
  for (const row of rows) {
    if (!Number.isSafeInteger(row.uid) || row.uid <= 0) continue;
    const envelope = row.envelope;
    const date = envelope?.date ? new Date(envelope.date) : row.internalDate ? new Date(row.internalDate) : new Date(0);
    const safeDate = Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
    const received = row.internalDate ? new Date(row.internalDate) : undefined;
    const receivedAt = received && !Number.isNaN(received.getTime()) ? received.toISOString() : undefined;
    const header = row.headers?.subarray(0, 16_000);
    let references: string[] = [];
    if (header?.length) {
      const parsedHeader = await simpleParser(header, { skipImageLinks: true, skipTextToHtml: true });
      const rawReferences = parsedHeader.references;
      references = (Array.isArray(rawReferences) ? rawReferences : rawReferences ? [rawReferences] : []).filter(value => typeof value === 'string' && !/[\r\n]/.test(value)).slice(-50).map(value => value.slice(0, 500));
    }
    const replyTo = displayAddresses(envelope?.replyTo), cc = displayAddresses(envelope?.cc);
    result.push({
      uid: row.uid, uidValidity,
      from: displayAddresses(envelope?.from).slice(0, 500), to: displayAddresses(envelope?.to).slice(0, 500),
      subject: (envelope?.subject ?? '(Kein Betreff)').slice(0, 1000), date: safeDate,
      ...(receivedAt ? { receivedAt } : {}),
      bodyText: '', bodyLoaded: false,
      attachments: attachmentParts(row.bodyStructure).slice(0, 20).map(part => ({ name: part.name || 'Anhang', size: part.size, part: part.part })),
      read: hasFlag(row.flags, '\\Seen'),
      ...(envelope?.messageId ? { messageId: envelope.messageId.slice(0, 500) } : {}),
      ...(envelope?.inReplyTo ? { inReplyTo: envelope.inReplyTo.slice(0, 500) } : {}),
      ...(references.length ? { references } : {}), ...(replyTo ? { replyTo } : {}), ...(cc ? { cc } : {}),
      fromAddresses: addresses(envelope?.from), replyToAddresses: addresses(envelope?.replyTo),
      toAddresses: addresses(envelope?.to), ccAddresses: addresses(envelope?.cc), truncated: false
    });
  }
  return result;
}


/** Read message envelopes and MIME structures independently of attachment bytes. */
async function fetchImapPage(config: MailAccountConfig, rawPath: string, rawCursor?: unknown, rawLimit = MESSAGE_LIMIT, search?: { query: string }): Promise<{ messages: ImapMessage[]; uidValidity: string; nextCursor?: ImapPageCursor; total: number }> {
  const path = pathSchema.safeParse(rawPath);
  if (!path.success) throw new Error('Ungültiger Mail-Ordner.');
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) throw new Error('Bitte zwischen 1 und 50 Nachrichten pro Seite anfordern.');
  const cursorSchema = z.object({ beforeUid: uidSchema, uidValidity: uidValiditySchema }).strict();
  const cursor = rawCursor === undefined ? undefined : cursorSchema.safeParse(rawCursor);
  if (cursor && !cursor.success) throw new Error('Ungültige Position in der Nachrichtenliste.');
  const page = cursor?.data;
  return withImap(config, undefined, async client => {
    const mailbox = await client.mailboxOpen(path.data, { readOnly: true });
    const uidValidity = mailbox.uidValidity.toString();
    if (page && page.uidValidity !== uidValidity) throw new MailOperationError('Der Mailordner wurde geändert. Bitte aktualisieren.');
    if (!mailbox.exists || page?.beforeUid === 1) return { messages: [], uidValidity, total: 0 };
    const criteria = search ? { text: search.query, ...(page ? { uid: `1:${page.beforeUid - 1}` } : {}) } : page ? { uid: `1:${page.beforeUid - 1}` } : { all: true };
    const matches = await client.search(criteria, { uid: true });
    const uids = Array.isArray(matches) ? matches.filter(uid => uidSchema.safeParse(uid).success && (!page || uid < page.beforeUid)).sort((a, b) => b - a) : [];
    const pageLimit = rawLimit;
    const selected = uids.slice(0, pageLimit);
    if (!selected.length) return { messages: [], uidValidity, total: 0 };
    const rows = await client.fetchAll(selected, {
      uid: true, flags: true, internalDate: true, envelope: true, bodyStructure: true, headers: ['references']
    }, { uid: true });
    const result = await mapImapMetadata(rows.sort((a, b) => b.uid - a.uid), uidValidity);
    const nextCursor = uids.length > pageLimit ? { beforeUid: selected[selected.length - 1], uidValidity } : undefined;
    return { messages: result, uidValidity, total: uids.length, ...(nextCursor ? { nextCursor } : {}) };
  });
}

/** Newest server UIDs first; total counts matches remaining before the optional cursor. */
export async function fetchImapMessages(config: MailAccountConfig, rawPath: string, rawCursor?: unknown, rawLimit = MESSAGE_LIMIT): Promise<{ messages: ImapMessage[]; uidValidity: string; nextCursor?: ImapPageCursor; total: number; hasMore: boolean }> {
  const page = await fetchImapPage(config, rawPath, rawCursor, rawLimit);
  return { ...page, hasMore: !!page.nextCursor };
}
/** Search the server's full message text without downloading unrelated message bodies. */
export async function searchImapMessages(config: MailAccountConfig, rawPath: string, rawQuery: unknown, rawLimit = 50): Promise<{ messages: ImapMessage[]; uidValidity: string; total: number; hasMore: boolean }> {
  const query = textField(200).safeParse(rawQuery);
  if (!query.success || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) throw new Error('Bitte einen Suchbegriff mit höchstens 200 Zeichen eingeben.');
  const page = await fetchImapPage(config, rawPath, undefined, rawLimit, { query: query.data });
  return { messages: page.messages, uidValidity: page.uidValidity, total: page.total, hasMore: !!page.nextCursor };
}

function validateMessageIdentity(rawPath: string, rawValidity: string, rawUid: number): { path: string; validity: string; uid: number } {
  const path = pathSchema.safeParse(rawPath), validity = uidValiditySchema.safeParse(rawValidity), uid = uidSchema.safeParse(rawUid);
  if (!path.success || !validity.success || !uid.success) throw new MailOperationError('Ungültige Nachrichtenkennung.');
  return { path: path.data, validity: validity.data, uid: uid.data };
}

export async function fetchImapMessageBody(config: MailAccountConfig, rawPath: string, rawValidity: string, rawUid: number): Promise<{ bodyText: string; bodyLoaded: true; truncated: boolean }> {
  const identity = validateMessageIdentity(rawPath, rawValidity, rawUid);
  return withImap(config, undefined, async client => {
    const mailbox = await client.mailboxOpen(identity.path, { readOnly: true });
    if (mailbox.uidValidity.toString() !== identity.validity) throw new MailOperationError('Der Mailordner wurde geändert. Bitte aktualisieren.');
    const message = await client.fetchOne(String(identity.uid), { uid: true, bodyStructure: true }, { uid: true });
    if (!message || message.uid !== identity.uid) throw new MailOperationError('Die Nachricht wurde nicht gefunden.');
    const parts = messageParts(message.bodyStructure);
    const body = parts.find(part => part.type === 'text/plain' && part.disposition !== 'attachment' && !part.name)
      ?? parts.find(part => part.type === 'text/html' && part.disposition !== 'attachment' && !part.name);
    if (!body) return { bodyText: 'Für diese Nachricht ist keine Textansicht verfügbar.', bodyLoaded: true as const, truncated: !message.bodyStructure };
    const loaded = await readPart(client, identity.uid, body.part, TEXT_BYTE_LIMIT);
    let text: string, unsupported = false;
    try { text = new TextDecoder(loaded.charset || 'utf-8').decode(loaded.content); }
    catch { text = 'Die Zeichenkodierung dieser Nachricht wird noch nicht unterstützt.'; unsupported = true; }
    if (body.type === 'text/html' && !unsupported) {
      const parsed = await simpleParser(`Content-Type: text/html; charset=utf-8\r\n\r\n${text}`, { skipImageLinks: true, skipTextToHtml: true });
      text = parsed.text ?? '';
    }
    return { bodyText: text.slice(0, 20_000), bodyLoaded: true as const, truncated: unsupported || loaded.truncated || text.length > 20_000 || body.size > TEXT_BYTE_LIMIT * 4 };
  });
}

export async function downloadImapAttachment(config: MailAccountConfig, rawPath: string, rawValidity: string, rawUid: number, rawPart: string): Promise<{ name: string; content: Buffer }> {
  const identity = validateMessageIdentity(rawPath, rawValidity, rawUid);
  const part = partSchema.safeParse(rawPart);
  if (!part.success) throw new MailOperationError('Ungültiger Anhang.');
  return withImap(config, undefined, async client => {
    const mailbox = await client.mailboxOpen(identity.path, { readOnly: true });
    if (mailbox.uidValidity.toString() !== identity.validity) throw new MailOperationError('Der Mailordner wurde geändert. Bitte aktualisieren.');
    const message = await client.fetchOne(String(identity.uid), { uid: true, bodyStructure: true }, { uid: true });
    if (!message || message.uid !== identity.uid) throw new MailOperationError('Die Nachricht wurde nicht gefunden.');
    const attachment = attachmentParts(message.bodyStructure).find(item => item.part === part.data);
    if (!attachment) throw new MailOperationError('Der Anhang wurde nicht gefunden.');
    if (attachment.size > ATTACHMENT_LIMIT * 2) throw new MailOperationError('Der Anhang ist zu groß (höchstens 25 MB).');
    if (attachment.part === '1' && !message.bodyStructure?.childNodes?.length) {
      // Single-part messages use BODY[TEXT]/HEADER rather than BODY[1.MIME].
      const source = await client.fetchOne(String(identity.uid), { uid: true, size: true, source: { start: 0, maxLength: ATTACHMENT_LIMIT * 2 + 1 } }, { uid: true });
      if (!source || source.uid !== identity.uid || !source.source || source.size === undefined || source.size > source.source.length) throw new MailOperationError('Der Anhang konnte nicht vollständig geladen werden.');
      const parsed = await simpleParser(source.source, { skipImageLinks: true, skipTextToHtml: true });
      const file = parsed.attachments[0];
      if (!file) throw new MailOperationError('Der Anhang wurde nicht gefunden.');
      if (file.content.length > ATTACHMENT_LIMIT) throw new MailOperationError('Der Anhang ist zu groß (höchstens 25 MB).');
      return { name: attachment.name || file.filename || 'Anhang', content: file.content };
    }
    // downloadMany removes the MIME transfer encoding without converting text charsets;
    // downloaded text files must remain byte-for-byte identical to the attachment.
    const parts = await client.downloadMany(String(identity.uid), [attachment.part], { uid: true, maxBytes: ATTACHMENT_LIMIT * 2 + 1 });
    const item = parts[attachment.part];
    if (!item || (!item.content && attachment.size > 0)) throw new MailOperationError('Der Anhang ist nicht mehr verfügbar.');
    const content = item.content ?? Buffer.alloc(0);
    if (content.length > ATTACHMENT_LIMIT) throw new MailOperationError('Der Anhang ist zu groß (höchstens 25 MB).');
    return { name: attachment.name || 'Anhang', content };
  });
}

export async function setImapMessageRead(config: MailAccountConfig, rawPath: string, rawValidity: string, rawUid: number, read: boolean): Promise<void> {
  const identity = validateMessageIdentity(rawPath, rawValidity, rawUid);
  if (typeof read !== 'boolean') throw new MailOperationError('Ungültiger Nachrichtenstatus.');
  await withImap(config, undefined, async client => {
    const mailbox = await client.mailboxOpen(identity.path);
    if (mailbox.uidValidity.toString() !== identity.validity) throw new MailOperationError('Der Mailordner wurde geändert. Bitte aktualisieren.');
    if (mailbox.readOnly) throw new MailOperationError('Dieser Mailordner ist schreibgeschützt.');
    const message = await client.fetchOne(String(identity.uid), { uid: true }, { uid: true });
    if (!message || message.uid !== identity.uid) throw new MailOperationError('Die Nachricht wurde nicht gefunden.');
    const success = read ? await client.messageFlagsAdd(String(identity.uid), ['\\Seen'], { uid: true }) : await client.messageFlagsRemove(String(identity.uid), ['\\Seen'], { uid: true });
    if (!success) throw new MailOperationError('Der Gelesen-Status konnte nicht geändert werden.');
  });
}

import { promises as fs } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import addressParser from 'nodemailer/lib/addressparser';
import { AsyncEntry } from '@napi-rs/keyring';
import { z } from 'zod';
import { readMailPassword } from './mail-service';

/** SMTP settings contain no password and can be stored alongside account metadata. */
export type SmtpSettings = {
  accountId: string; host: string; port: number; security: 'tls' | 'starttls'; username: string; useImapCredentials: boolean;
};
export type SmtpMessageInput = {
  from: string; to: string; cc?: string; bcc?: string; subject: string; text: string;
  attachments?: { path: string; name: string }[];
  inReplyTo?: string; references?: string[];
};
export type SmtpSendResult =
  | { status: 'sent'; accepted: string[]; rejected: string[]; messageId: string }
  | { status: 'failed'; message: string; rejected: string[] }
  | { status: 'unknown'; message: string };

const noControls = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const value = (maximum: number) => z.string().trim().min(1).max(maximum).refine(noControls);
const host = value(253).refine(input => {
  if (isIP(input)) return true;
  return !input.endsWith('.') && /^[a-z0-9.-]+$/i.test(input) && input.split('.').every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
});
const settingsSchema = z.object({
  accountId: z.uuid(), host, port: z.number().int().min(1).max(65535),
  security: z.enum(['tls', 'starttls']), username: value(320), useImapCredentials: z.boolean()
}).strict();
const optionalRecipients = z.string().max(5000).refine(noControls).optional();
const messageIdSchema = value(500).refine(input => /^<[^<>\s]+@[^<>\s]+>$/.test(input));
const messageSchema = z.object({
  from: value(1000), to: z.string().max(5000).refine(noControls), cc: optionalRecipients, bcc: optionalRecipients,
  subject: z.string().max(1000).refine(noControls), text: z.string().max(100_000),
  attachments: z.array(z.object({ path: value(4096), name: value(255) }).strict()).max(20).optional(),
  inReplyTo: messageIdSchema.optional(), references: z.array(messageIdSchema).max(40).optional()
}).strict();
const SMTP_PASSWORD_SERVICE = 'OpenVibeDesk Mail SMTP';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export function validateSmtpSettings(input: unknown): SmtpSettings {
  const result = settingsSchema.safeParse(input);
  if (!result.success) throw new Error('Bitte gültige SMTP-Einstellungen eingeben.');
  return result.data;
}

function passwordEntry(accountId: string): AsyncEntry {
  if (!z.uuid().safeParse(accountId).success) throw new Error('Ungültige Konto-ID.');
  return new AsyncEntry(SMTP_PASSWORD_SERVICE, accountId, { linux: { store: 'secret-service' } });
}
export async function saveSmtpPassword(accountId: string, password: string): Promise<void> {
  if (typeof password !== 'string' || !password || password.length > 4096) throw new Error('Bitte ein gültiges SMTP-Passwort eingeben.');
  try { await passwordEntry(accountId).setPassword(password); }
  catch { throw new Error('Das SMTP-Passwort konnte nicht sicher gespeichert werden.'); }
}
export async function readSmtpPassword(accountId: string): Promise<string | null> {
  try { return await passwordEntry(accountId).getPassword(); }
  catch { throw new Error('Der sichere Zugangsdaten-Speicher ist nicht verfügbar.'); }
}
export async function deleteSmtpPassword(accountId: string): Promise<void> {
  try { await passwordEntry(accountId).deletePassword(); }
  catch { throw new Error('Das SMTP-Passwort konnte nicht gelöscht werden.'); }
}

async function passwordFor(config: SmtpSettings, suppliedPassword?: string): Promise<string> {
  const password = suppliedPassword === undefined
    ? config.useImapCredentials ? await readMailPassword(config.accountId) : await readSmtpPassword(config.accountId)
    : suppliedPassword;
  if (typeof password !== 'string' || !password || password.length > 4096) throw new Error('Für dieses Konto ist kein SMTP-Passwort gespeichert.');
  return password;
}

function makeTransport(config: SmtpSettings, password: string) {
  return nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.security === 'tls',
    requireTLS: config.security === 'starttls', ignoreTLS: false, opportunisticTLS: false,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user: config.username, pass: password },
    connectionTimeout: 20_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    logger: false, debug: false, transactionLog: false, disableUrlAccess: true, disableFileAccess: true
  });
}

function safeConnectionError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'EAUTH') return new Error('Die SMTP-Anmeldung ist fehlgeschlagen. Bitte Zugangsdaten prüfen.');
  if (code === 'ETLS' || code.startsWith('CERT_') || code.includes('CERT') || code.startsWith('UNABLE_TO_') || code.startsWith('SELF_SIGNED_')) return new Error('Die verschlüsselte SMTP-Verbindung konnte nicht sicher hergestellt werden. Bitte Zertifikat und Servernamen prüfen.');
  if (code === 'ETIMEDOUT') return new Error('Die Verbindung zum SMTP-Server hat zu lange gedauert.');
  return new Error('Die SMTP-Verbindung ist fehlgeschlagen. Bitte Server und Zugangsdaten prüfen.');
}

/** Verify settings without creating or transmitting a message. */
export async function testSmtpConnection(rawSettings: unknown, suppliedPassword?: string): Promise<void> {
  const config = validateSmtpSettings(rawSettings);
  const password = await passwordFor(config, suppliedPassword);
  const transport = makeTransport(config, password);
  try { await transport.verify(); }
  catch (error) { throw safeConnectionError(error); }
  finally { transport.close(); }
}

function parseRecipients(input: string): { name: string; address: string }[] {
  if (!input.trim()) return [];
  const parsed = addressParser(input, { flatten: true });
  // Addressparser can silently treat a second, space-separated address as a
  // display name. Reject that ambiguity rather than sending to fewer people.
  if (!parsed.length || parsed.some(item =>
    !/^[^\s@<>(),;:"\[\]\\]+@[^\s@<>(),;:"\[\]\\]+$/.test(item.address) ||
    !noControls(item.address) || item.address.length > 320 || /\S+@\S*/.test(item.name)
  )) throw new Error('Bitte gültige Empfängeradressen eingeben und mehrere Adressen durch Kommas oder Semikolons trennen.');
  return parsed.map(item => ({ name: item.name.slice(0, 500), address: item.address }));
}

/** Call only after an explicit user action and after verifying the sender belongs to the selected account. */
export async function sendSmtpMail(rawSettings: unknown, rawMessage: unknown): Promise<SmtpSendResult> {
  const config = validateSmtpSettings(rawSettings);
  const parsed = messageSchema.safeParse(rawMessage);
  if (!parsed.success) throw new Error('Die Nachricht enthält ungültige Angaben.');
  const message = parsed.data;
  const from = parseRecipients(message.from);
  if (from.length !== 1) throw new Error('Bitte eine gültige Absenderadresse auswählen.');
  const seen = new Set<string>();
  const unique = (list: { name: string; address: string }[]) => list.filter(item => {
    const key = item.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const to = unique(parseRecipients(message.to));
  const cc = unique(parseRecipients(message.cc ?? ''));
  const bcc = unique(parseRecipients(message.bcc ?? ''));
  if (!seen.size || seen.size > 100) throw new Error('Bitte zwischen 1 und 100 Empfänger eingeben.');

  const files: { name: string; content: Buffer }[] = [];
  let totalSize = 0;
  for (const attachment of message.attachments ?? []) {
    if (!path.isAbsolute(attachment.path)) throw new Error('Ein Anhang hat keinen gültigen lokalen Pfad.');
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(attachment.path, 'r');
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`Der Anhang „${attachment.name}“ ist keine Datei.`);
      if (totalSize + stat.size > MAX_ATTACHMENT_BYTES) throw new Error('Die Anhänge dürfen zusammen höchstens 25 MB groß sein.');
      const content = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < content.length) {
        const { bytesRead } = await handle.read(content, offset, content.length - offset, offset);
        if (!bytesRead) throw new Error(`Der Anhang „${attachment.name}“ wurde während des Lesens verändert.`);
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error(`Der Anhang „${attachment.name}“ wurde während des Lesens verändert.`);
      totalSize += content.length;
      files.push({ name: attachment.name, content });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Der Anhang')) throw error;
      if (error instanceof Error && error.message.startsWith('Die Anhänge')) throw error;
      throw new Error(`Der Anhang „${attachment.name}“ ist nicht mehr verfügbar.`);
    } finally { await handle?.close(); }
  }
  const password = await passwordFor(config);
  const transport = makeTransport(config, password);
  const generatedMessageId = `<${randomUUID()}@openvibedesk.local>`;
  try {
    const info = await transport.sendMail({
      from: from[0], to, cc, bcc, subject: message.subject, text: message.text,
      messageId: generatedMessageId,
      ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
      ...(message.references?.length ? { references: message.references } : {}),
      attachments: files.map(file => ({ filename: file.name, content: file.content }))
    });
    const accepted = (info.accepted ?? []).map(String);
    const rejected = (info.rejected ?? []).map(String);
    if (!accepted.length) return { status: 'failed', message: 'Der SMTP-Server hat keinen Empfänger angenommen.', rejected };
    return { status: 'sent', accepted, rejected, messageId: info.messageId || generatedMessageId };
  } catch (error) {
    const value = error && typeof error === 'object' ? error as { code?: unknown; command?: unknown; rejected?: unknown } : {};
    const code = typeof value.code === 'string' ? value.code : '';
    const command = typeof value.command === 'string' ? value.command.toUpperCase() : '';
    // A generic connection error can occur after DATA was sent: never report it as safely unsent.
    if (code === 'EAUTH' || code === 'EDNS' || code === 'ETLS' || (code === 'EENVELOPE' && ['API', 'MAIL FROM', 'RCPT TO'].includes(command))) {
      const rejected = Array.isArray(value.rejected) ? value.rejected.filter((entry): entry is string => typeof entry === 'string').slice(0, 100) : [];
      return { status: 'failed', message: code === 'EENVELOPE' ? 'Der SMTP-Server hat den Absender oder alle Empfänger abgelehnt.' : safeConnectionError(error).message, rejected };
    }
    return { status: 'unknown', message: 'Der Versandstatus ist unklar. Die Nachricht könnte bereits angenommen worden sein. Bitte vor einem erneuten Versand prüfen.' };
  } finally {
    // Cleanup cannot overturn an already known SMTP acceptance result.
    try { transport.close(); } catch { /* The transport is already being discarded. */ }
  }
}

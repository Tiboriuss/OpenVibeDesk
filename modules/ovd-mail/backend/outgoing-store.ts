import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PreparedSmtpMessage } from './smtp-service';

const MAGIC = Buffer.from('OVDOUT1\n');
const MAX_MIME_BYTES = 40 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_FILE_BYTES = MAGIC.length + 4 + MAX_METADATA_BYTES + MAX_MIME_BYTES;
const messageId = z.string().max(500).regex(/^<[^<>\s]+@[^<>\s]+>$/);
const address = z.string().min(3).max(320).refine(value => !/[\s\u0000-\u001f\u007f<>]/.test(value) && value.includes('@'));
const metadataSchema = z.object({
  version: z.literal(1), draftId: z.uuid(), messageId,
  accountIdentity: z.string().min(1).max(4096),
  envelope: z.object({ from: address, to: z.array(address).min(1).max(100) }).strict(),
  sentHeaders: z.string().max(MAX_METADATA_BYTES),
  rawSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sentRawSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const fail = () => new Error('Die lokal vorbereitete Nachricht ist nicht verfügbar oder beschädigt. Die Nachricht darf nicht erneut gesendet werden.');

function mimeParts(bytes: Buffer): { headers: Buffer; body: Buffer } {
  const separator = bytes.indexOf('\r\n\r\n');
  if (separator < 0 || separator > MAX_METADATA_BYTES) throw fail();
  return { headers: bytes.subarray(0, separator), body: bytes.subarray(separator + 4) };
}

function assertHeaders(headers: Buffer, expectedMessageId: string, allowBcc: boolean): void {
  const values = headers.toString('latin1').split(/\r\n(?![ \t])/);
  const ids = values.filter(value => /^message-id:/i.test(value));
  if (ids.length !== 1 || ids[0].replace(/^message-id:\s*/i, '').trim() !== expectedMessageId) throw fail();
  if (!allowBcc && values.some(value => /^bcc:/i.test(value))) throw fail();
}

/** A bounded immutable MIME snapshot, separate from the workspace's SMTP outcome. */
export class OutgoingStore {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDirectory: string) {}

  private filePath(draftId: string): string {
    if (!z.uuid().safeParse(draftId).success) throw fail();
    return path.join(this.dataDirectory, `${draftId}.outgoing`);
  }

  save(draftId: string, prepared: PreparedSmtpMessage, accountIdentity: string): Promise<void> {
    const destination = this.filePath(draftId);
    if (!Buffer.isBuffer(prepared.raw) || !Buffer.isBuffer(prepared.sentRaw) || !prepared.raw.length ||
        prepared.raw.length > MAX_MIME_BYTES || prepared.sentRaw.length > MAX_MIME_BYTES) throw fail();
    const wire = mimeParts(prepared.raw), sent = mimeParts(prepared.sentRaw);
    if (!wire.body.equals(sent.body)) throw fail();
    assertHeaders(wire.headers, prepared.messageId, false);
    assertHeaders(sent.headers, prepared.messageId, true);
    const metadata = metadataSchema.parse({ version: 1, draftId, messageId: prepared.messageId, accountIdentity,
      envelope: prepared.envelope, sentHeaders: sent.headers.toString('base64'),
      rawSha256: digest(prepared.raw), sentRawSha256: digest(prepared.sentRaw) });
    const encoded = Buffer.from(JSON.stringify(metadata));
    if (encoded.length > MAX_METADATA_BYTES) throw fail();
    const length = Buffer.alloc(4); length.writeUInt32BE(encoded.length);
    // Capture the requested bytes before joining the disk queue. The body is
    // stored once; the sender's Bcc header is reconstructed only for Sent.
    const payload = Buffer.concat([MAGIC, length, encoded, prepared.raw]);
    const operation = this.writes.then(async () => {
      await fs.mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        const file = await fs.open(temporary, 'wx', 0o600);
        try { await file.writeFile(payload); await file.sync(); } finally { await file.close(); }
        await fs.rename(temporary, destination);
        await this.syncDirectory();
      } catch {
        await fs.unlink(temporary).catch(() => {});
        throw new Error('Die Nachricht konnte vor dem Versand nicht lokal für die Gesendet-Ablage gesichert werden.');
      }
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  async read(draftId: string, expectedMessageId: string, expectedAccountIdentity: string): Promise<PreparedSmtpMessage> {
    await this.writes;
    try {
      const file = await fs.open(this.filePath(draftId), 'r');
      let bytes: Buffer;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size <= MAGIC.length + 4 || stat.size > MAX_FILE_BYTES) throw fail();
        bytes = Buffer.alloc(stat.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) throw fail();
          offset += bytesRead;
        }
        const after = await file.stat();
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw fail();
      } finally { await file.close(); }
      if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw fail();
      const metadataLength = bytes.readUInt32BE(MAGIC.length);
      const rawOffset = MAGIC.length + 4 + metadataLength;
      if (!metadataLength || metadataLength > MAX_METADATA_BYTES || rawOffset >= bytes.length) throw fail();
      const metadata = metadataSchema.parse(JSON.parse(bytes.subarray(MAGIC.length + 4, rawOffset).toString('utf8')));
      if (metadata.draftId !== draftId || metadata.messageId !== expectedMessageId || metadata.accountIdentity !== expectedAccountIdentity) throw fail();
      const raw = bytes.subarray(rawOffset);
      const wire = mimeParts(raw), sentHeaders = Buffer.from(metadata.sentHeaders, 'base64');
      assertHeaders(wire.headers, expectedMessageId, false);
      assertHeaders(sentHeaders, expectedMessageId, true);
      const sentRaw = Buffer.concat([sentHeaders, Buffer.from('\r\n\r\n'), wire.body]);
      if (sentRaw.length > MAX_MIME_BYTES || digest(raw) !== metadata.rawSha256 || digest(sentRaw) !== metadata.sentRawSha256) throw fail();
      return { messageId: metadata.messageId, raw, sentRaw, envelope: metadata.envelope };
    } catch { throw fail(); }
  }

  remove(draftId: string): Promise<void> {
    const destination = this.filePath(draftId);
    const operation = this.writes.then(async () => {
      try { await fs.unlink(destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      await this.syncDirectory();
    });
    this.writes = operation.catch(() => {});
    return operation;
  }

  private async syncDirectory(): Promise<void> {
    if (process.platform === 'win32') return;
    const directory = await fs.open(this.dataDirectory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}

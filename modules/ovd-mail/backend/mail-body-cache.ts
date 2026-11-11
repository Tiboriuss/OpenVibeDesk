import type { ImapMessageBody } from './mail-service';

const MiB = 1024 * 1024;
const ENCODED_BUDGET = 16 * MiB;
const RETAINED_BUDGET = 32 * MiB;
type Cost = { encodedBytes: number; stringBytes: number; decodedImageBytes: number };
type Entry = { body: ImapMessageBody; cost: Cost };

/** Header-only estimate of one RGBA frame; this never decodes an image. */
function decodedImageBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return RETAINED_BUDGET;
  // JPEG dimensions can follow metadata segments. The MIME service already
  // bounds each data URL; this temporary buffer is not retained by the cache.
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');
  let width = 0, height = 0;
  if (bytes.length >= 24 && bytes.subarray(1, 4).toString('ascii') === 'PNG') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 10 && bytes.subarray(0, 3).toString('ascii') === 'GIF') {
    width = bytes.readUInt16LE(6); height = bytes.readUInt16LE(8);
  } else if (bytes.length >= 30 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    const kind = bytes.subarray(12, 16).toString('ascii');
    if (kind === 'VP8X') { width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3); }
    else if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
    else if (kind === 'VP8L' && bytes[20] === 0x2f) { const dimensions = bytes.readUInt32LE(21); width = (dimensions & 0x3fff) + 1; height = ((dimensions >>> 14) & 0x3fff) + 1; }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  }
  // Unknown dimensions are not a free cache entry. Animated images may retain
  // additional frames in Chromium; the metric intentionally names its estimate.
  return width > 0 && height > 0 ? width * height * 4 : RETAINED_BUDGET;
}

function bodyCost(body: ImapMessageBody): Cost {
  const images = Object.values(body.inlineImages ?? {});
  const strings = [body.bodyText, body.bodyHtml ?? '', ...images];
  return {
    encodedBytes: strings.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0),
    stringBytes: strings.reduce((sum, text) => sum + text.length * 2, 0),
    decodedImageBytes: images.reduce((sum, image) => sum + decodedImageBytes(image), 0)
  };
}

/** Payloads are separate from durable source identity and per-message display preferences. */
export class MailBodyCache {
  private readonly entries = new Map<string, Entry>();
  private cost: Cost = { encodedBytes: 0, stringBytes: 0, decodedImageBytes: 0 };
  private pinnedId?: string;
  private revision = 0;
  get generation(): number { return this.revision; }

  get(id: string): ImapMessageBody | undefined {
    const entry = this.entries.get(id);
    if (entry) { this.entries.delete(id); this.entries.set(id, entry); }
    return entry?.body;
  }
  peek(id: string): ImapMessageBody | undefined { return this.entries.get(id)?.body; }
  pin(id?: string): void { this.pinnedId = id; }
  set(id: string, body: ImapMessageBody): void {
    this.delete(id);
    const cost = bodyCost(body);
    // Even the active selection cannot exceed the cache budgets. Such a body
    // is returned directly to the single reader but not retained by the host.
    if (cost.encodedBytes > ENCODED_BUDGET || cost.stringBytes + cost.decodedImageBytes > RETAINED_BUDGET) return;
    for (const [candidate] of this.entries) {
      if (this.cost.encodedBytes + cost.encodedBytes <= ENCODED_BUDGET && this.cost.stringBytes + this.cost.decodedImageBytes + cost.stringBytes + cost.decodedImageBytes <= RETAINED_BUDGET) break;
      if (candidate !== this.pinnedId) this.delete(candidate);
    }
    if (this.cost.encodedBytes + cost.encodedBytes > ENCODED_BUDGET || this.cost.stringBytes + this.cost.decodedImageBytes + cost.stringBytes + cost.decodedImageBytes > RETAINED_BUDGET) return;
    this.entries.set(id, { body, cost });
    for (const key of Object.keys(cost) as (keyof Cost)[]) this.cost[key] += cost[key];
  }
  delete(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    for (const key of Object.keys(entry.cost) as (keyof Cost)[]) this.cost[key] -= entry.cost[key];
  }
  clear(): void {
    this.entries.clear(); this.pinnedId = undefined; this.revision++;
    this.cost = { encodedBytes: 0, stringBytes: 0, decodedImageBytes: 0 };
  }
  stats() {
    return { entries: this.entries.size, ...this.cost, retainedEstimateBytes: this.cost.stringBytes + this.cost.decodedImageBytes,
      encodedBudgetBytes: ENCODED_BUDGET, retainedBudgetBytes: RETAINED_BUDGET, pinnedEntries: this.pinnedId && this.entries.has(this.pinnedId) ? 1 : 0 };
  }
}

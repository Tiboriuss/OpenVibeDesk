import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FetchMessageObject, SearchObject } from 'imapflow';
import { mailFilterSchema, mailQuerySortSchema, type MailFilter, type MailQuerySort } from '../../../shared/mail-query';
import { resolveTimeRange } from '../../../shared/time';
import { withImap, mapImapMetadata, imapConnectionIdentity, MailOperationError, type MailAccountConfig, type ImapMessage } from './mail-service';

/** Explicit metadata budget. SEARCH-only counts do not need to fetch individual messages. */
export const MAIL_QUERY_SCAN_LIMIT = 10_000;
const FETCH_CHUNK_SIZE = 100;
const folderSchema = z.string().min(1).max(1024).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const uidSchema = z.number().int().positive().max(0xffffffff);
const resolvedRangeSchema = z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) }).passthrough().refine(value => Date.parse(value.end) > Date.parse(value.start), 'Das Zeitraumende muss nach dem Anfang liegen.');
const cursorSchema = z.object({ offset: z.number().int().min(0).max(100_000_000), uidValidity: z.string().regex(/^\d{1,20}$/), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const optionsSchema = z.object({ filter: mailFilterSchema.optional(), resolvedRange: resolvedRangeSchema.optional(), sort: mailQuerySortSchema.optional(), limit: z.number().int().min(1).max(20).optional(), cursor: cursorSchema.optional() }).strict();

export type ImapQueryCursor = z.infer<typeof cursorSchema>;
export type ImapQueryOptions = z.infer<typeof optionsSchema>;
export interface ImapQueryResult {
  messages: ImapMessage[];
  uidValidity: string;
  fingerprint: string;
  count: number;
  countExact: boolean;
  complete: boolean;
  scannedCount: number;
  candidateCount: number;
  scanLimit: number;
  hasMore: boolean;
  nextCursor?: ImapQueryCursor;
  observedAt: string;
  completedAt: string;
  warnings?: string[];
}
export type ImapCountOptions = Pick<ImapQueryOptions, 'filter' | 'resolvedRange'>;
export type ImapCountResult = Omit<ImapQueryResult, 'messages' | 'fingerprint' | 'hasMore' | 'nextCursor'>;

function serverCriteria(filter: MailFilter, range?: { start: string; end: string }): SearchObject {
  const result: SearchObject = {};
  for (const key of ['text', 'from', 'to', 'subject'] as const) if (filter[key]) result[key] = filter[key];
  if (typeof filter.read === 'boolean') result.seen = filter.read;
  if (range) {
    // IMAP SINCE/BEFORE compare calendar dates without their times or offsets.
    // A deliberately wider UTC date window cannot exclude an exact boundary hit.
    const start = new Date(range.start), end = new Date(range.end);
    result.since = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() - 2));
    result.before = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 2));
  }
  if (!Object.keys(result).length) result.all = true;
  return result;
}

function milliseconds(value: unknown): number | undefined {
  if (value === undefined || value === null || value === false) return undefined;
  const result = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(result) ? result : undefined;
}

type Candidate = { uid: number; receivedAt?: number; sentAt?: number };
function compareCandidates(sort: MailQuerySort) {
  if (sort === 'uid_desc') return (a: Candidate, b: Candidate) => b.uid - a.uid;
  const key = sort.startsWith('sent_') ? 'sentAt' : 'receivedAt', ascending = sort.endsWith('_asc');
  return (a: Candidate, b: Candidate) => (ascending ? a[key]! - b[key]! : b[key]! - a[key]!) || b.uid - a.uid;
}

/** Read-only, server-filtered metadata query. No message body or attachment bytes are fetched. */
export async function queryImapMessages(config: MailAccountConfig, rawFolder: string, rawOptions: ImapQueryOptions = {}, signal?: AbortSignal): Promise<ImapQueryResult> {
  return executeQuery(config, rawFolder, rawOptions, false, signal) as Promise<ImapQueryResult>;
}

/** Counts full matching UID sets; date filters inspect only INTERNALDATE within an explicit budget. */
export async function countImapMessages(config: MailAccountConfig, rawFolder: string, rawOptions: ImapCountOptions = {}, signal?: AbortSignal): Promise<ImapCountResult> {
  const countOptions = optionsSchema.pick({ filter: true, resolvedRange: true }).parse(rawOptions);
  return executeQuery(config, rawFolder, countOptions, true, signal) as Promise<ImapCountResult>;
}

async function executeQuery(config: MailAccountConfig, rawFolder: string, rawOptions: ImapQueryOptions, countOnly: boolean, signal?: AbortSignal): Promise<ImapQueryResult | ImapCountResult> {
  const folder = folderSchema.parse(rawFolder), options = optionsSchema.parse(rawOptions), filter = options.filter ?? {};
  const resolved = options.resolvedRange ?? (filter.received ? resolveTimeRange(filter.received) : undefined);
  const range = resolved ? resolvedRangeSchema.parse(resolved) : undefined;
  const sort = options.sort ?? 'received_desc', limit = options.limit ?? 10;
  signal?.throwIfAborted();
  return withImap(config, undefined, async client => {
    const mailbox = await client.mailboxOpen(folder, { readOnly: true });
    const uidValidity = mailbox.uidValidity.toString();
    signal?.throwIfAborted();
    if (countOnly && !range) {
      // ImapFlow uses ESEARCH COUNT when supported and derives the same result
      // from ordinary SEARCH on older servers. Neither path downloads envelopes.
      const result = mailbox.exists ? await client.search(serverCriteria(filter), { uid: true, returnOptions: ['COUNT'] }) : { count: 0 };
      const count = Array.isArray(result) ? new Set(result.filter(uid => uidSchema.safeParse(uid).success)).size : result && typeof result === 'object' ? result.count : undefined;
      if (!Number.isSafeInteger(count) || count! < 0 || Array.isArray(result) && count !== result.length) throw new MailOperationError('Die Trefferzahl wurde vom IMAP-Server nicht vollständig beantwortet.');
      signal?.throwIfAborted();
      const observedAt = new Date().toISOString();
      return { uidValidity, count: count!, countExact: true, complete: true, scannedCount: 0, candidateCount: count!, scanLimit: MAIL_QUERY_SCAN_LIMIT, observedAt, completedAt: observedAt };
    }
    const found = mailbox.exists ? await client.search(serverCriteria(filter, range), { uid: true }) : [];
    if (!Array.isArray(found)) throw new MailOperationError('Die Nachrichtenabfrage wurde vom IMAP-Server nicht vollständig beantwortet.');
    const uids = [...new Set(found.filter(uid => uidSchema.safeParse(uid).success))].sort((a, b) => b - a);
    if (uids.length !== found.length) throw new MailOperationError('Der IMAP-Server hat ungültige oder doppelte Nachrichtenkennungen geliefert.');
    const observedAt = new Date().toISOString();
    const fingerprint = createHash('sha256').update(JSON.stringify({ account: imapConnectionIdentity(config), folder, uidValidity, filter, range: range ? { start: range.start, end: range.end } : undefined, sort, uids })).digest('hex');
    if (options.cursor && (options.cursor.uidValidity !== uidValidity || options.cursor.fingerprint !== fingerprint)) throw new MailOperationError('Die Nachrichtenliste oder ihre Filter wurden geändert. Bitte die erste Seite erneut abrufen.');
    signal?.throwIfAborted();

    const warnings: string[] = [];
    let complete = true, countExact = true, scannedCount = 0, rangeMatchCount = 0;
    const requiresMetadata = !!range || !countOnly && sort !== 'uid_desc';
    let candidates: Candidate[] = uids.map(uid => ({ uid }));
    if (requiresMetadata) {
      const selectedUids = uids.slice(0, MAIL_QUERY_SCAN_LIMIT), rows = new Map<number, Candidate>();
      if (selectedUids.length < uids.length) {
        complete = false;
        if (range) countExact = false;
        warnings.push(`Metadatenprüfung auf ${MAIL_QUERY_SCAN_LIMIT} von ${uids.length} Serverkandidaten begrenzt. Zeitraum oder Postfachumfang weiter eingrenzen; die gesamte Datumsreihenfolge ist noch nicht bestätigt.`);
      }
      const needReceived = !!range || !countOnly && sort.startsWith('received_');
      const needSent = !countOnly && sort.startsWith('sent_');
      for (let index = 0; index < selectedUids.length; index += FETCH_CHUNK_SIZE) {
        signal?.throwIfAborted();
        const chunk = selectedUids.slice(index, index + FETCH_CHUNK_SIZE), wanted = new Set(chunk);
        const fetched = await client.fetchAll(chunk, { uid: true, ...(needReceived ? { internalDate: true } : {}), ...(needSent ? { envelope: true } : {}) }, { uid: true });
        signal?.throwIfAborted();
        for (const row of fetched) if (wanted.has(row.uid)) rows.set(row.uid, { uid: row.uid, receivedAt: milliseconds(row.internalDate), sentAt: milliseconds(row.envelope?.date) });
        scannedCount = rows.size;
      }
      if (rows.size < selectedUids.length) {
        complete = false;
        if (range) countExact = false;
        warnings.push('Einige Nachrichten waren während der Abfrage nicht mehr verfügbar. Das Ergebnis ist eine Momentaufnahme mit unvollständiger Metadatenprüfung.');
      }
      candidates = [...rows.values()];
      if (range) {
        const start = Date.parse(range.start), end = Date.parse(range.end);
        if (candidates.some(row => row.receivedAt === undefined)) { complete = false; countExact = false; warnings.push('Bei einigen Nachrichten fehlt die Empfangszeit. Sie konnten keinem Zeitraum sicher zugeordnet werden.'); }
        candidates = candidates.filter(row => row.receivedAt !== undefined && row.receivedAt >= start && row.receivedAt < end);
        rangeMatchCount = candidates.length;
      }
      if (!countOnly && sort !== 'uid_desc') {
        const key = sort.startsWith('sent_') ? 'sentAt' : 'receivedAt';
        if (candidates.some(row => row[key] === undefined)) { complete = false; warnings.push('Bei einigen Nachrichten fehlt das gewählte Sortierdatum. Sie sind in der Datumsreihenfolge nicht enthalten.'); }
        candidates = candidates.filter(row => row[key] !== undefined);
      }
    }
    const count = range ? rangeMatchCount : uids.length;
    const base = { uidValidity, count, countExact, complete, scannedCount, candidateCount: uids.length, scanLimit: MAIL_QUERY_SCAN_LIMIT, observedAt, completedAt: new Date().toISOString() };
    if (countOnly) return { ...base, ...(warnings.length ? { warnings } : {}) };

    candidates.sort(compareCandidates(sort));
    const offset = options.cursor?.offset ?? 0;
    if (offset > candidates.length) throw new MailOperationError('Die Seitenposition liegt außerhalb der aktuellen Nachrichtenliste. Bitte erneut beginnen.');
    const page = candidates.slice(offset, offset + limit), selected = page.map(item => item.uid), byUid = new Map<number, FetchMessageObject>();
    if (selected.length) {
      signal?.throwIfAborted();
      const rows = await client.fetchAll(selected, { uid: true, flags: true, internalDate: true, envelope: true, bodyStructure: true, headers: ['references'] }, { uid: true });
      signal?.throwIfAborted();
      const wanted = new Set(selected);
      for (const row of rows) if (wanted.has(row.uid)) byUid.set(row.uid, row);
      if (byUid.size < selected.length) { complete = false; warnings.push('Nachrichten der angeforderten Seite wurden zwischenzeitlich entfernt. Bitte für einen aktuellen Stand erneut abfragen.'); }
    }
    const messages = await mapImapMetadata(selected.flatMap(uid => byUid.has(uid) ? [byUid.get(uid)!] : []), uidValidity);
    signal?.throwIfAborted();
    const nextOffset = offset + page.length, hasMore = nextOffset < candidates.length;
    return { ...base, complete, messages, fingerprint, hasMore, ...(hasMore ? { nextCursor: { offset: nextOffset, uidValidity, fingerprint } } : {}), ...(warnings.length ? { warnings } : {}), scannedCount: requiresMetadata ? scannedCount : selected.length, completedAt: new Date().toISOString() };
  }, signal);
}

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Draft } from '../../../shared/model';
import type { DraftSaveState } from '../../../shared/drafts';
import { draftCollection, type DraftCollection } from '../../../shared/draft-status';

const PAGE_CHARACTERS = 6000;
const RESULT_CHARACTERS = 24_000;
type Scope = DraftCollection | 'all';
const cursorSchema = z.object({ kind: z.enum(['draft-body', 'draft-list']), version: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0) }).strict();
type Cursor = z.infer<typeof cursorSchema>;
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
function position(raw: string | undefined, kind: Cursor['kind'], version: string): number {
  if (raw === undefined) return 0;
  let cursor: Cursor;
  try {
    if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    cursor = cursorSchema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch { throw new Error('Ungültige Entwurfsseite. Bitte erneut mit der ersten Seite beginnen.'); }
  if (cursor.kind !== kind || cursor.version !== version) throw new Error('Der Entwurf oder die Entwurfsliste wurde geändert. Bitte erneut mit der ersten Seite beginnen.');
  return cursor.offset;
}
function limit(value: number | undefined, fallback: number, min: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('Ungültige Seitengröße.');
  return result;
}
function boundary(text: string, end: number): number {
  return end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end]) ? end - 1 : end;
}
const excerpt = (text: string | undefined, size: number) => text === undefined ? undefined : text.slice(0, boundary(text, size));
const versionOf = (draft: Draft) => createHash('sha256').update(JSON.stringify(draft)).digest('hex');
const publicSave = (state: DraftSaveState) => ({ ...state, ...(state.error ? { error: excerpt(state.error, 500) } : {}) });

/** Never expose attachment paths; large ancillary lists remain explicit excerpts. */
function publicDraft(draft: Draft, list = false) {
  const attachmentLimit = list ? 3 : 20, subjectLimit = list ? 240 : 1000, addressLimit = list ? 240 : 500;
  return {
    id: draft.id, accountId: draft.accountId, replyTo: draft.replyTo,
    to: excerpt(draft.to, addressLimit), cc: excerpt(draft.cc, addressLimit), bcc: excerpt(draft.bcc, addressLimit),
    subject: excerpt(draft.subject, subjectLimit), updatedAt: draft.updatedAt,
    deliveryStatus: draft.deliveryStatus ?? 'draft', deliveryError: excerpt(draft.deliveryError, 500),
    ...(draft.sentCopy ? { sentCopy: { ...draft.sentCopy, ...(draft.sentCopy.error ? { error: excerpt(draft.sentCopy.error, 500) } : {}) } } : {}),
    ...(draft.rejectedRecipients ? { rejectedRecipients: draft.rejectedRecipients.slice(0, 20).map(value => excerpt(value, 500)!) } : {}),
    ...(!list ? { inReplyTo: draft.inReplyTo, references: draft.references?.slice(-20) } : {}),
    attachmentCount: draft.attachments.length,
    attachments: draft.attachments.slice(0, attachmentLimit).map(({ name, size }, index) => ({ index, name: excerpt(name, 240)!, size })),
    metadataTruncated: draft.attachments.length > attachmentLimit || draft.attachments.some(item => item.name.length > 240) || draft.subject.length > subjectLimit || [draft.to, draft.cc, draft.bcc].some(value => (value?.length ?? 0) > addressLimit) || (draft.deliveryError?.length ?? 0) > 500 || (draft.sentCopy?.error?.length ?? 0) > 500 || (draft.rejectedRecipients?.length ?? 0) > 20 || !!draft.rejectedRecipients?.some(value => value.length > 500) || (!list && (draft.references?.length ?? 0) > 20)
  };
}

/** A source revision, not a cache handle: unchanged local drafts survive restart. */
export function readDraftContent(draft: Draft, options: { cursor?: string; limit?: number }, saveState: DraftSaveState) {
  const sourceVersion = versionOf(draft), offset = position(options.cursor, 'draft-body', sourceVersion);
  if (offset > draft.body.length || boundary(draft.body, offset) !== offset) throw new Error('Die Seitenposition liegt außerhalb des Entwurfstextes. Bitte erneut beginnen.');
  const requestedLimit = limit(options.limit, PAGE_CHARACTERS, 2, PAGE_CHARACTERS);
  const metadata = publicDraft(draft);
  // Keep uncommon large header/attachment collections from hiding the body page
  // behind the host's whole-result truncation. Their omission is explicit.
  while (JSON.stringify(metadata).length > 16_000 && (metadata.attachments.length || metadata.references?.length)) {
    if (metadata.attachments.length) metadata.attachments.pop(); else metadata.references?.shift();
    metadata.metadataTruncated = true;
  }
  let end = boundary(draft.body, Math.min(draft.body.length, offset + requestedLimit));
  const page = () => ({ ...metadata, saveState: publicSave(saveState), body: draft.body.slice(offset, end), bodyTruncated: offset > 0 || end < draft.body.length,
    untrusted: true, sourceVersion, observedAt: new Date().toISOString(), offset, offsetUnit: 'UTF-16' as const,
    requestedLimit, returnedCharacters: end - offset, totalCharacters: draft.body.length, sourceComplete: true,
    complete: end === draft.body.length, hasMore: end < draft.body.length,
    ...(end < draft.body.length ? { nextCursor: encode({ kind: 'draft-body', version: sourceVersion, offset: end }) } : {}) });
  let result = page();
  while (JSON.stringify(result).length > RESULT_CHARACTERS && end > offset) {
    end = boundary(draft.body, offset + Math.floor((end - offset) / 2)); result = page();
  }
  if (JSON.stringify(result).length > RESULT_CHARACTERS || end === offset && offset < draft.body.length) throw new Error('Die Entwurfsmetadaten sind für eine Textseite zu groß. Bitte den Entwurf im Editor prüfen.');
  return result;
}

/** Revision-bound enumeration cannot silently skip an edited or removed draft. */
export function listDraftContent(all: readonly Draft[], options: { cursor?: string; limit?: number; scope?: Scope }, activeDraftId: string | undefined, saveState: (id: string) => DraftSaveState) {
  const scope = options.scope ?? 'drafts', requestedLimit = limit(options.limit, 20, 1, 50);
  if (!['drafts', 'outbox', 'sent', 'all'].includes(scope)) throw new Error('Ungültige Entwurfsauswahl.');
  const ordered = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const hash = createHash('sha256').update(scope);
  for (const draft of ordered) hash.update(versionOf(draft));
  const sourceVersion = hash.digest('hex'), offset = position(options.cursor, 'draft-list', sourceVersion);
  const matches = ordered.filter(draft => scope === 'all' || draftCollection(draft) === scope);
  if (offset > matches.length) throw new Error('Die Seitenposition liegt außerhalb der Entwurfsliste. Bitte erneut beginnen.');
  const counts = { drafts: 0, outbox: 0, sent: 0 };
  for (const draft of all) counts[draftCollection(draft)]++;
  const active = all.find(draft => draft.id === activeDraftId);
  const drafts: (ReturnType<typeof publicDraft> & { saveState: DraftSaveState })[] = [];
  const page = () => ({ scope, counts, total: matches.length, countExact: true, sourceVersion, observedAt: new Date().toISOString(), offset,
    requestedLimit, returnedCount: drafts.length, complete: offset + drafts.length === matches.length, hasMore: offset + drafts.length < matches.length,
    ...(offset + drafts.length < matches.length ? { nextCursor: encode({ kind: 'draft-list', version: sourceVersion, offset: offset + drafts.length }) } : {}),
    drafts, activeDraftId, activeDraftCollection: active ? draftCollection(active) : undefined });
  for (const draft of matches.slice(offset, offset + requestedLimit)) {
    drafts.push({ ...publicDraft(draft, true), saveState: publicSave(saveState(draft.id)) });
    if (JSON.stringify(page()).length > RESULT_CHARACTERS) { drafts.pop(); break; }
  }
  if (!drafts.length && offset < matches.length) throw new Error('Die Entwurfsmetadaten sind für eine Listenseite zu groß. Bitte den Entwurf im Editor prüfen.');
  return page();
}

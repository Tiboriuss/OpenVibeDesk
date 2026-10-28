import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chatHistoryRequestSchema, type ChatHistoryPage, type ChatHistoryPart, type ChatHistoryRequest } from '../shared/chat-history';
import type { ChatMessage, WorkspaceState } from '../shared/model';

// Leave room for module/tool envelopes below their common 32,000-character limit.
const PAGE_JSON_LIMIT = 28_000;
const PART_TEXT_LIMIT = 8_000;
const cursorSchema = z.tuple([z.literal(1), z.string().min(1).max(128), z.string().regex(/^[a-f0-9]{64}$/), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]);

function metadata(message: ChatMessage, index: number): Omit<ChatHistoryPart, 'text' | 'textOffset' | 'textEnd' | 'textLength' | 'messageComplete'> {
  return {
    messageId: message.id.slice(0, 128), index, role: message.role, timestamp: message.timestamp.slice(0, 100),
    ...(message.status ? { status: message.status } : {}),
    ...(message.emailReference || message.emailRef ? { emailReference: { id: (message.emailReference?.id ?? message.emailRef!).slice(0, 128), ...(message.emailReference ? { subject: message.emailReference.subject.slice(0, 120) } : {}) } } : {}),
    ...(message.sessionRef ? { chatReference: { sessionId: message.sessionRef.id.slice(0, 128), title: message.sessionRef.title.slice(0, 120) } } : {}),
    ...(message.references?.length ? { moduleReferences: message.references.slice(0, 5).map(reference => ({ moduleId: reference.moduleId.slice(0, 128), type: reference.type.slice(0, 80), id: reference.id.slice(0, 128), title: reference.title.slice(0, 120) })) } : {})
  };
}

function characterEnd(text: string, start: number, length: number): number {
  let end = Math.min(text.length, start + length);
  // Keep a surrogate pair together while offsets still use normal JS text indices.
  if (end > start && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return end;
}

/** Read the same saved source the UI displays, without selecting or opening its window. */
export function readChatHistory(state: Pick<WorkspaceState, 'sessions'>, rawRequest: ChatHistoryRequest, now = new Date().toISOString()): ChatHistoryPage {
  const request = chatHistoryRequestSchema.parse(rawRequest);
  const session = state.sessions.find(item => item.id === request.sessionId);
  if (!session) throw new Error('Chat nicht gefunden. Bitte eine vorhandene Chat-ID verwenden.');
  const messages = session.messages.filter(message => message.id !== 'welcome');
  const header = { sessionId: session.id, title: session.title.slice(0, 120), sourceUpdatedAt: session.updatedAt.slice(0, 100) };
  // Tool activity updates the session timestamp while the visible saved text is
  // unchanged. Only exported content belongs to the cursor's revision.
  const hash = createHash('sha256').update(JSON.stringify({ sessionId: header.sessionId, title: header.title }));
  for (const [index, message] of messages.entries()) hash.update(JSON.stringify({ ...metadata(message, index), text: message.text }));
  const revision = hash.digest('hex');
  let index = 0, offset = 0;
  if (request.cursor) {
    let decoded: z.infer<typeof cursorSchema>;
    try { decoded = cursorSchema.parse(JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'))); }
    catch { throw new Error('Ungültiger Chat-Cursor. Bitte ohne Cursor neu beginnen.'); }
    if (decoded[1] !== session.id) throw new Error('Dieser Cursor gehört zu einem anderen Chat. Bitte ohne Cursor neu beginnen.');
    if (decoded[2] !== revision) throw new Error('Der gespeicherte Chat hat sich seit der ersten Seite geändert. Bitte ohne Cursor neu beginnen.');
    [, , , index, offset] = decoded;
    if (index >= messages.length || offset > messages[index].text.length) throw new Error('Ungültige Chatposition. Bitte ohne Cursor neu beginnen.');
  }
  const result: ChatHistoryPage = {
    ...header, revision, observedAt: now, scope: 'saved_message_texts', references: 'metadata_only', untrusted: true,
    order: 'chronological', totalMessages: messages.length, totalTextChars: messages.reduce((sum, message) => sum + message.text.length, 0),
    startMessageIndex: index, startTextOffset: offset, parts: [], returnedTextChars: 0, hasMore: false, complete: false
  };
  const maxChars = request.maxChars ?? 8000, limit = request.limit ?? 20;
  const cursorAt = (position: number, textOffset: number) => Buffer.from(JSON.stringify([1, session.id, revision, position, textOffset])).toString('base64url');
  while (index < messages.length && result.parts.length < limit && result.returnedTextChars < maxChars) {
    const message = messages[index], details = metadata(message, index);
    const desiredLength = Math.min(message.text.length - offset, PART_TEXT_LIMIT, maxChars - result.returnedTextChars);
    let end = characterEnd(message.text, offset, desiredLength);
    const partAt = (partEnd: number): ChatHistoryPart => ({ ...details, text: message.text.slice(offset, partEnd), textOffset: offset, textEnd: partEnd, textLength: message.text.length, messageComplete: partEnd === message.text.length });
    const serializedLength = (part: ChatHistoryPart) => JSON.stringify({ ...result, parts: [...result.parts, part], returnedTextChars: result.returnedTextChars + part.text.length, hasMore: true, complete: false, nextCursor: cursorAt(index, part.textEnd) }).length;
    let part = partAt(end);
    if (serializedLength(part) > PAGE_JSON_LIMIT) {
      // Quotes, control characters and lone surrogates can expand in JSON. Budget
      // the serialized result rather than silently losing text in outer wrappers.
      let low = 0, high = end - offset;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (serializedLength(partAt(characterEnd(message.text, offset, middle))) <= PAGE_JSON_LIMIT) low = middle;
        else high = middle - 1;
      }
      end = characterEnd(message.text, offset, low);
      part = partAt(end);
    }
    if (end === offset && message.text.length > offset) break;
    if (serializedLength(part) > PAGE_JSON_LIMIT) break;
    result.parts.push(part);
    result.returnedTextChars += part.text.length;
    offset = end;
    if (offset === message.text.length) { index++; offset = 0; }
    if (end < message.text.length) break;
  }
  result.hasMore = index < messages.length;
  result.complete = !result.hasMore;
  if (result.hasMore) result.nextCursor = cursorAt(index, offset);
  return result;
}

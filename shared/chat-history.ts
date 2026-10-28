import { z } from 'zod';
import type { ChatMessage } from './model';

/** A page of saved message text, never a recursively expanded reference graph. */
export const chatHistoryRequestSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  cursor: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).optional().describe('nextCursor der vorherigen Seite desselben Chats. Bei geändertem Chat ohne Cursor neu beginnen.'),
  limit: z.number().int().min(1).max(30).optional().describe('Maximale Nachrichtenteile pro Seite; Standard 20.'),
  maxChars: z.number().int().min(1000).max(12000).optional().describe('Textbudget der Seite; Standard 8000 Zeichen. Lange Nachrichten werden verlustfrei über mehrere Seiten aufgeteilt.')
}).strict();

export type ChatHistoryRequest = z.infer<typeof chatHistoryRequestSchema>;
export interface ChatHistoryPart {
  messageId: string;
  index: number;
  role: ChatMessage['role'];
  timestamp: string;
  status?: ChatMessage['status'];
  text: string;
  textOffset: number;
  textEnd: number;
  textLength: number;
  messageComplete: boolean;
  emailReference?: { id: string; subject?: string };
  chatReference?: { sessionId: string; title: string };
  moduleReferences?: { moduleId: string; type: string; id: string; title: string }[];
}
export interface ChatHistoryPage {
  sessionId: string;
  title: string;
  sourceUpdatedAt: string;
  revision: string;
  observedAt: string;
  scope: 'saved_message_texts';
  references: 'metadata_only';
  untrusted: true;
  order: 'chronological';
  totalMessages: number;
  totalTextChars: number;
  startMessageIndex: number;
  startTextOffset: number;
  parts: ChatHistoryPart[];
  returnedTextChars: number;
  hasMore: boolean;
  /** True on the last page of this stable revision; earlier pages must also be read. */
  complete: boolean;
  nextCursor?: string;
}

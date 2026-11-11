import { z } from 'zod';

/** Continuation is tied to immutable source identity, never to a list position. */
export const mailTextPageRequestSchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.number().int().min(2).max(6000).default(4000)
}).strict();
export type MailTextPageRequest = z.input<typeof mailTextPageRequestSchema>;
export interface MailTextPage {
  text: string;
  offset: number;
  offsetUnit: 'UTF-16';
  returnedCharacters: number;
  totalCharacters: number;
  sourceBytes: number;
  sourceVersion: string;
  observedAt: string;
  complete: boolean;
  nextCursor?: string;
}

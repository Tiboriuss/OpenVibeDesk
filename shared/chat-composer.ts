import { z } from 'zod';
import { MAX_MODULE_REFERENCES, moduleReferenceKey, moduleReferenceSummarySchema } from './references';
import { mailSourceLocatorSchema } from './mail-source';

export const MAX_COMPOSER_TEXT = 1_000_000;
export const composerSessionId = z.string().min(1).max(128);
const revision = z.number().int().nonnegative();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/).optional();
const legacyReceipt = z.object({ text: fingerprint, mail: fingerprint, references: fingerprint, requests: fingerprint }).strict().optional();
export type ChatComposerLegacyReceipt = NonNullable<z.infer<typeof legacyReceipt>>;
const content = z.object({
  text: z.string().max(MAX_COMPOSER_TEXT),
  emailSummary: z.object({
    id: z.string().min(1).max(128), subject: z.string().max(1000), from: z.string().max(500), accountName: z.string().max(200).optional()
  }).strict().optional(),
  sessionRefId: composerSessionId.optional(),
  references: z.array(moduleReferenceSummarySchema).max(MAX_MODULE_REFERENCES)
    .refine(items => new Set(items.map(moduleReferenceKey)).size === items.length, 'Eine Referenz darf nur einmal angehängt werden.').optional()
}).strict();

export type ChatComposerContent = z.infer<typeof content>;
export interface ChatComposerSnapshot { sessionId: string; revision: number; content: ChatComposerContent; legacyReceipt?: ChatComposerLegacyReceipt; }
/** Only the host attaches verified source identity. Never accept it via composer IPC. */
export const storedChatComposerSchema = z.object({
  sessionId: composerSessionId, revision, content, legacyReceipt, mailSource: mailSourceLocatorSchema.optional(),
  forkSource: z.object({ sessionId: composerSessionId, messageId: z.string().min(1).max(128) }).strict().optional()
}).strict();
export type StoredChatComposer = z.infer<typeof storedChatComposerSchema>;
export const chatComposerWriteSchema = z.object({
  sessionId: composerSessionId, expectedRevision: revision, expectedContent: content.optional(), content, legacyReceipt
}).strict();
export type ChatComposerWrite = z.infer<typeof chatComposerWriteSchema>;
export interface ChatComposerWriteResult { applied: boolean; snapshot: ChatComposerSnapshot; }

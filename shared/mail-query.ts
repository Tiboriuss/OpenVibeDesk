import { z } from 'zod';
import { timeRangeSchema } from './time';
import type { ImapMessage } from './mail';

const text = z.string().trim().min(1).max(200).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const folder = z.string().min(1).max(1024).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const accountId = z.string().trim().min(1).max(128);

/** Shared by the Mail UI, listing, and counting. Every specified filter is AND-combined. */
export const mailFilterSchema = z.object({
  text: text.optional().describe('Suchtext in Kopfzeilen und Nachrichtentext; der Server sucht, ohne Mailtexte an das Modell zurückzugeben.'),
  from: text.optional().describe('Teil des Absenders, z. B. eine E-Mail-Adresse oder Domain.'),
  to: text.optional(),
  subject: text.optional(),
  read: z.boolean().optional().describe('false zählt oder findet nur ungelesene Nachrichten; true nur gelesene.'),
  received: timeRangeSchema.optional().describe('Empfangszeit nach IMAP-INTERNALDATE, mit lokaler Zeitzone und exklusivem Zeitraumende.')
}).strict();

export const mailQuerySortSchema = z.enum(['received_desc', 'received_asc', 'sent_desc', 'sent_asc', 'uid_desc']);
const scopeFields = {
  accountId: accountId.optional().describe('Ohne Konto gilt das aktive, sonst das zuerst eingerichtete Konto.'),
  allAccounts: z.boolean().optional().describe('Alle eingerichteten Konten berücksichtigen; nicht zusammen mit accountId.'),
  folders: z.array(folder).min(1).max(50).optional().describe('Explizite Serverordner. Ohne folders/allFolders gilt jeweils der Posteingang.'),
  allFolders: z.boolean().optional().describe('Alle auswählbaren Ordner, einschließlich Gesendet/Archiv/Spam/Papierkorb. Kopien in verschiedenen Ordnern zählen getrennt.'),
  filter: mailFilterSchema.optional()
};
function validScope(value: { accountId?: string; allAccounts?: boolean; folders?: string[]; allFolders?: boolean }): boolean {
  return !(value.accountId && value.allAccounts) && !(value.folders && value.allFolders);
}
export const mailCountSchema = z.object(scopeFields).strict().refine(validScope, 'Bitte entweder ein Konto oder alle Konten sowie entweder Ordner oder alle Ordner angeben.');
export const mailQuerySchema = z.object({
  ...scopeFields,
  sort: mailQuerySortSchema.optional().describe('Standard received_desc: tatsächlich neuester Empfang zuerst, über alle passenden Nachrichten des angegebenen Umfangs.'),
  limit: z.number().int().min(1).max(20).optional().describe('Höchstens 20 Metadaten, Standard 10. Die Trefferzahl wird separat zurückgegeben.'),
  cursor: z.string().min(1).max(8192).optional().describe('Unverändertes nextCursor der vorherigen Seite mit denselben Filtern, Konten, Ordnern und derselben Sortierung.')
}).strict().refine(validScope, 'Bitte entweder ein Konto oder alle Konten sowie entweder Ordner oder alle Ordner angeben.');

export type MailFilter = z.infer<typeof mailFilterSchema>;
export type MailQuerySort = z.infer<typeof mailQuerySortSchema>;
export type MailQueryRequest = z.infer<typeof mailQuerySchema>;
export type MailCountRequest = z.infer<typeof mailCountSchema>;

export interface MailCountResult {
  count: number;
  countExact: boolean;
  complete: boolean;
  scope: string;
  observedAt: string;
  scannedCount?: number;
  candidateCount?: number;
  warnings?: string[];
  filter?: MailFilter;
  resolvedRange?: { start: string; end: string; timeZone?: string };
}
export interface MailQueryResult extends MailCountResult {
  messages: ImapMessage[];
  hasMore: boolean;
  nextCursor?: string;
  request?: MailQueryRequest;
}

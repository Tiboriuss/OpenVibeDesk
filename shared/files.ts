import { z } from 'zod';

export const fileIdSchema = z.string().regex(/^[a-f0-9]{64}$/).describe('Stabile Datei-ID aus einer Dateiliste, Auswahl oder Dateireferenz.');
const filePath = z.string().min(1).max(4096).describe('Lokaler Ordnerpfad, absolut oder relativ zu Dokumente. ~ steht für den Benutzerordner. Alle mit den Betriebssystemrechten zugänglichen Ordner sind nutzbar.');
const cursor = z.string().min(1).max(2048).regex(/^[A-Za-z0-9_-]+$/);
export const fileListRequestSchema = z.object({
  path: filePath.optional(),
  cursor: cursor.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  query: z.string().max(200).optional().describe('Filtert Namen im gewählten Ordner, keine rekursive Suche oder Inhaltsvolltextsuche.'),
  sort: z.enum(['name', 'modified', 'size']).optional(),
  direction: z.enum(['asc', 'desc']).optional()
}).strict();
export const fileReadRequestSchema = z.object({ id: fileIdSchema, cursor: cursor.optional(), maxChars: z.number().int().min(1000).max(12000).optional() }).strict();
export const fileOpenRequestSchema = z.object({ id: fileIdSchema.optional(), path: filePath.optional() }).strict().refine(value => !(value.id && value.path), 'Entweder Datei-ID oder Ordnerpfad angeben.');
export const fileChooseRequestSchema = z.object({ kind: z.enum(['file', 'directory']).default('file') }).strict();
export type FileListRequest = z.infer<typeof fileListRequestSchema>;
export type FileReadRequest = z.infer<typeof fileReadRequestSchema>;
export type FileOpenRequest = z.infer<typeof fileOpenRequestSchema>;
export type FileChooseKind = z.infer<typeof fileChooseRequestSchema>['kind'];
export interface FileEntry { id: string; name: string; path: string; isDirectory: boolean; size: number; modifiedAt: string; }
export interface FileNavigationTarget { path: string; selectedId?: string; }
export interface FileOpenResult extends FileNavigationTarget { opened: true; }
export interface FileListingPage {
  path: string; root: string; parentPath?: string; entries: FileEntry[];
  total: number; hasMore: boolean; nextCursor?: string; complete: boolean;
  revision: string; observedAt: string; warning?: string;
}
export interface FileReadResult {
  id: string; name: string; path: string; size: number; modifiedAt: string;
  readable: boolean; format: 'text' | 'metadata_only'; reason?: string; text?: string;
  textOffset: number; textEnd: number; textLength: number; revision: string;
  hasMore: boolean; nextCursor?: string; complete: boolean; observedAt: string;
}

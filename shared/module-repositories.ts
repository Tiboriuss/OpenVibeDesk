import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const repositoryModuleIdSchema = text(80).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/).refine(value => !value.startsWith('ovd-'), 'Eingebaute Module können nicht aus Quellen ersetzt werden.');
export const repositoryVersionSchema = text(40).regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/);
/** Portable relative paths only. No URL components, hidden files or OS-specific aliases. */
export const repositoryPathSchema = text(240).refine(value => value.split('/').length <= 12 && value.split('/').every(part => /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(part) && !part.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Ein relativer, plattformübergreifender Paketpfad ist erforderlich.');
export const repositoryCatalogSchema = z.object({
  version: z.literal(1), title: text(120).optional(),
  modules: z.array(z.object({
    id: repositoryModuleIdSchema, title: text(120), description: text(400), version: repositoryVersionSchema, apiVersion: z.number().int().min(1).max(100),
    package: z.object({ path: repositoryPathSchema, files: z.array(z.object({ path: repositoryPathSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(200) }).strict()
  }).strict()).max(200)
}).strict().superRefine((catalog, context) => {
  if (new Set(catalog.modules.map(item => item.id)).size !== catalog.modules.length) context.addIssue({ code: 'custom', message: 'Der Katalog enthält doppelte Modul-IDs.' });
  for (const module of catalog.modules) {
    const names = module.package.files.map(file => file.path.toLowerCase());
    if (!names.includes('module.json') || new Set(names).size !== names.length || names.some(name => names.some(other => other !== name && other.startsWith(name + '/')))) context.addIssue({ code: 'custom', message: 'Paketdateien benötigen eindeutige Pfade und module.json.' });
  }
});
export type RepositoryCatalog = z.infer<typeof repositoryCatalogSchema>;
export type RepositoryCatalogModule = RepositoryCatalog['modules'][number];

export const moduleRepositoryInputSchema = z.object({
  id: z.string().uuid().optional(), title: z.string().trim().max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value)), url: text(2048),
  token: z.string().max(4096).refine(value => !/[\s\u0000-\u001f\u007f]/.test(value)).optional(), removeToken: z.boolean().optional()
}).strict().refine(value => !(value.token && value.removeToken), 'Token ersetzen oder entfernen, nicht beides.');
export type ModuleRepositoryInput = z.infer<typeof moduleRepositoryInputSchema>;
export const repositoryInstallInputSchema = z.object({ sourceId: z.string().uuid(), moduleId: repositoryModuleIdSchema, version: repositoryVersionSchema }).strict();
export type RepositoryInstallInput = z.infer<typeof repositoryInstallInputSchema>;
export interface ModuleRepositorySource {
  id: string; title: string; url: string; kind: 'github' | 'https'; tokenConfigured: boolean;
  status: 'unloaded' | 'loading' | 'ready' | 'error'; error?: string; checkedAt?: string; moduleCount: number;
}
export interface RepositoryModule {
  sourceId: string; id: string; title: string; description: string; version: string; apiVersion: number;
  installedVersion?: string; status: 'available' | 'installed' | 'update' | 'conflict' | 'incompatible'; reason?: string;
}
export interface RepositoryState { sources: ModuleRepositorySource[]; modules: RepositoryModule[]; busy: boolean; error?: string; }
export interface RepositoryInstallResult { moduleId: string; version: string; status: 'approval_required' | 'disabled'; }

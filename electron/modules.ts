import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ModuleInfo, ModuleListing, ModuleManifest, ModuleQuery, ModuleSummary } from '../shared/modules';

export const MODULE_API_VERSION = 1;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_MODULE_BYTES = 16 * 1024 * 1024;
const MAX_MODULE_FILES = 200;
const text = (max: number) => z.string().trim().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const moduleId = text(80).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);
const localId = text(100).regex(/^[a-z][a-z0-9_.-]*$/);
const capabilityName = text(128).regex(/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/);
const icon = z.enum(['mail', 'file', 'folder', 'chat', 'settings', 'calendar', 'grid']);
const relativeEntry = text(240).refine(value => !path.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..'), 'Entry muss ein relativer Modulpfad sein.');
const view = z.object({ id: localId, title: text(120), renderer: localId.optional(), entry: relativeEntry.optional(), icon: icon.optional(), order: z.number().int().min(-1000).max(1000).optional() }).strict().refine(value => Number(!!value.renderer) + Number(!!value.entry) === 1, 'Genau renderer oder entry angeben.');
const settings = z.object({ id: localId, title: text(120), description: text(400).optional(), keywords: z.array(text(40)).max(30).optional(), renderer: localId.optional(), entry: relativeEntry.optional(), icon: icon.optional(), order: z.number().int().min(-1000).max(1000).optional() }).strict().refine(value => Number(!!value.renderer) + Number(!!value.entry) === 1, 'Genau renderer oder entry angeben.');

/** Basic schemas only: tool definitions never resolve remote references or execute code. */
function safeToolSchema(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  let nodes = 0;
  const visit = (node: unknown, depth: number): boolean => {
    if (++nodes > 800 || depth > 12) return false;
    if (!node || typeof node !== 'object') return typeof node !== 'function';
    if (Array.isArray(node)) return node.length <= 100 && node.every(item => visit(item, depth + 1));
    return Object.entries(node as Record<string, unknown>).every(([key, item]) => !['$ref', '$dynamicRef', '$recursiveRef', '__proto__', 'constructor', 'prototype'].includes(key) && visit(item, depth + 1));
  };
  try { return (value as Record<string, unknown>).type === 'object' && JSON.stringify(value).length <= 12000 && visit(value, 0); } catch { return false; }
}
const tool = z.object({ name: capabilityName, label: text(120).optional(), description: text(500), parameters: z.record(z.string(), z.unknown()).refine(safeToolSchema, 'Begrenztes Objekt-JSON-Schema ohne Referenzen erforderlich.'), confirmation: z.object({ title: text(120).optional(), message: text(1000) }).strict().optional() }).strict();
export const moduleManifestSchema = z.object({
  apiVersion: z.literal(1), id: moduleId, title: text(120), version: text(40).regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/), description: text(400),
  keywords: z.array(text(40)).max(50).optional(), required: z.boolean().optional(), capabilities: z.array(capabilityName).max(100).default([]), permissions: z.array(text(100)).max(30).default([]),
  runtime: z.discriminatedUnion('type', [z.object({ type: z.literal('host-adapter'), adapter: localId }).strict(), z.object({ type: z.literal('process'), entry: relativeEntry }).strict()]),
  tools: z.array(tool).max(64).optional(),
  contributions: z.object({ views: z.array(view).max(20).default([]), navigation: z.array(z.object({ id: localId, title: text(120), view: localId, icon: icon.optional(), order: z.number().int().min(-1000).max(1000).optional() }).strict()).max(20).default([]), settings: z.array(settings).max(20).default([]), referenceTypes: z.array(z.object({ id: localId, title: text(120), snapshotTool: capabilityName.optional(), usage: z.enum(['context', 'instructions']).optional() }).strict()).max(20).optional() }).strict().default({ views: [], navigation: [], settings: [] })
}).strict();

export interface ModuleDiscoveryOptions {
  builtInRoots?: readonly string[];
  userRoots?: readonly string[];
  trustedAdapters?: ReadonlySet<string>;
  availableCapabilities?: ReadonlySet<string>;
  disabledIds?: ReadonlySet<string>;
}
/** Host-only runtime metadata. Never forward rootPath or entryPath to model context. */
export interface ModuleRuntimeRecord { module: ModuleInfo; rootPath: string; fingerprint: string; entryPath?: string; viewPaths: Readonly<Record<string, string>>; settingsPaths: Readonly<Record<string, string>>; }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase('de-DE');
const querySchema = z.object({ query: z.string().trim().max(200).optional(), offset: z.number().int().min(0).max(1000).optional(), limit: z.number().int().min(1).max(20).optional() }).strict();

async function regularFile(file: string): Promise<Buffer> {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Moduleinträge müssen reguläre Dateien sein.');
  if (stat.size > MAX_MODULE_BYTES) throw new Error('Eine Moduldatei überschreitet die Größenbegrenzung.');
  return fs.readFile(file);
}
async function scanFingerprint(directory: string): Promise<string> {
  let bytes = 0, files = 0;
  const hash = createHash('sha256');
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 12) throw new Error('Das Modul enthält zu viele verschachtelte Verzeichnisse.');
    const entries = (await fs.readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue;
      const full = path.join(current, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw new Error('Module dürfen keine symbolischen Dateiverweise enthalten.');
      if (stat.isDirectory()) { await walk(full, depth + 1); continue; }
      if (!stat.isFile() || ++files > MAX_MODULE_FILES) throw new Error('Das Modul enthält ungültige oder zu viele Dateien.');
      if ((bytes += stat.size) > MAX_MODULE_BYTES) throw new Error('Das Modul ist größer als 16 MB; Abhängigkeiten bitte bündeln.');
      const content = await regularFile(full);
      hash.update(path.relative(directory, full).split(path.sep).join('/')).update('\0').update(content).update('\0');
    }
  };
  await walk(directory, 0);
  return hash.digest('hex');
}
async function resolveModuleFile(directory: string, entry: string): Promise<string> {
  const parsed = relativeEntry.safeParse(entry);
  if (!parsed.success) throw new Error('Ungültiger Moduleinstiegspunkt.');
  const target = path.join(directory, entry);
  await regularFile(target);
  const resolved = await fs.realpath(target), root = await fs.realpath(directory);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Der Moduleinstieg liegt außerhalb seines Moduls.');
  return resolved;
}
function validateContributions(manifest: ModuleManifest): void {
  const sets = [manifest.capabilities, (manifest.tools ?? []).map(item => item.name), manifest.contributions.views.map(item => item.id), manifest.contributions.navigation.map(item => item.id), manifest.contributions.settings.map(item => item.id), (manifest.contributions.referenceTypes ?? []).map(item => item.id)];
  if (sets.some(values => new Set(values).size !== values.length)) throw new Error('Das Modul enthält doppelte IDs oder Funktionen.');
  const views = new Set(manifest.contributions.views.map(item => item.id));
  if (manifest.contributions.navigation.some(item => !views.has(item.view))) throw new Error('Ein Moduleintrag verweist auf eine unbekannte Ansicht.');
  if (manifest.runtime.type === 'process') {
    const htmlIds = [...manifest.contributions.views, ...manifest.contributions.settings].map(item => item.id);
    if (new Set(htmlIds).size !== htmlIds.length) throw new Error('Ansichten und Einstellungen benötigen unterschiedliche lokale IDs.');
    if (!(manifest.tools?.length)) throw new Error('Ein Prozessmodul muss mindestens eine Funktion beschreiben.');
    const names = manifest.tools.map(item => item.name);
    if (names.some(name => !name.startsWith(manifest.id + '.'))) throw new Error('Modulfunktionen müssen mit der eigenen Modul-ID beginnen.');
    if (manifest.capabilities.some(name => !names.includes(name)) || names.some(name => !manifest.capabilities.includes(name))) throw new Error('Funktionen und deklarierte Capabilities des Prozessmoduls stimmen nicht überein.');
    if (manifest.contributions.views.some(item => !item.entry) || manifest.contributions.settings.some(item => !item.entry)) throw new Error('Fremdmodulansichten benötigen eigene HTML-Einstiege.');
    for (const reference of manifest.contributions.referenceTypes ?? []) {
      if (reference.usage === 'instructions' && !reference.snapshotTool) throw new Error('Anweisungsreferenzen benötigen eine eigene Snapshot-Funktion.');
      if (reference.snapshotTool) {
        const snapshot = manifest.tools.find(item => item.name === reference.snapshotTool);
        if (!snapshot || !snapshot.name.startsWith(manifest.id + '.') || snapshot.confirmation) throw new Error('Referenz-Snapshots benötigen eine eigene deklarierte Lesefunktion ohne Aktionsbestätigung.');
      }
    }
  }
}

/** File discovery is metadata-only; activation and code execution remain explicit host decisions. */
export class ModuleRegistry {
  private readonly records = new Map<string, ModuleRuntimeRecord>();
  private readonly issues: ModuleInfo[] = [];
  private readonly capabilityOwners = new Map<string, string>();

  async discover(options: ModuleDiscoveryOptions = {}): Promise<ModuleInfo[]> {
    this.records.clear(); this.issues.length = 0; this.capabilityOwners.clear();
    for (const [source, roots] of [['builtin', options.builtInRoots ?? []], ['user', options.userRoots ?? []]] as const) {
      for (const root of roots) {
        let entries: import('node:fs').Dirent[];
        try { entries = await fs.readdir(root, { withFileTypes: true }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.issues.push({ id: `invalid-root-${this.issues.length + 1}`, title: 'Modulverzeichnis', description: '', apiVersion: 0, version: '', source, required: false, status: 'invalid', reason: 'Das Modulverzeichnis konnte nicht gelesen werden.' }); continue; }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (entry.name.startsWith('.') || !entry.isDirectory() || entry.isSymbolicLink()) continue;
          await this.readModule(path.join(root, entry.name), source, options);
        }
      }
    }
    return this.listModules();
  }

  private async readModule(directory: string, source: 'builtin' | 'user', options: ModuleDiscoveryOptions): Promise<void> {
    let raw: unknown;
    let manifest: ModuleManifest | undefined;
    const fallbackId = `invalid-${source}-${this.issues.length + 1}`;
    try {
      const manifestFile = path.join(directory, 'module.json');
      const stat = await fs.lstat(manifestFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) throw new Error('module.json muss eine reguläre Datei mit höchstens 64 KB sein.');
      raw = JSON.parse((await fs.readFile(manifestFile)).toString('utf8'));
      if (raw && typeof raw === 'object' && 'apiVersion' in raw && (raw as { apiVersion: unknown }).apiVersion !== MODULE_API_VERSION) {
        const title = 'title' in raw && typeof raw.title === 'string' ? raw.title.slice(0, 120) : path.basename(directory);
        this.issues.push({ id: fallbackId, title, description: '', apiVersion: Number((raw as { apiVersion: unknown }).apiVersion) || 0, version: '', source, required: false, status: 'incompatible', reason: 'Diese Modul-API-Version wird von OVD nicht unterstützt.' }); return;
      }
      const parsed = moduleManifestSchema.safeParse(raw);
      if (!parsed.success) throw new Error('Das Modulmanifest entspricht nicht dem OVD-Modulvertrag.');
      manifest = parsed.data;
      if (manifest.runtime.type === 'process' && !manifest.capabilities.length) manifest.capabilities = (manifest.tools ?? []).map(item => item.name);
      validateContributions(manifest);
      if (this.records.has(manifest.id)) throw new Error('Diese Modul-ID ist bereits registriert.');
      if (source === 'user' && (manifest.required || manifest.id.startsWith('ovd-') || manifest.runtime.type === 'host-adapter')) throw new Error('Ein Fremdmodul darf keine eingebauten Module oder Hostadapter ersetzen.');
      for (const name of manifest.capabilities) if (this.capabilityOwners.has(name)) throw new Error(`Die Funktion ${name} gehört bereits zu einem anderen Modul.`);
      const info: ModuleInfo = { id: manifest.id, title: manifest.title, description: manifest.description, version: manifest.version, apiVersion: manifest.apiVersion, required: source === 'builtin' && manifest.required === true, source, status: 'ready', manifest };
      const viewPaths: Record<string, string> = {}, settingsPaths: Record<string, string> = {};
      let entryPath: string | undefined;
      if (manifest.runtime.type === 'process') {
        entryPath = await resolveModuleFile(directory, manifest.runtime.entry);
        for (const view of manifest.contributions.views) if (view.entry) viewPaths[view.id] = await resolveModuleFile(directory, view.entry);
        for (const settings of manifest.contributions.settings) if (settings.entry) settingsPaths[settings.id] = await resolveModuleFile(directory, settings.entry);
        info.status = 'approval_required'; info.reason = 'Dieses Modul wurde erkannt. Seine Ausführung benötigt eine ausdrückliche Freigabe.';
      } else {
        if (options.trustedAdapters && !options.trustedAdapters.has(manifest.runtime.adapter)) { info.status = 'unsupported'; info.reason = 'Für dieses Modul ist kein passender vertrauenswürdiger Hostadapter verfügbar.'; }
        if (options.availableCapabilities && manifest.capabilities.some(name => !options.availableCapabilities!.has(name))) { info.status = 'unsupported'; info.reason = 'Mindestens eine deklarierte Modulfunktion ist in dieser OVD-Version nicht angebunden.'; }
      }
      if (options.disabledIds?.has(manifest.id) && !info.required && ['ready', 'approval_required'].includes(info.status)) { info.status = 'disabled'; info.reason = 'Das Modul ist deaktiviert.'; }
      const fingerprint = await scanFingerprint(directory);
      const record: ModuleRuntimeRecord = { module: info, rootPath: directory, fingerprint, ...(entryPath ? { entryPath } : {}), viewPaths, settingsPaths };
      this.records.set(manifest.id, record);
      for (const name of manifest.capabilities) this.capabilityOwners.set(name, manifest.id);
    } catch (error) {
      this.issues.push({ id: fallbackId, title: manifest?.title ?? path.basename(directory).slice(0, 120), description: '', apiVersion: manifest?.apiVersion ?? 0, version: manifest?.version ?? '', source, required: false, status: 'invalid', reason: error instanceof SyntaxError ? 'module.json enthält ungültiges JSON.' : error instanceof Error ? error.message.slice(0, 500) : 'Das Modul konnte nicht geladen werden.' });
    }
  }

  listModules(): ModuleInfo[] { return copy([...this.records.values()].map(record => record.module).concat(this.issues)); }
  listSummaries(): ModuleSummary[] { return [...this.records.values()].filter(record => record.module.status === 'ready').map(({ module }) => ({ id: module.id, title: module.title, description: module.description.slice(0, 240) })); }
  findModules(rawOptions: ModuleQuery = {}): ModuleListing {
    const options = querySchema.parse(rawOptions), query = fold(options.query ?? ''), terms = query.split(/[\s._-]+/).filter(Boolean);
    const available = [...this.records.values()].filter(record => record.module.status === 'ready').map(record => {
      const { module } = record, text = fold([module.title, module.description, module.id, ...(module.manifest?.keywords ?? [])].join(' '));
      return { record, exact: fold(module.id) === query || fold(module.title) === query, score: terms.filter(term => text.includes(term)).length };
    }).filter(({ score }) => !terms.length || score > 0).sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score).map(({ record }) => record);
    const offset = options.offset ?? 0, limit = options.limit ?? 10;
    const hasMore = offset + limit < available.length;
    return { modules: available.slice(offset, offset + limit).map(({ module }) => ({ id: module.id, title: module.title, description: module.description.slice(0, 240) })), hasMore, ...(hasMore ? { nextOffset: offset + limit } : {}) };
  }
  getModule(id: string): ModuleInfo | undefined { const found = this.records.get(id)?.module; return found ? copy(found) : undefined; }
  getModuleCapabilityNames(id: string): string[] { const found = this.records.get(id)?.module; if (!found || found.status !== 'ready') throw new Error('Das Modul ist nicht verfügbar oder noch nicht freigegeben.'); return [...(found.manifest?.capabilities ?? [])]; }
  ownerOf(capability: string): ModuleInfo | undefined { const id = this.capabilityOwners.get(capability); return id ? this.getModule(id) : undefined; }
  getRuntimeRecord(id: string): ModuleRuntimeRecord | undefined { const found = this.records.get(id); return found ? { ...found, module: copy(found.module), viewPaths: { ...found.viewPaths }, settingsPaths: { ...found.settingsPaths } } : undefined; }
  /** Inspect downloaded files without registering or executing them. */
  async inspectUserModule(directory: string, expectedId: string): Promise<ModuleRuntimeRecord> {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Das Modulpaket muss ein reguläres Verzeichnis sein.');
    const candidate = new ModuleRegistry();
    await candidate.readModule(directory, 'user', {});
    const record = candidate.getRuntimeRecord(expectedId);
    if (!record || record.module.status !== 'approval_required') throw new Error(candidate.listModules()[0]?.reason ?? 'Die Modul-ID stimmt nicht mit dem Katalog überein.');
    this.checkUserReplacement(record);
    return record;
  }
  private checkUserReplacement(record: ModuleRuntimeRecord): void {
    const current = this.records.get(record.module.id);
    if (record.module.source !== 'user' || record.module.required || record.module.id.startsWith('ovd-') || record.module.manifest?.runtime.type !== 'process' || current?.module.source === 'builtin') throw new Error('Eingebaute Module können nicht durch ein Repository ersetzt werden.');
    for (const name of record.module.manifest.capabilities) {
      const owner = this.capabilityOwners.get(name);
      if (owner && owner !== record.module.id) throw new Error('Eine Modulfunktion gehört bereits zu einem anderen installierten Modul.');
    }
  }
  /** Host-only, synchronous publication after a verified filesystem transaction. */
  replaceUserRecord(record: ModuleRuntimeRecord): void {
    this.checkUserReplacement(record);
    const stored = { ...record, module: copy(record.module), viewPaths: { ...record.viewPaths }, settingsPaths: { ...record.settingsPaths } };
    for (const [name, owner] of this.capabilityOwners) if (owner === record.module.id) this.capabilityOwners.delete(name);
    this.records.set(record.module.id, stored);
    for (const name of record.module.manifest!.capabilities) this.capabilityOwners.set(name, record.module.id);
  }
  async verifyUnchanged(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record || await scanFingerprint(record.rootPath) !== record.fingerprint) throw new Error('Das Modul wurde geändert. Bitte OVD neu starten und die neue Version freigeben.');
  }
  async activate(id: string, approvedFingerprint: string): Promise<ModuleInfo> {
    const record = this.records.get(id);
    if (!record) throw new Error('Modul nicht gefunden.');
    if (record.module.status !== 'approval_required') throw new Error('Dieses Modul wartet nicht auf eine Freigabe.');
    if (approvedFingerprint !== record.fingerprint || await scanFingerprint(record.rootPath) !== approvedFingerprint) throw new Error('Das Modul wurde seit der Freigabeprüfung geändert. Bitte neu laden und prüfen.');
    record.module.status = 'ready'; delete record.module.reason;
    return copy(record.module);
  }
  disable(id: string, reason = 'Das Modul ist deaktiviert.'): void {
    const record = this.records.get(id); if (!record) return;
    if (record.module.required) throw new Error('Das Pflichtmodul kann nicht deaktiviert werden.');
    if (!['ready', 'approval_required', 'disabled'].includes(record.module.status)) throw new Error('Ein fehlerhaftes oder inkompatibles Modul kann nicht aktiviert oder deaktiviert werden.');
    record.module.status = 'disabled'; record.module.reason = reason.slice(0, 500);
  }
  enable(id: string): ModuleInfo {
    const record = this.records.get(id);
    if (!record || record.module.status !== 'disabled') throw new Error('Dieses Modul kann nicht aktiviert werden.');
    const processModule = record.module.manifest?.runtime.type === 'process';
    record.module.status = processModule ? 'approval_required' : 'ready';
    if (processModule) record.module.reason = 'Die Ausführung benötigt eine ausdrückliche Freigabe.';
    else delete record.module.reason;
    return copy(record.module);
  }
  fail(id: string, reason: string): void { const record = this.records.get(id); if (record) { record.module.status = 'invalid'; record.module.reason = reason.slice(0, 500); } }
}

import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { fileListRequestSchema, fileReadRequestSchema, type FileEntry, type FileListingPage, type FileListRequest, type FileReadRequest, type FileReadResult } from '../../../shared/files';

const PAGE_LIMIT = 28_000;
const TEXT_LIMIT = 2 * 1024 * 1024;
const pathSchema = z.string().min(1).max(4096);
// Read the former grants file to retain existing resource IDs. These legacy
// fields no longer constrain file access; only OS permissions apply.
const grantsSchema = z.object({ version: z.literal(1), files: z.array(pathSchema).max(1000), directories: z.array(pathSchema).max(1000), references: z.array(pathSchema).max(2000).default([]) }).strict();
const listCursorSchema = z.tuple([z.literal(1), z.literal('list'), z.string().regex(/^[a-f0-9]{64}$/), z.number().int().min(0)]);
const readCursorSchema = z.tuple([z.literal(1), z.literal('read'), z.string().regex(/^[a-f0-9]{64}$/), z.string().regex(/^[a-f0-9]{64}$/), z.number().int().min(0)]);
const textExtensions = new Set(['.txt', '.text', '.md', '.markdown', '.mdx', '.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.xml', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.rs', '.go', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh', '.zsh', '.bash', '.fish', '.ps1', '.sql', '.r', '.swift', '.kt', '.vue', '.svelte', '.ini', '.conf', '.cfg', '.toml', '.log', '.tex', '.bib', '.svg', '.env', '.properties', '.gitignore', '.gitattributes']);
const textNames = new Set(['readme', 'license', 'licence', 'makefile', 'dockerfile', '.gitignore', '.gitattributes', '.editorconfig', '.env']);
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const stamp = (value: { mtimeMs: number; size: number; dev: number | bigint; ino: number | bigint }) => `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}`;
const makeCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function parseCursor<T>(raw: string, schema: z.ZodType<T>): T {
  try { return schema.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))); }
  catch { throw new Error('Ungültiger Dateicursor. Bitte ohne Cursor erneut beginnen.'); }
}
function characterEnd(text: string, start: number, length: number): number {
  let end = Math.min(text.length, start + length);
  if (end > start && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return end;
}

/** File access is resolved here once for both the UI and the assistant. */
export class FilesService {
  private root = '';
  private grants: z.infer<typeof grantsSchema> = { version: 1, files: [], directories: [], references: [] };
  private readonly paths = new Map<string, string>();
  private writes: Promise<unknown> = Promise.resolve();
  private grantsReadable = true;
  constructor(private readonly options: { documents: string; dataRoot: string; selectedLocalFiles: Set<string> }) {}

  async initialize(): Promise<void> {
    this.root = await fs.realpath(this.options.documents).catch(() => path.resolve(this.options.documents));
    await fs.mkdir(this.options.dataRoot, { recursive: true });
    try { this.grants = grantsSchema.parse(JSON.parse(await fs.readFile(path.join(this.options.dataRoot, 'grants.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.grantsReadable = false; }
    for (const known of [...this.grants.files, ...this.grants.references]) this.paths.set(this.id(known), known);
    for (const known of this.grants.files) this.options.selectedLocalFiles.add(known);
  }
  documents(): string { return this.root; }
  id(canonicalPath: string): string { return digest(`ovd-files\0${canonicalPath}`); }
  async resolve(requested?: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const expanded = requested === '~' ? homedir() : requested?.startsWith('~/') || requested?.startsWith('~\\') ? path.join(homedir(), requested.slice(2)) : requested;
    const canonical = await fs.realpath(expanded ? path.resolve(this.root, expanded) : this.root);
    signal?.throwIfAborted();
    return canonical;
  }
  async pathForId(id: string, signal?: AbortSignal): Promise<string> {
    const known = this.paths.get(id);
    if (!known) throw new Error('Datei-ID nicht bekannt. Bitte den Ordner erneut anzeigen oder die Datei auswählen.');
    const canonical = await this.resolve(known, signal);
    if (this.id(canonical) !== id) throw new Error('Das Dateiziel hat sich geändert. Bitte erneut auswählen.');
    return canonical;
  }
  async entry(requested: string, signal?: AbortSignal): Promise<FileEntry> {
    const canonical = await this.resolve(requested, signal), stat = await fs.stat(canonical);
    signal?.throwIfAborted();
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('Dieser Eintrag ist keine reguläre Datei und kein Ordner.');
    const id = this.id(canonical);
    this.paths.set(id, canonical);
    if (stat.isFile()) this.options.selectedLocalFiles.add(canonical);
    return { id, name: path.basename(canonical), path: canonical, isDirectory: stat.isDirectory(), size: stat.isDirectory() ? 0 : stat.size, modifiedAt: stat.mtime.toISOString() };
  }
  private write(update: (current: z.infer<typeof grantsSchema>) => z.infer<typeof grantsSchema>): Promise<void> {
    const work = this.writes.then(async () => {
      if (!this.grantsReadable) throw new Error('Die gespeicherten Dateireferenzen konnten nicht gelesen werden. Ihre Datei wurde nicht überschrieben.');
      const next = grantsSchema.parse(update(this.grants));
      const target = path.join(this.options.dataRoot, 'grants.json'), temporary = `${target}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await fs.rename(temporary, target);
      this.grants = next;
    });
    this.writes = work.catch(() => {});
    return work;
  }
  async selectPath(requested: string, kind: 'file' | 'directory', signal?: AbortSignal): Promise<FileEntry> {
    const canonical = await fs.realpath(requested), stat = await fs.stat(canonical);
    signal?.throwIfAborted();
    if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new Error('Bitte den passenden Datei- oder Ordnertyp auswählen.');
    if (kind === 'file') this.options.selectedLocalFiles.add(canonical);
    return this.entry(canonical, signal);
  }
  async rememberReference(id: string, signal?: AbortSignal): Promise<FileEntry> {
    const canonical = await this.pathForId(id, signal), entry = await this.entry(canonical, signal);
    if (entry.isDirectory) throw new Error('Bitte eine Datei statt eines Ordners referenzieren.');
    if (!this.grants.references.includes(canonical)) await this.write(current => ({ ...current, references: [...new Set([...current.references, canonical])].slice(-2000) }));
    return entry;
  }
  async list(rawRequest: FileListRequest = {}, signal?: AbortSignal): Promise<FileListingPage> {
    const request = fileListRequestSchema.parse(rawRequest);
    signal?.throwIfAborted();
    const directory = await this.resolve(request.path, signal);
    if (!(await fs.stat(directory)).isDirectory()) throw new Error('Bitte einen Ordnerpfad angeben.');
    const names = await fs.readdir(directory), entries: FileEntry[] = [];
    let skipped = 0;
    // Avoid unbounded simultaneous stat calls for a large directory.
    for (let offset = 0; offset < names.length; offset += 32) {
      signal?.throwIfAborted();
      const batch = await Promise.all(names.slice(offset, offset + 32).map(name => this.entry(path.join(directory, name), signal).catch(error => { if (signal?.aborted) throw error; skipped++; return undefined; })));
      entries.push(...batch.filter((item): item is FileEntry => !!item));
    }
    const query = (request.query ?? '').toLocaleLowerCase(), sort = request.sort ?? 'name', direction = request.direction === 'desc' ? -1 : 1;
    const filtered = [...new Map(entries.map(entry => [entry.id, entry])).values()].filter(entry => !query || entry.name.toLocaleLowerCase().includes(query)).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || direction * (sort === 'size' ? a.size - b.size : sort === 'modified' ? Date.parse(a.modifiedAt) - Date.parse(b.modifiedAt) : a.name.localeCompare(b.name)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const revision = digest(JSON.stringify({ directory, query, sort, direction, entries: filtered }));
    let offset = 0;
    if (request.cursor) {
      const decoded = parseCursor(request.cursor, listCursorSchema);
      if (decoded[2] !== revision) throw new Error('Ordnerinhalt oder Filter wurden geändert. Bitte ohne Cursor neu beginnen.');
      offset = decoded[3];
      if (offset >= filtered.length) throw new Error('Ungültige Ordnerposition. Bitte ohne Cursor neu beginnen.');
    }
    const root = path.parse(directory).root, parent = path.dirname(directory);
    const result: FileListingPage = { path: directory, root, ...(parent !== directory ? { parentPath: parent } : {}), entries: [], total: filtered.length, hasMore: false, complete: false, revision, observedAt: new Date().toISOString(), ...(skipped ? { warning: `${skipped} nicht zugängliche Einträge wurden ausgelassen.` } : {}) };
    let next = offset;
    for (; next < filtered.length && result.entries.length < (request.limit ?? 50); next++) {
      const candidate = { ...result, entries: [...result.entries, filtered[next]], hasMore: true, nextCursor: makeCursor([1, 'list', revision, next + 1]) };
      if (JSON.stringify(candidate).length > PAGE_LIMIT) break;
      result.entries.push(filtered[next]);
    }
    result.hasMore = next < filtered.length;
    result.complete = !result.hasMore;
    if (result.hasMore && !result.entries.length) throw new Error('Die Pfad- und Eintragsmetadaten sind für eine Dateiseite zu groß. Bitte einen kürzeren Ordnerpfad wählen.');
    if (result.hasMore) result.nextCursor = makeCursor([1, 'list', revision, next]);
    return result;
  }
  async read(rawRequest: FileReadRequest, signal?: AbortSignal): Promise<FileReadResult> {
    const request = fileReadRequestSchema.parse(rawRequest), canonical = await this.pathForId(request.id, signal);
    const handle = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Dieser Eintrag ist keine reguläre Datei.');
      // Recheck the opened file so concurrent replacements cannot change its identity.
      const currentPath = await this.resolve(canonical, signal), currentStat = await fs.stat(currentPath);
      if (currentPath !== canonical || stamp(currentStat) !== stamp(stat)) throw new Error('Die Datei wurde während des Öffnens geändert. Bitte erneut versuchen.');
      const name = path.basename(canonical), permittedText = textExtensions.has(path.extname(name).toLocaleLowerCase()) || textNames.has(name.toLocaleLowerCase());
      let reason = !permittedText ? 'Für dieses Dateiformat ist noch kein Textleser verfügbar; nur Metadaten werden bereitgestellt.' : stat.size > TEXT_LIMIT ? 'Diese Textdatei ist größer als 2 MiB; nur Metadaten werden bereitgestellt.' : '';
      let text: string | undefined, bytes: Buffer | undefined;
      if (!reason) {
        const buffer = Buffer.alloc(TEXT_LIMIT + 1);
        let length = 0;
        while (length < buffer.length) {
          signal?.throwIfAborted();
          const next = await handle.read(buffer, length, buffer.length - length, length);
          if (!next.bytesRead) break;
          length += next.bytesRead;
        }
        bytes = buffer.subarray(0, length);
        signal?.throwIfAborted();
        if (bytes.length > TEXT_LIMIT || stamp(await handle.stat()) !== stamp(stat)) throw new Error('Die Datei wurde beim Lesen geändert. Bitte erneut versuchen.');
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); if (text.includes('\0')) throw new Error('binary'); }
        catch { reason = 'Die Datei enthält kein unterstütztes UTF-8-Textformat; nur Metadaten werden bereitgestellt.'; }
      }
      const revision = digest(`${canonical}\0${stamp(stat)}\0${bytes ? digest(bytes) : ''}`);
      const base: FileReadResult = { id: request.id, name, path: canonical, size: stat.size, modifiedAt: stat.mtime.toISOString(), readable: text !== undefined && !reason, format: text !== undefined && !reason ? 'text' : 'metadata_only', textOffset: 0, textEnd: 0, textLength: text?.length ?? 0, revision, hasMore: false, complete: true, observedAt: new Date().toISOString() };
      if (reason || text === undefined) {
        if (request.cursor) throw new Error('Die Datei ist nicht mehr als Text lesbar. Bitte ohne Cursor erneut beginnen.');
        return { ...base, reason };
      }
      let offset = 0;
      if (request.cursor) {
        const decoded = parseCursor(request.cursor, readCursorSchema);
        if (decoded[2] !== request.id) throw new Error('Dieser Cursor gehört zu einer anderen Datei.');
        if (decoded[3] !== revision) throw new Error('Die Datei wurde seit der ersten Seite geändert. Bitte ohne Cursor erneut beginnen.');
        offset = decoded[4];
        if (offset >= text.length) throw new Error('Ungültige Textposition. Bitte ohne Cursor erneut beginnen.');
      }
      const maxChars = Math.min(request.maxChars ?? 8000, 12000);
      let end = characterEnd(text, offset, maxChars);
      const pageAt = (end: number): FileReadResult => ({ ...base, text: text!.slice(offset, end), textOffset: offset, textEnd: end, hasMore: end < text!.length, complete: end === text!.length, ...(end < text!.length ? { nextCursor: makeCursor([1, 'read', request.id, revision, end]) } : {}) });
      if (JSON.stringify(pageAt(end)).length > PAGE_LIMIT) {
        let low = 0, high = end - offset;
        while (low < high) { const middle = Math.ceil((low + high) / 2); if (JSON.stringify(pageAt(characterEnd(text, offset, middle))).length <= PAGE_LIMIT) low = middle; else high = middle - 1; }
        end = characterEnd(text, offset, low);
      }
      if (end === offset && offset < text.length) throw new Error('Die Dateiseite konnte nicht innerhalb des Textbudgets gelesen werden.');
      return pageAt(end);
    } finally { await handle.close(); }
  }
}

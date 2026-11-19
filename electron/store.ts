import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import type { WorkspaceState } from '../shared/model';
import { decodeWorkspaceSnapshot, WorkspaceOpenError } from './workspace-snapshot';
export { WorkspaceOpenError } from './workspace-snapshot';
import { moduleEventPublicationSchema, type ModuleEventDelivery, type ModuleEventGrant, type ModuleEventPublication, type ModuleEventQueueStatus, type ModuleEventRecipient } from '../shared/module-events';
import { acknowledgeStoredModuleEvent, dropStoredModuleEvents, failStoredModuleEvent, initializeModuleEventStore, validateModuleEventStore, insertModuleEvents, moduleEventGrantsNeedReconciliation, readModuleEventQueueStatus, readPendingModuleEvents, reconcileStoredModuleEventGrants } from './module-event-store';

let db: Database;
let filePath: string;
let writeQueue = Promise.resolve();
let openDatabase: (bytes?: Uint8Array) => Database;
let storageFault: Error | undefined;

const createWorkspaceTable = 'CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)';

async function pathEntry(file: string) {
  try { return await fs.lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new WorkspaceOpenError('unreadable');
  }
}

async function readWorkspaceImage(requireExisting: boolean): Promise<Buffer | undefined> {
  const dir = path.dirname(filePath);
  if (!requireExisting) {
    try { await fs.mkdir(dir, { recursive: true }); }
    catch { throw new WorkspaceOpenError('unreadable'); }
  }
  // sql.js reads a single immutable image. An outstanding journal may contain
  // committed pages or recovery data which that image cannot represent.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (await pathEntry(filePath + suffix)) throw new WorkspaceOpenError('sidecar');
  }
  const stat = await pathEntry(filePath);
  if (!stat) {
    if (requireExisting) throw new WorkspaceOpenError('missing');
    for (const marker of ['workspace.sqlite.tmp', 'operation-journal/operations.json', 'ovd-bar-position.json', 'credentials/vault.json', 'module-settings.json', 'module-repositories.json']) {
      if (await pathEntry(path.join(dir, marker))) throw new WorkspaceOpenError('missing');
    }
    return undefined;
  }
  if (!stat.isFile()) throw new WorkspaceOpenError('unreadable');
  try { return await fs.readFile(filePath); }
  catch { throw new WorkspaceOpenError('unreadable'); }
}

function readWorkspaceRow(candidate: Database): WorkspaceState | null {
  const rows = candidate.exec("SELECT value FROM app_state WHERE key = 'workspace'")[0]?.values;
  if (!rows?.length) return null;
  if (rows.length !== 1) throw new WorkspaceOpenError('invalid');
  return decodeWorkspaceSnapshot(rows[0][0]);
}

function tableLayout(candidate: Database, table: string): string {
  // Only fixed internal table names reach the PRAGMAs. Include unique keys as
  // they enforce message publication and subscriber identity on later writes.
  const columns = candidate.exec(`PRAGMA table_xinfo(${table})`)[0]?.values ?? [];
  const keys = (candidate.exec(`PRAGMA index_list(${table})`)[0]?.values ?? [])
    .filter(index => index[2] === 1)
    .map(index => {
      const name = String(index[1]).replaceAll("'", "''");
      const details = candidate.exec(`PRAGMA index_xinfo('${name}')`)[0]?.values ?? [];
      return JSON.stringify([index[4], details.filter(column => column[5] === 1).map(column => [column[2], column[3], column[4]])]);
    }).sort();
  return JSON.stringify([columns.map(column => [column[1], String(column[2]).toUpperCase(), ...column.slice(3)]), keys]);
}

function validateExistingDatabase(candidate: Database, byteLength: number): WorkspaceState {
  const pages = Number(candidate.exec('PRAGMA page_count')[0]?.values[0][0]);
  const pageSize = Number(candidate.exec('PRAGMA page_size')[0]?.values[0][0]);
  if (pages * pageSize !== byteLength) throw new WorkspaceOpenError('invalid');
  if (candidate.exec('PRAGMA user_version')[0]?.values[0][0] !== 0) throw new WorkspaceOpenError('unsupported');
  if (candidate.exec('PRAGMA integrity_check(1)')[0]?.values[0][0] !== 'ok') throw new WorkspaceOpenError('invalid');
  const objects = candidate.exec("SELECT name,type FROM sqlite_master WHERE name IN ('app_state','module_events','module_event_deliveries')")[0]?.values ?? [];
  if (objects.some(([, type]) => type !== 'table')) throw new WorkspaceOpenError('invalid');
  const tables = new Set(objects.map(([name]) => name));
  if (!tables.has('app_state') || tables.has('module_events') !== tables.has('module_event_deliveries')) throw new WorkspaceOpenError('invalid');
  const reference = openDatabase();
  try {
    reference.run(createWorkspaceTable);
    initializeModuleEventStore(reference);
    for (const name of ['app_state', 'module_events', 'module_event_deliveries']) {
      if (tables.has(name) && tableLayout(reference, name) !== tableLayout(candidate, name)) throw new WorkspaceOpenError('invalid');
    }
  } finally { reference.close(); }
  if (candidate.exec("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('app_state','module_events','module_event_deliveries') LIMIT 1").length) {
    throw new WorkspaceOpenError('invalid');
  }
  const state = readWorkspaceRow(candidate);
  if (!state) throw new WorkspaceOpenError('invalid');
  if (tables.has('module_events')) validateModuleEventStore(candidate);
  return state;
}

/** Activate the writer only after the entire candidate and its delivery guards have been checked. */
export async function initializeStore({ requireExisting = false } = {}): Promise<WorkspaceState | null> {
  if (db) throw new Error('Der lokale Speicher ist bereits geöffnet.');
  filePath = path.join(app.getPath('userData'), 'workspace.sqlite');
  const bytes = await readWorkspaceImage(requireExisting);
  if (!openDatabase) {
    const wasmBytes = await fs.readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
    const SQL = await initSqlJs({ wasmBinary: Uint8Array.from(wasmBytes).buffer });
    openDatabase = bytes => bytes ? new SQL.Database(bytes) : new SQL.Database();
  }
  let candidate: Database | undefined;
  try {
    if (bytes && bytes.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') throw new WorkspaceOpenError('invalid');
    candidate = openDatabase(bytes);
    const state = bytes ? validateExistingDatabase(candidate, bytes.length) : null;
    candidate.run(createWorkspaceTable);
    initializeModuleEventStore(candidate);
    db = candidate;
    storageFault = undefined;
    return state;
  } catch (error) {
    candidate?.close();
    throw error instanceof WorkspaceOpenError ? error : new WorkspaceOpenError('invalid');
  }
}

/** An unconfirmed directory sync fences all disk mutations until a fresh open. */
export function getWorkspaceStoreFault(): Error | undefined { return storageFault; }

function requireStore(): void {
  if (!db) throw new Error('Der lokale Speicher ist noch nicht verfügbar.');
  if (storageFault) throw storageFault;
}

export function loadState(): WorkspaceState | null {
  requireStore();
  return readWorkspaceRow(db);
}

/** Publish the new database only after its complete image is durably replaced. */
function durableMutation(mutate: (next: Database) => void, needed?: (current: Database) => boolean): Promise<void> {
  const operation = writeQueue.then(async () => {
    requireStore();
    if (needed && !needed(db)) return;
    const next = openDatabase(db.export());
    const temporary = `${filePath}.tmp`;
    let replaced = false;
    try {
      next.run('BEGIN TRANSACTION');
      mutate(next);
      next.run('COMMIT');
      const file = await fs.open(temporary, 'w', 0o600);
      try { await file.writeFile(Buffer.from(next.export())); await file.sync(); }
      finally { await file.close(); }
      await fs.rename(temporary, filePath); replaced = true;
      // Flush the directory entry as well as SQLite bytes before acknowledging.
      if (process.platform !== 'win32') {
        const directory = await fs.open(path.dirname(filePath), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
      const previous = db; db = next; previous.close();
    } catch (error) {
      next.close();
      if (replaced) {
        // The disk may contain the new revision. Do not acknowledge deliveries,
        // dispatch them or overwrite that uncertain revision from stale memory.
        storageFault = new Error('Die dauerhafte Speicherung konnte nicht bestätigt werden. Bitte OVD neu starten, bevor weitere Daten verarbeitet werden.');
      } else await fs.rm(temporary, { force: true }).catch(() => {});
      throw storageFault ?? error;
    }
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function publicationsSnapshot(publications: readonly ModuleEventPublication[]): ModuleEventPublication[] {
  if (publications.length > 100) throw new Error('Zu viele Ereignisse in einer Speicheroperation.');
  return JSON.parse(JSON.stringify(publications.map(publication => moduleEventPublicationSchema.parse(publication)))) as ModuleEventPublication[];
}

export function saveState(state: WorkspaceState, publications: readonly ModuleEventPublication[] = []): Promise<void> {
  // Capture exact revisions before waiting; state and outbox have one commit.
  const serialized = JSON.stringify(state), events = publicationsSnapshot(publications);
  return durableMutation(next => {
    next.run('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['workspace', serialized]);
    if (events.length) insertModuleEvents(next, events);
  });
}

export function enqueueModuleEvent(publication: ModuleEventPublication): Promise<void> {
  const events = publicationsSnapshot([publication]);
  return durableMutation(next => insertModuleEvents(next, events));
}
export function pendingModuleEvents(limit = 20, now = Date.now()): ModuleEventDelivery[] {
  requireStore(); return readPendingModuleEvents(db, limit, now);
}
export function acknowledgeModuleEvent(delivery: ModuleEventDelivery): Promise<void> {
  const captured = structuredClone(delivery);
  return durableMutation(next => acknowledgeStoredModuleEvent(next, captured));
}
export function failModuleEvent(delivery: ModuleEventDelivery, detail?: string, now = Date.now()): Promise<void> {
  const captured = structuredClone(delivery);
  return durableMutation(next => failStoredModuleEvent(next, captured, detail, now));
}
export function dropModuleEvents(moduleId: string, keep?: ModuleEventGrant): Promise<void> {
  const captured = keep ? structuredClone(keep) : undefined;
  return durableMutation(next => dropStoredModuleEvents(next, moduleId, captured));
}
export function moduleEventQueueStatus(moduleId?: string): ModuleEventQueueStatus {
  requireStore(); return readModuleEventQueueStatus(db, moduleId);
}
export function reconcileModuleEventGrants(grants: readonly (ModuleEventRecipient & { topics: readonly string[] })[]): Promise<void> {
  const captured = structuredClone(grants);
  return durableMutation(next => reconcileStoredModuleEventGrants(next, captured), current => moduleEventGrantsNeedReconciliation(current, captured));
}

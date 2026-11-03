import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import type { WorkspaceState } from '../shared/model';
import { moduleEventPublicationSchema, type ModuleEventDelivery, type ModuleEventGrant, type ModuleEventPublication, type ModuleEventQueueStatus, type ModuleEventRecipient } from '../shared/module-events';
import { acknowledgeStoredModuleEvent, dropStoredModuleEvents, failStoredModuleEvent, initializeModuleEventStore, insertModuleEvents, moduleEventGrantsNeedReconciliation, readModuleEventQueueStatus, readPendingModuleEvents, reconcileStoredModuleEventGrants } from './module-event-store';

let db: Database;
let filePath: string;
let writeQueue = Promise.resolve();
let openDatabase: (bytes?: Uint8Array) => Database;
let storageFault: Error | undefined;

export async function initializeStore(): Promise<void> {
  filePath = path.join(app.getPath('userData'), 'workspace.sqlite');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const wasmBytes = await fs.readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
  const SQL = await initSqlJs({ wasmBinary: Uint8Array.from(wasmBytes).buffer });
  openDatabase = bytes => bytes ? new SQL.Database(bytes) : new SQL.Database();
  const bytes = await fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  initializeModuleEventStore(db);
  storageFault = undefined;
}

function requireStore(): void {
  if (!db) throw new Error('Der lokale Speicher ist noch nicht verfügbar.');
  if (storageFault) throw storageFault;
}

export function loadState(): WorkspaceState | null {
  requireStore();
  const rows = db.exec("SELECT value FROM app_state WHERE key = 'workspace'");
  if (!rows.length || !rows[0].values.length) return null;
  const value = JSON.parse(String(rows[0].values[0][0]));
  if (value?.version !== 1 || !Array.isArray(value.windows) || !Array.isArray(value.mails) || !Array.isArray(value.drafts) || !Array.isArray(value.chat)) throw new Error('Unsupported workspace data');
  return value as WorkspaceState;
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

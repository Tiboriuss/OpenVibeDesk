import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import type { WorkspaceState } from '../shared/model';

let db: Database;
let filePath: string;
let writeQueue = Promise.resolve();

export async function initializeStore(): Promise<void> {
  filePath = path.join(app.getPath('userData'), 'workspace.sqlite');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const wasmBytes = await fs.readFile(require.resolve('sql.js/dist/sql-wasm.wasm'));
  const SQL = await initSqlJs({ wasmBinary: Uint8Array.from(wasmBytes).buffer });
  const bytes = await fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run('CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
}

export function loadState(): WorkspaceState | null {
  const rows = db.exec("SELECT value FROM app_state WHERE key = 'workspace'");
  if (!rows.length || !rows[0].values.length) return null;
  const value = JSON.parse(String(rows[0].values[0][0]));
  if (value?.version !== 1 || !Array.isArray(value.windows) || !Array.isArray(value.mails) || !Array.isArray(value.drafts) || !Array.isArray(value.chat)) throw new Error('Unsupported workspace data');
  return value as WorkspaceState;
}

export function saveState(state: WorkspaceState): Promise<void> {
  // Capture the exact requested revision before waiting for earlier disk writes.
  const serialized = JSON.stringify(state);
  const operation = writeQueue.then(async () => {
    db.run('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['workspace', serialized]);
    const temporary = `${filePath}.tmp`;
    const file = await fs.open(temporary, 'w');
    try { await file.writeFile(Buffer.from(db.export())); await file.sync(); }
    finally { await file.close(); }
    await fs.rename(temporary, filePath);
    // Flush the directory entry as well as the SQLite bytes before acknowledging.
    if (process.platform !== 'win32') {
      const directory = await fs.open(path.dirname(filePath), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

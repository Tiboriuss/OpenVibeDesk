import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateMailAccount, type MailAccountConfig } from './mail-service';

let accounts: MailAccountConfig[] = [];
let writeQueue: Promise<void> = Promise.resolve();

function accountFile(): string { return path.join(app.getPath('userData'), 'mail-accounts.json'); }

export async function initializeMailAccounts(): Promise<void> {
  let raw: string;
  try { raw = await fs.readFile(accountFile(), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 20) throw new Error('Mailkonten konnten nicht geladen werden.');
  accounts = parsed.map(value => {
    const account = validateMailAccount(value);
    if (account.password !== undefined) throw new Error('Ungültige gespeicherte Mailkontodaten.');
    const { password: _password, ...config } = account;
    return config;
  });
  if (new Set(accounts.map(account => account.id)).size !== accounts.length) throw new Error('Ungültige gespeicherte Mailkontodaten.');
}

export function getMailAccounts(): MailAccountConfig[] { return accounts.map(account => ({ ...account })); }

/** Serialize writes and publish the new list only once it is safely on disk. */
export function addMailAccount(account: MailAccountConfig): Promise<void> {
  const operation = writeQueue.then(async () => {
    if (accounts.length >= 20) throw new Error('Es können höchstens 20 Mailkonten angelegt werden.');
    if (accounts.some(existing => existing.id === account.id)) throw new Error('Dieses Mailkonto existiert bereits.');
    const next = [...accounts, account];
    const file = accountFile();
    const temporary = `${file}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temporary, file);
    accounts = next;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

/** Keep account IDs stable so SMTP settings and local drafts retain their bindings. */
export function updateMailAccount(account: MailAccountConfig): Promise<void> {
  const operation = writeQueue.then(async () => {
    if (!accounts.some(existing => existing.id === account.id)) throw new Error('Mailkonto nicht gefunden.');
    const next = accounts.map(existing => existing.id === account.id ? { ...account } : existing);
    const file = accountFile(), temporary = `${file}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temporary, file);
    accounts = next;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export function removeMailAccount(id: string): Promise<void> {
  const operation = writeQueue.then(async () => {
    if (!accounts.some(account => account.id === id)) throw new Error('Mailkonto nicht gefunden.');
    const next = accounts.filter(account => account.id !== id);
    const file = accountFile();
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temporary, file);
    accounts = next;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

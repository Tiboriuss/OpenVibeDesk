import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateSmtpSettings, type SmtpSettings } from './smtp-service';

let configs: SmtpSettings[] = [];
let queue: Promise<void> = Promise.resolve();
const file = () => path.join(app.getPath('userData'), 'smtp-accounts.json');

export async function initializeSmtpSettings(): Promise<void> {
  let raw: string;
  try { raw = await fs.readFile(file(), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 20) throw new Error('SMTP-Einstellungen konnten nicht geladen werden.');
  configs = data.map(validateSmtpSettings);
  if (new Set(configs.map(item => item.accountId)).size !== configs.length) throw new Error('Ungültige SMTP-Einstellungen.');
}
export function getSmtpSettings(accountId: string): SmtpSettings | undefined {
  const found = configs.find(config => config.accountId === accountId);
  return found && { ...found };
}
export function listSmtpSettings(): SmtpSettings[] { return configs.map(config => ({ ...config })); }

export function writeSmtpSettings(next: SmtpSettings | { accountId: string; remove: true }): Promise<void> {
  const operation = queue.then(async () => {
    const updated = configs.filter(config => config.accountId !== next.accountId);
    if (!('remove' in next)) updated.push(validateSmtpSettings(next));
    if (updated.length > 20) throw new Error('Zu viele SMTP-Konten.');
    const target = file();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(`${target}.tmp`, JSON.stringify(updated), { mode: 0o600 });
    await fs.rename(`${target}.tmp`, target);
    configs = updated;
  });
  queue = operation.catch(() => {});
  return operation;
}

import { app, dialog, shell } from 'electron';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { UiLocale } from '../shared/locale';
import { nativeText } from './native-locale';
import type { WorkspaceState } from '../shared/model';
import { initializeStore, WorkspaceOpenError } from './store';

async function saveRecoveryCopy(directory: string, locale: UiLocale): Promise<string | undefined> {
  const text = nativeText[locale];
  const selection = await dialog.showSaveDialog({
    title: text.saveCopyTitle,
    defaultPath: path.join(app.getPath('documents'), text.recoveryFileName),
    filters: [{ name: 'SQLite', extensions: ['sqlite'] }]
  });
  if (selection.canceled || !selection.filePath) return;
  const parent = await fs.realpath(path.dirname(selection.filePath));
  const relative = path.relative(await fs.realpath(directory), parent);
  if (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
    throw new Error(text.copyOutside);
  }
  const openFlags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
  const source = await fs.open(path.join(directory, 'workspace.sqlite'), openFlags);
  try {
    if (!(await source.stat()).isFile()) throw new Error(text.sourceUnreadable);
    const destination = path.join(parent, path.basename(selection.filePath));
    const target = await fs.open(destination, 'wx', 0o600);
    try {
      try {
        await target.writeFile(source.createReadStream({ autoClose: true }));
        await target.sync();
      } finally { await target.close(); }
    } catch (error) {
      await fs.unlink(destination).catch(() => {});
      throw error;
    }
    return path.basename(destination);
  } finally { await source.close(); }
}

async function offerStartupRecovery(reason: WorkspaceOpenError['reason'], locale: UiLocale): Promise<boolean> {
  const text = nativeText[locale];
  const directory = app.getPath('userData');
  const allowCopy = reason === 'invalid' || reason === 'unsupported';
  const buttons = [text.reopen, text.openDataFolder, ...(allowCopy ? [text.saveCopy] : []), text.quit];
  let savedCopy: string | undefined;
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'warning', title: 'OpenVibeDesk', message: text.workspaceOpenFailed,
      detail: savedCopy ? `${text.copySaved(savedCopy)}\n\n${text[reason]}` : text[reason],
      buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true
    });
    savedCopy = undefined;
    if (response === 0) return true;
    if (response === 1) {
      const failure = await shell.openPath(directory).catch(() => 'unavailable');
      if (failure) dialog.showErrorBox(text.folderOpenFailed, directory);
    } else if (allowCopy && response === 2) {
      try { savedCopy = await saveRecoveryCopy(directory, locale); }
      catch (cause) {
        const code = (cause as NodeJS.ErrnoException | undefined)?.code;
        const detail = code === 'EEXIST' ? text.useNewName : !code && cause instanceof Error ? cause.message : text.checkDestination;
        dialog.showErrorBox(text.copyFailed, detail);
      }
    } else return false;
  }
}

/** Null means a first launch. Undefined means the user quit before any workspace services started. */
export async function openStartupWorkspace(locale: UiLocale): Promise<WorkspaceState | null | undefined> {
  const text = nativeText[locale];
  let requireExisting = false;
  for (;;) {
    try { return await initializeStore({ requireExisting }); }
    catch (error) {
      if (error instanceof WorkspaceOpenError) {
        if (!await offerStartupRecovery(error.reason, locale)) return undefined;
        requireExisting = true;
      } else {
        const choice = await dialog.showMessageBox({
          type: 'error', title: 'OpenVibeDesk', message: text.databaseStartFailed,
          buttons: [text.retry, text.quit], defaultId: 0, cancelId: 1, noLink: true
        });
        if (choice.response !== 0) return undefined;
      }
    }
  }
}

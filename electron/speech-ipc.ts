import { ipcMain, session, type BrowserWindow, type WebContents } from 'electron';
import { z } from 'zod';
import { SpeechService } from './speech';
import type { WindowKind } from '../shared/model';
import { SPEECH_MAX_CHUNK_BYTES, speechSettingsInputSchema } from '../shared/speech';

/** Audio permission is scoped to an explicit recording in the trusted chat window. */
export class SpeechController {
  readonly service: SpeechService;
  private microphones: { id: string; label: string }[] = [];
  private readonly leases = new Map<number, { id?: string; ended?: boolean }>();
  private readonly watching = new WeakSet<WebContents>();
  constructor(private readonly options: {
    dataDirectory: string;
    panels: Map<WindowKind, BrowserWindow>;
    verifyPanel(event: Electron.IpcMainInvokeEvent, kinds: WindowKind[]): void;
    openSettings(): Promise<void>;
    settingsStatus(status: 'clean' | 'dirty' | 'busy'): void;
  }) {
    this.service = new SpeechService({ dataDirectory: options.dataDirectory, changed: settings => {
      this.leases.clear();
      for (const kind of ['settings', 'chat'] as const) {
        const win = options.panels.get(kind);
        if (win && !win.isDestroyed()) win.webContents.send('speech:settings:changed', settings);
      }
    } });
  }
  private permitted(contents: WebContents | null, isMainFrame: boolean, url?: string): boolean {
    return !!contents && !contents.isDestroyed() && this.options.panels.get('chat')?.webContents === contents &&
      this.leases.has(contents.id) && isMainFrame === true && url === contents.mainFrame.url;
  }
  cancelOwner(id: number): void { this.leases.delete(id); this.service.cancelOwner(id); }
  dispose(): void { this.leases.clear(); this.service.dispose(); }
  async initialize(): Promise<void> {
    await this.service.initialize();
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      const types = (details as Electron.MediaAccessPermissionRequest).mediaTypes;
      callback(permission === 'media' && types?.length === 1 && types[0] === 'audio' && this.permitted(contents, details.isMainFrame, details.requestingUrl));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
      permission === 'media' && details.mediaType === 'audio' && this.permitted(contents, details.isMainFrame, details.requestingUrl));
    const verify = (event: Electron.IpcMainInvokeEvent, kinds: WindowKind[] = ['chat']) => this.options.verifyPanel(event, kinds);
    ipcMain.handle('speech:microphones:get', event => { verify(event, ['settings', 'chat']); return this.microphones; });
    ipcMain.handle('speech:microphones:report', (event, input: unknown) => {
      verify(event);
      if (!this.leases.has(event.sender.id)) return;
      this.microphones = z.array(z.object({ id: z.string().min(1).max(512), label: z.string().max(200) }).strict()).max(32).parse(input);
      const settings = this.options.panels.get('settings');
      if (settings && !settings.isDestroyed()) settings.webContents.send('speech:microphones:changed', this.microphones);
    });
    ipcMain.handle('speech:settings:get', event => { verify(event, ['settings', 'chat']); return this.service.getSettings(); });
    ipcMain.handle('speech:settings:save', (event, input: unknown) => { verify(event, ['settings']); return this.service.saveSettings(speechSettingsInputSchema.parse(input)); });
    ipcMain.handle('speech:settings:open', event => { verify(event, ['chat', 'settings']); return this.options.openSettings(); });
    ipcMain.on('speech:settings:status', (event, status: unknown) => {
      const win = this.options.panels.get('settings');
      if (win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === event.sender.mainFrame && (status === 'clean' || status === 'dirty' || status === 'busy')) this.options.settingsStatus(status);
    });
    ipcMain.handle('speech:start', async event => {
      verify(event);
      const owner = event.sender, lease: { id?: string; ended?: boolean } = {};
      if (this.leases.has(owner.id)) throw new Error('Eine Aufnahme läuft bereits.');
      this.leases.set(owner.id, lease);
      if (!this.watching.has(owner)) {
        this.watching.add(owner);
        owner.on('destroyed', () => this.cancelOwner(owner.id));
        owner.on('render-process-gone', () => this.cancelOwner(owner.id));
        owner.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) this.cancelOwner(owner.id); });
      }
      try {
        const result = await this.service.start(owner.id, update => {
          lease.id = update.id;
          if (['completed', 'failed', 'cancelled'].includes(update.status)) lease.ended = true;
          if (['transcribing', 'completed', 'failed', 'cancelled'].includes(update.status) && this.leases.get(owner.id) === lease) this.leases.delete(owner.id);
          if (!owner.isDestroyed()) owner.send('speech:event', update);
        });
        if (owner.isDestroyed() || !lease.ended && this.leases.get(owner.id) !== lease) { this.service.cancel(owner.id, result.id); throw new Error('Aufnahme abgebrochen.'); }
        return result;
      } catch (error) { if (this.leases.get(owner.id) === lease) this.leases.delete(owner.id); throw error; }
    });
    ipcMain.handle('speech:append', (event, rawId: unknown, pcm: unknown) => {
      verify(event); const id = z.string().uuid().parse(rawId);
      if (!(pcm instanceof ArrayBuffer) || pcm.byteLength > SPEECH_MAX_CHUNK_BYTES || pcm.byteLength % 2) throw new Error('Ungültiges Audioformat.');
      return this.service.append(event.sender.id, id, pcm);
    });
    ipcMain.handle('speech:stop', (event, rawId: unknown) => {
      verify(event); const id = z.string().uuid().parse(rawId);
      if (this.leases.get(event.sender.id)?.id === id) this.leases.delete(event.sender.id); return this.service.stop(event.sender.id, id);
    });
    ipcMain.handle('speech:retry', (event, rawId: unknown) => {
      verify(event); const id = z.string().uuid().parse(rawId);
      const owner = event.sender;
      // Retrying sends only retained audio; it never grants microphone access.
      return this.service.retry(owner.id, id, update => {
        if (!owner.isDestroyed()) owner.send('speech:event', update);
      });
    });
    ipcMain.handle('speech:cancel', (event, rawId: unknown) => {
      verify(event);
      if (rawId === undefined) return this.cancelOwner(event.sender.id);
      const id = z.string().uuid().parse(rawId);
      if (this.leases.get(event.sender.id)?.id === id) this.leases.delete(event.sender.id); this.service.cancel(event.sender.id, id);
    });
  }
}

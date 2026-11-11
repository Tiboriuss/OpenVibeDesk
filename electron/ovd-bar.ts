import { BrowserWindow, Menu, screen, type Display, type MenuItemConstructorOptions, type Rectangle } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Settings } from '../shared/model';
import { resolveBarSettings } from '../shared/ovd-bar';
import { barDimensions } from '../shared/ovd-bar-layout';
import { fitWindowBounds } from './window-layout';

const positionSchema = z.object({ version: z.literal(1), displayId: z.number().int(), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
type Position = z.infer<typeof positionSchema>;
export type BarPresentation = { collapsed: boolean; error?: string };
type Options = {
  dataDirectory: string;
  settings(): Settings;
  navigationCount(): number;
  saveSettings(patch: Partial<Settings>, isCurrent?: () => boolean): Promise<void>;
  openSettings(): Promise<void>;
  quit(): Promise<unknown>;
};

/** The renderer owns appearance; the host owns bounds, display recovery and lifecycle. */
export class OvdBarController {
  private position?: Position;
  private readable = true;
  private collapsed = false;
  private hovered = false;
  private focused = false;
  private menuOpen = false;
  private error?: string;
  private expectedBounds?: Rectangle;
  private expandedBounds?: Rectangle;
  private lastPlacement?: ReturnType<typeof resolveBarSettings>['barPosition'];
  private layoutRevision = 0;
  private moveRevision = 0;
  private hideTimer?: NodeJS.Timeout;
  private moveTimer?: NodeJS.Timeout;
  private saveQueue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly positionPath: string;
  constructor(private readonly window: BrowserWindow, private readonly options: Options) {
    this.positionPath = path.join(options.dataDirectory, 'ovd-bar-position.json');
  }
  async initialize(): Promise<void> {
    try { this.position = positionSchema.parse(JSON.parse(await fs.readFile(this.positionPath, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.readable = false; this.error = 'Die gespeicherte OVD-Bar-Position konnte nicht gelesen werden.'; }
    }
    this.window.on('move', this.onMove);
    this.window.on('focus', this.onFocus);
    this.window.on('blur', this.onBlur);
    this.window.on('closed', this.dispose);
    screen.on('display-added', this.onDisplaysChanged);
    screen.on('display-removed', this.onDisplaysChanged);
    screen.on('display-metrics-changed', this.onDisplaysChanged);
    this.focused = this.window.isFocused();
    this.layout();
  }
  presentation(): BarPresentation { return { collapsed: this.collapsed, ...(this.error ? { error: this.error } : {}) }; }
  status() {
    if (this.disposed || this.window.isDestroyed()) throw new Error('Die OVD-Bar ist nicht verfügbar.');
    const describe = (display: Display) => ({ id: display.id, label: display.label.slice(0, 160), workArea: display.workArea, scaleFactor: display.scaleFactor });
    const bounds = this.window.getBounds(), displays = screen.getAllDisplays();
    return { settings: { ...resolveBarSettings(this.options.settings()), dockAlwaysOnTop: this.options.settings().dockAlwaysOnTop },
      collapsed: this.collapsed, bounds, expandedBounds: this.expandedBounds ?? bounds,
      display: describe(screen.getDisplayMatching(bounds)), displays: displays.slice(0, 16).map(describe), displaysComplete: displays.length <= 16,
      coordinateSpace: 'screen-dip' as const, observedAt: new Date().toISOString() };
  }
  async move(input: { x: number; y: number; displayId?: number }, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.disposed || this.window.isDestroyed()) throw new Error('Die OVD-Bar ist nicht verfügbar.');
    const settings = resolveBarSettings(this.options.settings());
    const requested = { ...barDimensions(this.options.navigationCount(), settings.barSize, settings.barOrientation), x: input.x, y: input.y };
    const display = input.displayId === undefined ? screen.getDisplayMatching(requested) : screen.getAllDisplays().find(item => item.id === input.displayId);
    if (!display) throw new Error('Dieser Bildschirm ist nicht mehr verfügbar. Bitte bar.get erneut abfragen.');
    const area = display.workArea, leadingInset = Math.max(8, settings.barSize / 2 - 8), vertical = settings.barOrientation === 'vertical';
    const safeArea = vertical ? { ...area, y: area.y + leadingInset, height: Math.max(1, area.height - leadingInset) }
      : { ...area, x: area.x + leadingInset, width: Math.max(1, area.width - leadingInset) };
    const bounds = fitWindowBounds({ ...requested,
      width: Math.max(1, Math.min(requested.width, vertical ? area.width - 16 : safeArea.width - 8)),
      height: Math.max(1, Math.min(requested.height, vertical ? safeArea.height - 8 : area.height - 16)) }, safeArea, { width: 1, height: 1 });
    this.layoutRevision++; this.moveRevision++;
    if (this.moveTimer) { clearTimeout(this.moveTimer); this.moveTimer = undefined; }
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = undefined; }
    this.collapsed = false; this.publish();
    this.expectedBounds = bounds; this.expandedBounds = bounds;
    this.window.setBounds(bounds);
    this.window.showInactive();
    try {
      await this.rememberPosition(true, true, signal, display);
      const actual = this.status();
      return { saved: true, position: 'free' as const, bounds: actual.bounds, expandedBounds: actual.expandedBounds, displayId: actual.display.id, coordinateSpace: actual.coordinateSpace };
    } finally { this.scheduleHide(); }
  }
  private publish(): void { if (!this.window.isDestroyed()) this.window.webContents.send('ovd-bar:presentation', this.presentation()); }
  private display(): Display {
    const saved = this.position && screen.getAllDisplays().find(display => display.id === this.position!.displayId);
    return saved || screen.getPrimaryDisplay();
  }
  layout(): void {
    if (this.disposed || this.window.isDestroyed()) return;
    this.layoutRevision++;
    if (this.moveTimer) { clearTimeout(this.moveTimer); this.moveTimer = undefined; }
    const settings = resolveBarSettings(this.options.settings());
    // Unlocking an anchored bar retains its current on-screen center. Startup
    // has no previous placement and restores the separately saved position.
    if (settings.barPosition === 'free' && this.lastPlacement && this.lastPlacement !== 'free') void this.rememberPosition(false);
    this.lastPlacement = settings.barPosition;
    if (!settings.barAutoHide && this.collapsed) { this.collapsed = false; this.publish(); }
    const display = this.display(), area = display.workArea;
    const vertical = settings.barOrientation === 'vertical';
    const requested = barDimensions(this.options.navigationCount(), settings.barSize, settings.barOrientation);
    // Keep the collapsed handle centered on the full bar's grip, including at
    // the leading screen edge. Revealing must not put a module under its pointer.
    const leadingInset = Math.max(8, settings.barSize / 2 - 8);
    const safeArea = vertical ? { ...area, y: area.y + leadingInset, height: Math.max(1, area.height - leadingInset) }
      : { ...area, x: area.x + leadingInset, width: Math.max(1, area.width - leadingInset) };
    const width = Math.max(1, Math.min(requested.width, vertical ? area.width - 16 : safeArea.width - 8));
    const height = Math.max(1, Math.min(requested.height, vertical ? safeArea.height - 8 : area.height - 16));
    let x = area.x + Math.round((area.width - width) / 2), y = area.y + Math.round((area.height - height) / 2);
    if (settings.barPosition === 'free' && this.position) {
      x = area.x + Math.round(this.position.x * area.width - width / 2);
      y = area.y + Math.round(this.position.y * area.height - height / 2);
    } else if (settings.barPosition === 'left') x = area.x + 8;
    else if (settings.barPosition === 'right') x = area.x + area.width - width - 8;
    else if (settings.barPosition === 'top') y = area.y + 8;
    else if (settings.barPosition === 'bottom') y = area.y + area.height - height - 8;
    const expanded = fitWindowBounds({ x, y, width, height }, safeArea, { width: 1, height: 1 });
    this.expandedBounds = expanded;
    const cross = vertical ? expanded.width : expanded.height;
    const bounds = this.collapsed ? fitWindowBounds(vertical
      ? { x: expanded.x, y: Math.round(expanded.y + 22 - cross / 2), width: cross, height: cross }
      : { x: Math.round(expanded.x + 22 - cross / 2), y: expanded.y, width: cross, height: cross }, area, { width: 1, height: 1 }) : expanded;
    this.expectedBounds = bounds;
    const actual = this.window.getBounds();
    if (Object.keys(bounds).some(key => bounds[key as keyof Rectangle] !== actual[key as keyof Rectangle])) this.window.setBounds(bounds);
    this.window.setAlwaysOnTop(this.options.settings().dockAlwaysOnTop);
    this.scheduleHide();
  }
  interaction(value: { hovered: boolean; focused: boolean }): void {
    this.hovered = value.hovered;
    this.focused = value.focused && this.window.isFocused();
    if (this.hovered || this.focused) this.reveal(false);
    else this.scheduleHide();
  }
  reveal(focus = false): void {
    if (this.disposed || this.window.isDestroyed()) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    if (this.collapsed) { this.collapsed = false; this.publish(); this.layout(); }
    if (focus) { this.window.show(); this.window.focus(); this.focused = true; }
    this.scheduleHide();
  }
  private scheduleHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    if (this.disposed || this.collapsed || !resolveBarSettings(this.options.settings()).barAutoHide || this.hovered || this.focused || this.menuOpen) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
      if (this.disposed || this.hovered || this.focused || this.menuOpen || !resolveBarSettings(this.options.settings()).barAutoHide) return;
      this.collapsed = true; this.publish(); this.layout();
    }, 800);
  }
  private onFocus = (): void => { this.focused = true; this.reveal(); };
  private onBlur = (): void => { this.focused = false; this.scheduleHide(); };
  private onDisplaysChanged = (): void => { this.layout(); };
  private onMove = (): void => {
    if (this.disposed || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    if (this.expectedBounds && Object.keys(bounds).every(key => bounds[key as keyof Rectangle] === this.expectedBounds![key as keyof Rectangle])) return;
    this.moveRevision++;
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = setTimeout(() => { this.moveTimer = undefined; void this.rememberPosition(); }, 180);
  };
  private async rememberPosition(switchToFree = true, strict = false, signal?: AbortSignal, targetDisplay?: Display): Promise<void> {
    if (this.disposed || this.window.isDestroyed()) return;
    signal?.throwIfAborted();
    const layoutRevision = this.layoutRevision, moveRevision = this.moveRevision;
    const isCurrent = () => !this.disposed && !signal?.aborted && layoutRevision === this.layoutRevision && moveRevision === this.moveRevision;
    const actual = this.window.getBounds();
    const bounds = this.collapsed && this.expandedBounds && this.expectedBounds
      ? { ...this.expandedBounds, x: this.expandedBounds.x + actual.x - this.expectedBounds.x, y: this.expandedBounds.y + actual.y - this.expectedBounds.y }
      : actual;
    const display = targetDisplay ?? screen.getDisplayMatching(actual), area = display.workArea;
    this.position = { version: 1, displayId: display.id,
      x: Math.max(0, Math.min(1, (bounds.x + bounds.width / 2 - area.x) / area.width)),
      y: Math.max(0, Math.min(1, (bounds.y + bounds.height / 2 - area.y) / area.height)) };
    const captured = JSON.stringify(this.position);
    const write = this.saveQueue.then(async () => {
      if (!this.readable) throw new Error('Die gespeicherte OVD-Bar-Position ist nicht lesbar und wurde nicht überschrieben.');
      const temporary = this.positionPath + '.tmp';
      await fs.mkdir(this.options.dataDirectory, { recursive: true });
      await fs.writeFile(temporary, captured, { mode: 0o600 });
      await fs.rename(temporary, this.positionPath);
    });
    this.saveQueue = write.catch(() => {});
    try {
      await write;
      signal?.throwIfAborted();
      if (strict && !isCurrent()) throw new Error('Die OVD-Bar wurde zwischenzeitlich geändert. Bitte die aktuelle Position prüfen.');
      if (switchToFree && isCurrent() && resolveBarSettings(this.options.settings()).barPosition !== 'free') {
        await this.options.saveSettings({ barPosition: 'free' }, () => {
          if (!isCurrent()) return false;
          // The position is already captured here; do not capture the previous
          // anchored layout again when publishing the free-placement setting.
          this.lastPlacement = 'free'; return true;
        });
      }
      signal?.throwIfAborted();
      if (strict && (this.disposed || resolveBarSettings(this.options.settings()).barPosition !== 'free')) throw new Error('Die freie OVD-Bar-Position wurde nicht übernommen. Bitte die aktuelle Einstellung prüfen.');
      this.error = undefined; this.publish();
    } catch (error) { this.error = error instanceof Error ? error.message : 'Die OVD-Bar-Position konnte nicht gespeichert werden.'; this.publish(); if (strict) throw error; }
  }
  async showMenu(): Promise<void> {
    if (this.menuOpen || this.window.isDestroyed()) return;
    this.menuOpen = true; this.reveal();
    const settings = resolveBarSettings(this.options.settings());
    let selected: (() => Promise<unknown>) | undefined;
    const change = (patch: Partial<Settings>) => () => { selected = () => this.options.saveSettings(patch); };
    const positions = [['free', 'Frei verschiebbar'], ['left', 'Links'], ['right', 'Rechts'], ['top', 'Oben'], ['bottom', 'Unten']] as const;
    const template: MenuItemConstructorOptions[] = [
      { label: 'OVD-Bar anpassen …', click: () => { selected = this.options.openSettings; } },
      { type: 'separator' },
      { label: 'Ausrichtung', submenu: [
        { label: 'Vertikal', type: 'radio', checked: settings.barOrientation === 'vertical', click: change({ barOrientation: 'vertical' }) },
        { label: 'Horizontal', type: 'radio', checked: settings.barOrientation === 'horizontal', click: change({ barOrientation: 'horizontal' }) }
      ] },
      { label: 'Position', submenu: positions.map(([value, label]) => ({ label, type: 'radio' as const, checked: settings.barPosition === value, click: change({ barPosition: value }) })) },
      { label: 'Größe', submenu: [
        ...(![32, 40, 48, 56].includes(settings.barSize) ? [{ label: `${Math.round(settings.barSize / 40 * 100)} % (aktuell)`, type: 'radio' as const, checked: true, enabled: false }] : []),
        ...[[32, 'Klein'], [40, 'Standard'], [48, 'Groß'], [56, 'Sehr groß']].map(([value, label]) => ({ label: String(label), type: 'radio' as const, checked: settings.barSize === value, click: change({ barSize: Number(value) }) }))
      ] },
      { label: 'Hintergrund', submenu: [
        ...(![100, 96, 90, 70].includes(settings.barOpacity) ? [{ label: `${settings.barOpacity} % (aktuell)`, type: 'radio' as const, checked: true, enabled: false }] : []),
        ...[[100, 'Deckend'], [96, 'Standard'], [90, 'Leicht transparent'], [70, 'Transparent']].map(([value, label]) => ({ label: String(label), type: 'radio' as const, checked: settings.barOpacity === value, click: change({ barOpacity: Number(value) }) }))
      ] },
      { label: 'Immer im Vordergrund', type: 'checkbox', checked: this.options.settings().dockAlwaysOnTop, click: change({ dockAlwaysOnTop: !this.options.settings().dockAlwaysOnTop }) },
      { label: 'Bei Nichtbenutzung einklappen', type: 'checkbox', checked: settings.barAutoHide, click: change({ barAutoHide: !settings.barAutoHide }) },
      { type: 'separator' },
      { label: 'OpenVibeDesk beenden', click: () => { selected = this.options.quit; } }
    ];
    try {
      await new Promise<void>(resolve => Menu.buildFromTemplate(template).popup({ window: this.window, callback: resolve }));
      if (selected) await selected();
    } finally { this.menuOpen = false; this.scheduleHide(); }
  }
  async flush(): Promise<void> {
    if (this.moveTimer) { clearTimeout(this.moveTimer); this.moveTimer = undefined; await this.rememberPosition(); }
    await this.saveQueue;
  }
  private dispose = (): void => {
    this.disposed = true;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.moveTimer) clearTimeout(this.moveTimer);
    screen.removeListener('display-added', this.onDisplaysChanged);
    screen.removeListener('display-removed', this.onDisplaysChanged);
    screen.removeListener('display-metrics-changed', this.onDisplaysChanged);
  };
}

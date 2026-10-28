import { Maximize2, Minus, Sparkles, X } from 'lucide-react';
import type { WindowControl } from '../shared/model';

export function WindowChrome({ title }: { title: string }) {
  const control = (action: WindowControl) => { void window.workspace.controlWindow(action).catch(error => console.error('Window control failed', error)); };
  return <header className="window-chrome" onDoubleClick={() => control('toggleMaximize')}>
    <span className="window-chrome-brand" aria-hidden="true"><Sparkles size={15} /></span>
    <span className="window-chrome-title">{title}</span>
    <div className="window-chrome-actions" onDoubleClick={event => event.stopPropagation()}>
      <button className="window-chrome-button" aria-label="Fenster minimieren" title="Minimieren" onClick={() => control('minimize')}><Minus size={15} /></button>
      <button className="window-chrome-button" aria-label="Fenster maximieren oder wiederherstellen" title="Maximieren / Wiederherstellen" onClick={() => control('toggleMaximize')}><Maximize2 size={14} /></button>
      <button className="window-chrome-button window-chrome-close" aria-label="Fenster schließen" title="Schließen" onClick={() => control('close')}><X size={16} /></button>
    </div>
  </header>;
}

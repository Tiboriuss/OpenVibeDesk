import { useState } from 'react';
import { Maximize2, Minus, Pin, X } from 'lucide-react';
import { settingsText } from './settings-copy';
import { BrandMark } from './BrandMark';
import { useUiLocale } from './locale';
import type { WindowControl } from '../shared/model';

const chromeText = {
  de: { minimize: 'Fenster minimieren', maximize: 'Fenster maximieren oder wiederherstellen', close: 'Fenster schließen' },
  en: { minimize: 'Minimize window', maximize: 'Maximize or restore window', close: 'Close window' }
};

export function WindowChrome({ title, assistantPinned, onError }: { title: string; assistantPinned?: boolean; onError(message: string): void }) {
  const locale = useUiLocale(), labels = chromeText[locale], copy = settingsText[locale];
  const [savingPin, setSavingPin] = useState(false);
  async function changePin() {
    if (assistantPinned === undefined || savingPin) return;
    setSavingPin(true);
    try { await window.workspace.setAssistantPinned(!assistantPinned); }
    catch { onError(copy.pinSaveFailed); }
    finally { setSavingPin(false); }
  }
  const control = (action: WindowControl) => { void window.workspace.controlWindow(action).catch(error => console.error('Window control failed', error)); };
  return <header className="window-chrome" onDoubleClick={() => control('toggleMaximize')}>
    <span className="window-chrome-brand" aria-hidden="true" title="OpenVibeDesk"><BrandMark inverse size={48} /></span>
    <span className="window-chrome-title" title={title}>{title}</span>
    <div className="window-chrome-actions" onDoubleClick={event => event.stopPropagation()}>
      {assistantPinned !== undefined && <button type="button" className="window-chrome-button window-chrome-pin"
        aria-label={copy.assistantPin} aria-pressed={assistantPinned} aria-disabled={savingPin}
        title={assistantPinned ? copy.unpin : copy.assistantPin} onClick={() => void changePin()}><Pin size={14} aria-hidden="true" /></button>}
      <button className="window-chrome-button" aria-label={labels.minimize} title={labels.minimize} onClick={() => control('minimize')}><Minus size={15} /></button>
      <button className="window-chrome-button" aria-label={labels.maximize} title={labels.maximize} onClick={() => control('toggleMaximize')}><Maximize2 size={14} /></button>
      <button className="window-chrome-button window-chrome-close" aria-label={labels.close} title={labels.close} onClick={() => control('close')}><X size={16} /></button>
    </div>
  </header>;
}

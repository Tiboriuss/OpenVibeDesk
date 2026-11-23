import { useState } from 'react';
import { appUpdateText } from '../shared/app-update-copy';
import { defaultUpdateChannel, type AppUpdateStatus, type UpdateChannel } from '../shared/app-updates';
import type { Settings } from '../shared/model';
import { useUiLocale } from './locale';
import { SettingsChoiceRow } from './SettingsChoiceRow';
import './update-settings.css';

type UpdatePatch = Pick<Settings, 'updateChannel' | 'checkUpdatesOnStartup'>;

export function UpdateSettings({ status, settings, onUpdate }: {
  status?: AppUpdateStatus;
  settings: Settings;
  onUpdate(patch: UpdatePatch): Promise<void>;
}) {
  const copy = appUpdateText[useUiLocale()];
  const [pendingSave, setPendingSave] = useState(false);
  const [error, setError] = useState<'preferenceFailed' | 'openFailed' | 'checkFailed'>();
  const update = status?.update;
  const checking = status?.phase === 'checking';
  const phaseMessage = (() => {
    switch (status?.phase) {
      case 'checking': return copy.checking;
      case 'current': return copy.current;
      case 'error': return copy.checkFailed;
      case 'development': return copy.development;
      case 'unsupported': return copy.unsupported;
      default: return undefined;
    }
  })();

  async function save(patch: UpdatePatch) {
    setPendingSave(true);
    setError(undefined);
    try { await onUpdate(patch); }
    catch { setError('preferenceFailed'); }
    finally { setPendingSave(false); }
  }

  async function check() {
    setError(undefined);
    try { await window.workspace.checkAppUpdates(); }
    catch { setError('checkFailed'); }
  }

  async function open(version: string, destination: 'release' | 'installer') {
    setError(undefined);
    try { await window.workspace.openAppUpdate(version, destination); }
    catch { setError('openFailed'); }
  }

  return <div className="workspace-settings-group settings-choices app-update-settings">
    <div className="settings-choice-row">
      <strong className="app-update-label">{copy.currentVersion}</strong>
      <span className="app-update-value">{status?.currentVersion}</span>
    </div>
    <SettingsChoiceRow id="app-update-channel" label={copy.channel}
      value={settings.updateChannel ?? defaultUpdateChannel} disabled={pendingSave}
      onChange={event => void save({ updateChannel: event.target.value as UpdateChannel })}>
      <option value="preview">{copy.showPreview}</option>
      <option value="stable">{copy.stableOnly}</option>
    </SettingsChoiceRow>
    <div className="settings-choice-row">
      <label className="app-update-label" htmlFor="app-update-startup">{copy.atStartup}</label>
      <input id="app-update-startup" className="setting-toggle app-update-value" type="checkbox"
        checked={settings.checkUpdatesOnStartup ?? true} disabled={pendingSave}
        onChange={event => void save({ checkUpdatesOnStartup: event.target.checked })} />
    </div>
    <div className="app-update-actions">
      <button type="button" disabled={!status || checking || pendingSave || status.phase === 'unsupported' || status.phase === 'development'}
        onClick={() => void check()}>{copy.check}</button>
      {phaseMessage && <span role={status?.phase === 'error' ? 'alert' : 'status'}>{phaseMessage}</span>}
    </div>
    {update && <div className="app-update-actions app-update-result">
      <div>
        <strong>{copy.versionAvailable(update.version)}</strong>
        {(status.ignored || update.prerelease) && <small>{status.ignored ? copy.ignored : copy.preview}</small>}
      </div>
      <button type="button" onClick={() => void open(update.version, 'installer')}>{copy.download}</button>
      <button type="button" onClick={() => void open(update.version, 'release')}>{copy.notes}</button>
    </div>}
    {error && <p className="settings-feedback error" role="alert">{copy[error]}</p>}
  </div>;
}

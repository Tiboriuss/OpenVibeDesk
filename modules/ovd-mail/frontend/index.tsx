import { useEffect, useRef, useState } from 'react';
import { DraftView } from './DraftView';
import { MailWorkspace } from './MailWorkspace';
import { MailAccounts } from './MailAccounts';
import type { MailAccountSummary, SmtpConfig } from '../../../shared/mail';
import type { Draft, WorkspaceState } from '../../../shared/model';
import type { UiAction } from '../../../shared/actions';
import type { SettingsSuggestion } from '../../../src/settings-preparation';

export function MailModuleView({ state }: { state: WorkspaceState }) {
  return <MailWorkspace drafts={state.drafts} />;
}

export function MailDraftModuleView({ draft, onAction, onError }: { draft?: Draft; onAction(action: UiAction): Promise<void>; onError(message: string): void }) {
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => { void window.workspace.listMailAccounts().then(items => { if (active) setAccounts(items); }).catch(() => { if (active) onError('Mailkonten konnten nicht geladen werden.'); }); };
    const unsubscribe = window.workspace.onMailAccountsChanged(load);
    load();
    return () => { active = false; unsubscribe(); };
  }, []);
  return <DraftView draft={draft} accounts={accounts} onUpdate={patch => draft && void onAction({ type: 'update_draft', draftId: draft.id, patch })} onAttach={async () => {
    try { const file = await window.workspace.chooseFile(); if (file && draft) await onAction({ type: 'attach_file', draftId: draft.id, file }); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }} onRemoveAttachment={index => draft && void onAction({ type: 'remove_attachment', draftId: draft.id, index })} onSend={draft && accounts.some(account => account.id === draft.accountId) ? () => window.workspace.sendDraft(draft.id) : undefined} />;
}

export function MailModuleSettings({ preparation, searchQuery }: { preparation?: SettingsSuggestion; searchQuery: string }) {
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  const [smtpConfigs, setSmtpConfigs] = useState<SmtpConfig[]>([]);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false), [retry, setRetry] = useState(0);
  const refreshVersion = useRef(0);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { const version = ++refreshVersion.current; void Promise.all([window.workspace.listMailAccounts(), window.workspace.listSmtpSettings()]).then(([items, smtp]) => { if (mounted && version === refreshVersion.current) { setAccounts(items); setSmtpConfigs(smtp); setReady(true); setError(''); } }).catch(() => { if (mounted && version === refreshVersion.current) setError('Mailkonten oder SMTP-Einstellungen konnten nicht geladen werden.'); }); };
    const unsubscribe = window.workspace.onMailAccountsChanged(refresh);
    refresh();
    return () => { mounted = false; refreshVersion.current++; unsubscribe(); };
  }, [retry]);
  return <>
    {error && <p className="mail-account-feedback error" role="alert">{error}</p>}
    {!ready && !error && <p className="mail-account-intro" role="status">Mailkonten werden geladen …</p>}
    {!ready && error && <button type="button" className="mail-account-check" onClick={() => { setError(''); setRetry(value => value + 1); }}>Erneut laden</button>}
    {ready && <MailAccounts preparation={preparation?.category === 'mail' ? preparation : undefined} accounts={accounts} smtpConfigs={smtpConfigs} searchQuery={searchQuery} onTest={input => window.workspace.testMailAccount(input)} onSave={input => window.workspace.saveMailAccount(input)} onRemove={id => window.workspace.removeMailAccount(id)} onTestSmtp={input => window.workspace.testSmtpSettings(input)} onSaveSmtp={input => window.workspace.saveSmtpSettings(input)} onStatusChange={window.workspace.setMailSettingsStatus} />}
  </>;
}

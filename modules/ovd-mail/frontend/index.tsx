import { useEffect, useRef, useState } from 'react';
import { DraftView } from './DraftView';
import { MailWorkspace } from './MailWorkspace';
import { MailAccounts } from './MailAccounts';
import type { MailAccountSummary, SmtpConfig } from '../../../shared/mail';
import type { Draft, WorkspaceState } from '../../../shared/model';
import type { DraftSaveState } from '../../../shared/drafts';
import type { UiAction } from '../../../shared/actions';
import type { SettingsSuggestion } from '../../../src/settings-preparation';

export function MailModuleView({ state }: { state: WorkspaceState }) {
  return <MailWorkspace drafts={state.drafts} />;
}

export function MailDraftModuleView({ draft, onAction, onError }: { draft?: Draft; onAction(action: UiAction): Promise<void>; onError(message: string): void }) {
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  const [saveState, setSaveState] = useState<DraftSaveState>();
  const [, setPendingVersion] = useState(0);
  const mounted = useRef(true);
  const selectedId = useRef(draft?.id);
  const statusVersion = useRef(0);
  const pendingActions = useRef(new Map<string, Set<Promise<void>>>());
  selectedId.current = draft?.id;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; statusVersion.current++; }; }, []);

  const refreshSaveState = async (draftId: string) => {
    const version = ++statusVersion.current;
    try {
      const result = await window.workspace.getDraftSaveState(draftId);
      if (mounted.current && selectedId.current === draftId && statusVersion.current === version && !pendingActions.current.get(draftId)?.size) setSaveState(result);
    } catch (error) {
      if (mounted.current && selectedId.current === draftId && statusVersion.current === version) setSaveState({ draftId, status: 'error', contentUpdatedAt: '', error: error instanceof Error ? error.message : 'Der Speicherstatus konnte nicht geprüft werden.' });
    }
  };

  useEffect(() => {
    let active = true;
    const load = () => { void window.workspace.listMailAccounts().then(items => { if (active) setAccounts(items); }).catch(() => { if (active) onError('Mailkonten konnten nicht geladen werden.'); }); };
    const unsubscribe = window.workspace.onMailAccountsChanged(load);
    load();
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    setSaveState(undefined);
    statusVersion.current++;
    if (!draft) return;
    const id = draft.id;
    const unsubscribe = window.workspace.onDraftSaveState(status => {
      if (status.draftId !== id) return;
      statusVersion.current++;
      if (!pendingActions.current.get(id)?.size) setSaveState(status);
    });
    void refreshSaveState(id);
    return () => { statusVersion.current++; unsubscribe(); };
  }, [draft?.id]);

  const editDraft = async (action: UiAction) => {
    if (!draft) return;
    const id = draft.id;
    statusVersion.current++;
    setSaveState(previous => ({ draftId: id, status: 'saving', contentUpdatedAt: draft.updatedAt, ...(previous?.savedAt ? { savedAt: previous.savedAt } : {}) }));
    const actions = pendingActions.current.get(id) ?? new Set<Promise<void>>();
    pendingActions.current.set(id, actions);
    const operation = Promise.resolve().then(() => onAction(action));
    actions.add(operation);
    setPendingVersion(value => value + 1);
    try { await operation; }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally {
      actions.delete(operation);
      if (!actions.size) pendingActions.current.delete(id);
      if (mounted.current && selectedId.current === id) {
        setPendingVersion(value => value + 1);
        if (!actions.size) void refreshSaveState(id);
      }
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    const id = draft.id;
    statusVersion.current++;
    setSaveState(previous => ({ draftId: id, status: 'saving', contentUpdatedAt: draft.updatedAt, ...(previous?.savedAt ? { savedAt: previous.savedAt } : {}) }));
    try {
      await Promise.all(pendingActions.current.get(id) ?? []);
      const result = await window.workspace.saveDraft(id);
      if (result.status === 'saved') onError('');
    } catch (error) {
      if (mounted.current && selectedId.current === id) setSaveState({ draftId: id, status: 'error', contentUpdatedAt: draft.updatedAt, error: error instanceof Error ? error.message : 'Der Entwurf konnte nicht gespeichert werden.' });
    } finally {
      if (mounted.current && selectedId.current === id) await refreshSaveState(id);
    }
  };

  const currentStatus = saveState?.draftId === draft?.id ? saveState : undefined;
  const saveStatus = draft && (pendingActions.current.get(draft.id)?.size || currentStatus?.status === 'saved' && currentStatus.contentUpdatedAt !== draft.updatedAt)
    ? { draftId: draft.id, status: 'saving' as const, contentUpdatedAt: draft.updatedAt, savedAt: currentStatus?.savedAt }
    : currentStatus;
  return <DraftView draft={draft} accounts={accounts} saveState={saveStatus} onSave={saveDraft} onUpdate={patch => draft && void editDraft({ type: 'update_draft', draftId: draft.id, patch })} onAttach={async () => {
    try { const file = await window.workspace.chooseFile(); if (file && draft) await editDraft({ type: 'attach_file', draftId: draft.id, file }); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
  }} onRemoveAttachment={index => draft && void editDraft({ type: 'remove_attachment', draftId: draft.id, index })} onSend={draft && accounts.some(account => account.id === draft.accountId) ? async () => { await Promise.all(pendingActions.current.get(draft.id) ?? []); return window.workspace.sendDraft(draft.id); } : undefined} />;
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

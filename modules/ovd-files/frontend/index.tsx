import { useEffect, useState } from 'react';
import type { ModuleViewProps } from '../../../src/module-registry';
import { FilesView } from './FilesView';

export { FilesView } from './FilesView';

export function FilesModuleView({ state, onError }: ModuleViewProps) {
  const [mailReady, setMailReady] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void window.workspace.listModules().then(modules => { if (active) setMailReady(modules.some(module => module.id === 'ovd-mail' && module.status === 'ready')); }).catch(() => { if (active) setMailReady(false); }); };
    const unsubscribe = window.workspace.onModulesChanged(refresh);
    refresh();
    return () => { active = false; unsubscribe(); };
  }, []);
  const draft = mailReady ? state.drafts.find(item => item.id === state.activeDraftId && (!item.deliveryStatus || item.deliveryStatus === 'draft')) : undefined;
  return <FilesView draft={draft} onAttach={async file => {
    if (!draft) return;
    try { await window.workspace.dispatchAction({ type: 'attach_file', draftId: draft.id, file }); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); throw error; }
  }} />;
}

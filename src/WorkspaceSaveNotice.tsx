import { useEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { uiText, useUiLocale } from './locale';
import { workspaceSaveFailureText, type WorkspaceSaveStatus } from '../shared/workspace-save';

type SaveIssue = {
  message?: string;
  code?: WorkspaceSaveStatus['errorCode'];
  retryable: boolean;
  checkingStatus?: boolean;
  saving?: boolean;
};

const statusUnavailable: SaveIssue = {
  retryable: true,
  checkingStatus: true
};

function visibleIssue(status: WorkspaceSaveStatus): SaveIssue | undefined {
  if (status.status === 'saved' || (status.status === 'saving' && !status.error && !status.errorCode)) return undefined;
  return {
    message: status.error,
    code: status.errorCode,
    retryable: status.retryable !== false,
    saving: status.status === 'saving'
  };
}

export function useWorkspaceSaveFeedback() {
  const locale = useUiLocale();
  const [issue, setIssue] = useState<SaveIssue>();
  const [pending, setPending] = useState(false);
  const observation = useRef(0);

  useEffect(() => {
    const stop = window.workspace.onWorkspaceSaveStatus(status => {
      observation.current++;
      setIssue(visibleIssue(status));
    });
    const initial = observation.current;
    void window.workspace.getWorkspaceSaveStatus().then(status => {
      if (initial === observation.current) setIssue(visibleIssue(status));
    }).catch(() => {
      if (initial === observation.current) setIssue(statusUnavailable);
    });
    return () => { observation.current++; stop(); };
  }, []);

  async function retry() {
    if (!issue?.retryable || pending || issue.saving) return;
    const initial = observation.current;
    setPending(true);
    try {
      const status = issue.checkingStatus
        ? await window.workspace.getWorkspaceSaveStatus()
        : await window.workspace.retryWorkspaceSave();
      // A broadcast can deliver a newer revision before this IPC reply.
      if (initial === observation.current) setIssue(visibleIssue(status));
    } catch {
      if (initial === observation.current) setIssue(statusUnavailable);
    } finally {
      setPending(false);
    }
  }
  const message = !issue ? undefined : issue.checkingStatus ? uiText[locale].saveStatusUnavailable
    : issue.code ? workspaceSaveFailureText(locale, issue.code) : issue.message ?? workspaceSaveFailureText(locale, 'write-failed');
  return { issue: issue && { ...issue, message }, pending, retry };
}

export function WorkspaceSaveNotice({ issue, pending, retry }: ReturnType<typeof useWorkspaceSaveFeedback>) {
  const copy = uiText[useUiLocale()];
  if (!issue) return null;
  const working = pending || issue.saving;
  const action = issue.checkingStatus ? copy.checkStatus : copy.retrySave;
  const progress = issue.checkingStatus ? copy.checking : copy.saving;
  return <div className="workspace-save-notice" data-workspace-save-notice="">
    <CircleAlert size={16} aria-hidden="true" />
    <span role="alert">{issue.message}</span>
    {issue.retryable && <button type="button" disabled={working} onClick={() => void retry()}>{working ? progress : action}</button>}
  </div>;
}

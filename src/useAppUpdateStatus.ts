import { useEffect, useState } from 'react';
import type { AppUpdateStatus } from '../shared/app-updates';

export function useAppUpdateStatus(enabled: boolean): AppUpdateStatus | undefined {
  const [status, setStatus] = useState<AppUpdateStatus>();
  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let received = false;
    const unsubscribe = window.workspace.onAppUpdateStatus(next => {
      received = true;
      if (mounted) setStatus(next);
    });
    void window.workspace.getAppUpdateStatus().then(next => {
      if (mounted && !received) setStatus(next);
    }).catch(() => {});
    return () => { mounted = false; unsubscribe(); };
  }, [enabled]);
  return status;
}

import { useEffect, useState } from 'react';
import type { Account, CredentialStatus } from '../app/types';
import { CREDENTIALS_CHANGED_EVENT } from '../app/credentialEvents';
import { IPC } from '../ipc/commands';
import { invoke, listen } from '../tauriBridge';

export default function useAccountCredentialHealth(accounts: Account[]) {
  const [statuses, setStatuses] = useState<CredentialStatus[]>([]);
  const [error, setError] = useState(false);
  const key = accounts.map(({ id, email, auth_type }) => `${id}:${email}:${auth_type}`).join('|');
  useEffect(() => {
    let disposed = false;
    let running = false;
    let revision = 0;
    let unlisten: (() => void) | undefined;
    setStatuses([]);
    setError(false);
    const refresh = async () => {
      revision += 1;
      if (disposed || running || !key) return;
      running = true;
      try {
        let started: number;
        do {
          started = revision;
          try {
            const result = await invoke<CredentialStatus[]>(IPC.ListAccountCredentialStatuses);
            if (!disposed && started === revision) {
              setStatuses(result);
              setError(false);
            }
          } catch {
            if (!disposed && started === revision) setError(true);
          }
        } while (!disposed && started !== revision);
      } finally { running = false; }
    };
    const onRefresh = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState !== 'hidden') onRefresh(); };
    onRefresh();
    window.addEventListener(CREDENTIALS_CHANGED_EVENT, onRefresh);
    window.addEventListener('focus', onRefresh);
    document.addEventListener('visibilitychange', onVisible);
    void Promise.resolve().then(() => listen(CREDENTIALS_CHANGED_EVENT, onRefresh))
      .then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; }).catch(() => undefined);
    const timer = window.setInterval(onVisible, 30_000);
    return () => {
      disposed = true;
      unlisten?.();
      window.clearInterval(timer);
      window.removeEventListener(CREDENTIALS_CHANGED_EVENT, onRefresh);
      window.removeEventListener('focus', onRefresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);
  return { statuses, error };
}

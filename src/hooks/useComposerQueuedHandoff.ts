import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { OutboxItem } from '../app/types';
import type { PendingSendUndo } from '../components/UndoSnackbarStack';
import { COMPOSER_QUEUED_EVENT, listen } from '../tauriBridge';

export default function useComposerQueuedHandoff(
  enabled: boolean,
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>,
  setPendingSendUndo: Dispatch<SetStateAction<PendingSendUndo | null>>,
  setStatus: Dispatch<SetStateAction<string>>,
) {
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<{ item: OutboxItem; undo: PendingSendUndo }>(COMPOSER_QUEUED_EVENT, ({ payload: { item, undo } }) => {
      if (!active) return;
      setOutbox((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      if (Date.parse(undo.expiresAt) > Date.now()) setPendingSendUndo(undo);
    }).then((stop) => {
      if (active) unlisten = stop;
      else stop();
    }).catch((error) => { if (active) setStatus(`发送状态监听失败：${String(error)}`); });
    return () => { active = false; unlisten?.(); };
  }, [enabled, setOutbox, setPendingSendUndo, setStatus]);
}

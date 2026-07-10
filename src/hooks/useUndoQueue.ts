import React from 'react';
import type { UndoAction, UndoMessageSnapshot } from '../app/types';

export default function useUndoQueue(timeoutMs = 7000) {
  const [undoAction, setUndoAction] = React.useState<UndoAction | null>(null);
  const timerRef = React.useRef<number | null>(null);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const clearUndoAction = React.useCallback(() => {
    clearTimer();
    setUndoAction(null);
  }, [clearTimer]);

  const queueUndoAction = React.useCallback((
    title: string,
    snapshots: UndoMessageSnapshot[],
    detail?: string,
  ) => {
    if (snapshots.length === 0) return;
    clearTimer();
    setUndoAction({
      id: `${Date.now()}-${snapshots.map((item) => item.id).join('-')}`,
      title,
      detail: detail ?? (snapshots.length === 1 ? snapshots[0].subject : `${snapshots.length} 封邮件`),
      snapshots,
    });
    timerRef.current = window.setTimeout(() => {
      setUndoAction(null);
      timerRef.current = null;
    }, timeoutMs);
  }, [clearTimer, timeoutMs]);

  const consumeUndoAction = React.useCallback(() => {
    if (!undoAction) return null;
    clearTimer();
    setUndoAction(null);
    return undoAction;
  }, [clearTimer, undoAction]);

  React.useEffect(() => clearTimer, [clearTimer]);

  return {
    undoAction,
    clearUndoAction,
    consumeUndoAction,
    queueUndoAction,
  };
}

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Account, OutboxItem } from '../app/types';
import type { PendingSendUndo } from '../components/UndoSnackbarStack';
import { syncIntervalMs } from '../mailUtils';
import {
  fetchTimerLog,
  fetchTimerWarn,
  nextOutboxWakeItem,
  outboxFlowLog,
  syncModeStatus,
} from '../app/backgroundTaskFlow';
import { isPermissionGranted } from '../tauriBridge';

type BackgroundSchedulerOptions = {
  account: Account | null;
  outbox: OutboxItem[];
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
  setPendingSendUndo: Dispatch<SetStateAction<PendingSendUndo | null>>;
  setNotificationStatus: Dispatch<SetStateAction<string>>;
  setBackgroundSyncStatus: Dispatch<SetStateAction<string>>;
  setStatus: Dispatch<SetStateAction<string>>;
  showToast: (text: string) => void;
  sendDueOutboxItems: () => Promise<{ message: string; items: OutboxItem[] }>;
  enqueueBackgroundTask: (kind: 'sync', source: 'manual' | 'timer') => Promise<void>;
};

export default function useBackgroundScheduler({
  account,
  outbox,
  setOutbox,
  setPendingSendUndo,
  setNotificationStatus,
  setBackgroundSyncStatus,
  setStatus,
  showToast,
  sendDueOutboxItems,
  enqueueBackgroundTask,
}: BackgroundSchedulerOptions) {
  const outboxScheduleTimerRef = useRef<number | null>(null);
  const enqueueBackgroundTaskRef = useRef(enqueueBackgroundTask);
  enqueueBackgroundTaskRef.current = enqueueBackgroundTask;

  useEffect(() => {
    isPermissionGranted()
      .then((granted) => setNotificationStatus(granted ? '系统提醒已启用' : '系统提醒待授权'))
      .catch(() => setNotificationStatus('系统提醒不可用'));
  }, [setNotificationStatus]);

  useEffect(() => {
    if (outboxScheduleTimerRef.current) {
      window.clearTimeout(outboxScheduleTimerRef.current);
      outboxScheduleTimerRef.current = null;
    }

    const nextScheduledItem = nextOutboxWakeItem(outbox);
    if (!nextScheduledItem) return;

    const maxTimerDelay = 2_147_000_000;
    const dueAt = Date.parse(nextScheduledItem.next_attempt_at);
    const timerDelay = Math.min(Math.max(dueAt - Date.now(), 0), maxTimerDelay);
    outboxScheduleTimerRef.current = window.setTimeout(() => {
      outboxScheduleTimerRef.current = null;
      if (dueAt > Date.now()) {
        setOutbox((current) => [...current]);
        return;
      }
      setPendingSendUndo((current) => (
        current?.outboxId === nextScheduledItem.id ? null : current
      ));
      outboxFlowLog('scheduled smtp timer fired', {
        outboxId: nextScheduledItem.id,
        messageId: nextScheduledItem.message_id,
        dueAt: nextScheduledItem.next_attempt_at,
      });
      sendDueOutboxItems()
        .then(({ items }) => {
          const flushedItem = items.find((entry) => entry.id === nextScheduledItem.id);
          const delivered =
            !flushedItem ||
            flushedItem.status === 'sent' ||
            flushedItem.status === 'sent_remote_pending';
          if (delivered) showToast('邮件已发送');
        })
        .catch((error) => setStatus(String(error)));
    }, timerDelay);

    return () => {
      if (outboxScheduleTimerRef.current) {
        window.clearTimeout(outboxScheduleTimerRef.current);
        outboxScheduleTimerRef.current = null;
      }
    };
  }, [
    outbox,
    sendDueOutboxItems,
    setOutbox,
    setPendingSendUndo,
    setStatus,
    showToast,
  ]);

  useEffect(() => {
    const intervalMs = syncIntervalMs(account?.sync_mode ?? 'manual');
    if (!intervalMs) {
      fetchTimerLog('disabled', {
        accountId: account?.id ?? null,
        email: account?.email ?? null,
        syncMode: account?.sync_mode ?? 'manual',
      });
      setBackgroundSyncStatus(syncModeStatus(account?.sync_mode ?? 'manual'));
      return;
    }
    fetchTimerLog('enabled', {
      accountId: account?.id ?? null,
      email: account?.email ?? null,
      syncMode: account?.sync_mode ?? 'manual',
      intervalMs,
      nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
    });
    setBackgroundSyncStatus(syncModeStatus(account?.sync_mode ?? 'manual'));
    const timer = window.setInterval(() => {
      fetchTimerLog('timer fired', {
        accountId: account?.id ?? null,
        syncMode: account?.sync_mode ?? 'manual',
      });
      enqueueBackgroundTaskRef.current('sync', 'timer').catch((error) => {
        fetchTimerWarn('enqueue failed', {
          accountId: account?.id ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
        setStatus(String(error));
      });
    }, intervalMs);
    return () => {
      fetchTimerLog('cleared', {
        accountId: account?.id ?? null,
        syncMode: account?.sync_mode ?? 'manual',
      });
      window.clearInterval(timer);
    };
  }, [
    account?.email,
    account?.id,
    account?.sync_mode,
    setBackgroundSyncStatus,
    setStatus,
  ]);

  return { outboxScheduleTimerRef };
}

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  newMailNotificationDecision,
  notificationThreadScopeKey,
  syncIntervalMs,
  syncStatusLabel,
  type NotificationPolicy,
} from '../mailUtils';
import {
  diagnosticInfo,
  diagnosticWarn,
  flowInfo,
  flowWarn,
} from '../app/logger';
import {
  invoke,
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '../tauriBridge';
import {
  fetchTimerLog,
  fetchTimerWarn,
  nextOutboxWakeItem,
  outboxFlowLog,
  syncModeStatus,
} from '../app/backgroundTaskFlow';
import type {
  Account,
  AccountScope,
  BackgroundTask,
  BackgroundTaskKind,
  FilterMode,
  Folder,
  MessageSummary,
  OutboxItem,
  SyncRun,
  SyncSchedulePlan,
} from '../app/types';
import type { PendingSendUndo } from '../components/UndoSnackbarStack';
import useBackgroundScheduler from './useBackgroundScheduler';
import useNewMailNotifier from './useNewMailNotifier';
import useOutboxFlush from './useOutboxFlush';

type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type UseBackgroundTaskCoordinatorOptions = {
  account: Account | null;
  accountScope: AccountScope;
  folderId: number | null;
  query: string;
  filter: FilterMode;
  messages: MessageSummary[];
  outbox: OutboxItem[];
  notificationPolicy: NotificationPolicy;
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
  setBackgroundTasks: Dispatch<SetStateAction<BackgroundTask[]>>;
  setBackgroundSyncStatus: Dispatch<SetStateAction<string>>;
  setSyncSchedulePlan: Dispatch<SetStateAction<SyncSchedulePlan | null>>;
  setSyncRuns: Dispatch<SetStateAction<SyncRun[]>>;
  setLastNewMailNotice: Dispatch<SetStateAction<string | null>>;
  setNotificationStatus: Dispatch<SetStateAction<string>>;
  setPendingSendUndo: Dispatch<SetStateAction<PendingSendUndo | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  showToast: (text: string) => void;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
    options?: { mode?: 'full' | 'mailbox' },
  ) => Promise<LoadMetaResult>;
  loadMessages: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
  ) => Promise<MessageSummary[]>;
  releaseDueSnoozedMessages: () => Promise<{ released_count: number }>;
};

type CurrentCoordinatorState = Pick<
  UseBackgroundTaskCoordinatorOptions,
  | 'accountScope'
  | 'folderId'
  | 'query'
  | 'filter'
  | 'messages'
  | 'notificationPolicy'
  | 'loadMeta'
  | 'loadMessages'
  | 'releaseDueSnoozedMessages'
>;

export default function useBackgroundTaskCoordinator({
  account,
  accountScope,
  folderId,
  query,
  filter,
  messages,
  outbox,
  notificationPolicy,
  setOutbox,
  setBackgroundTasks,
  setBackgroundSyncStatus,
  setSyncSchedulePlan,
  setSyncRuns,
  setLastNewMailNotice,
  setNotificationStatus,
  setPendingSendUndo,
  setStatus,
  showToast,
  loadMeta,
  loadMessages,
  releaseDueSnoozedMessages,
}: UseBackgroundTaskCoordinatorOptions) {
  const backgroundSyncRef = useRef(false);
  const backgroundTaskWorkerRef = useRef(false);
  const currentRef = useRef<CurrentCoordinatorState>({
    accountScope,
    folderId,
    query,
    filter,
    messages,
    notificationPolicy,
    loadMeta,
    loadMessages,
    releaseDueSnoozedMessages,
  });
  currentRef.current = {
    accountScope,
    folderId,
    query,
    filter,
    messages,
    notificationPolicy,
    loadMeta,
    loadMessages,
    releaseDueSnoozedMessages,
  };

  const getCurrentMessages = useCallback(() => currentRef.current.messages, []);

  const refreshMailboxContext = useCallback(async () => {
    const current = currentRef.current;
    const meta = await current.loadMeta(current.folderId, current.accountScope, { mode: 'mailbox' });
    await current.loadMessages(meta.folderId, current.query, current.filter, current.accountScope);
  }, []);

  const { notifyNewMail } = useNewMailNotifier({
    notificationPolicy,
    getCurrentMessages,
    setLastNewMailNotice,
    setNotificationStatus,
  });
  const {
    flushOutboxDryRun,
    flushOutboxSmtp,
    sendDueOutboxItems,
  } = useOutboxFlush({
    setOutbox,
    setStatus,
    refreshMailboxContext,
  });

  const refreshBackgroundTasks = useCallback(async () => {
    const tasks = await invoke<BackgroundTask[]>('list_background_tasks');
    setBackgroundTasks(tasks);
    return tasks;
  }, [setBackgroundTasks]);

  const runBackgroundSync = useCallback(async (reason: 'manual' | 'timer'): Promise<string> => {
    if (backgroundSyncRef.current) {
      fetchTimerLog('sync skipped: already running', { reason });
      return '同步任务已在运行';
    }
    backgroundSyncRef.current = true;
    const current = currentRef.current;
    const syncAccountId = current.accountScope === 'all' ? null : current.accountScope;
    const startedAt = performance.now();
    fetchTimerLog('sync start', {
      reason,
      accountId: syncAccountId,
      folderId: current.folderId,
      scope: current.accountScope,
      query: current.query.trim() || null,
      filter: current.filter,
    });
    setBackgroundSyncStatus(reason === 'timer' ? '后台同步中...' : '手动同步中...');
    try {
      const plan = await invoke<SyncSchedulePlan>('get_sync_schedule_plan', { accountId: syncAccountId });
      fetchTimerLog('sync plan', {
        reason,
        accountId: syncAccountId,
        totalAccounts: plan.total_accounts,
        batchAccounts: plan.batch_accounts.map((item) => item.id),
        delayedAccounts: plan.delayed_accounts.map((item) => item.id),
      });
      setSyncSchedulePlan(plan);
      setBackgroundSyncStatus(
        plan.total_accounts > 1
          ? `同步中：本轮 ${plan.batch_accounts.length}/${plan.total_accounts} 个账号`
          : reason === 'timer'
            ? '后台同步中...'
            : '手动同步中...',
      );
      const run = await invoke<SyncRun>('sync_imap_headers', { accountId: syncAccountId });
      const released = await current.releaseDueSnoozedMessages();
      setSyncRuns((existing) => [run, ...existing].slice(0, 10));
      await current.loadMeta(current.folderId, current.accountScope, { mode: 'mailbox' });
      const latestMessages = await current.loadMessages(
        current.folderId,
        current.query,
        current.filter,
        current.accountScope,
      );
      const summary =
        released.released_count > 0
          ? `${syncStatusLabel(run)}；已恢复 ${released.released_count} 封稍后邮件`
          : syncStatusLabel(run);
      setBackgroundSyncStatus(summary);
      await notifyNewMail(run, latestMessages);
      fetchTimerLog('sync done', {
        reason,
        accountId: syncAccountId,
        status: run.status,
        scannedFolders: run.scanned_folders,
        importedMessages: run.imported_messages,
        releasedSnoozedMessages: released.released_count,
        visibleMessages: latestMessages.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      if (reason === 'manual') {
        setStatus(released.released_count > 0 ? `${run.message} 已恢复 ${released.released_count} 封稍后邮件。` : run.message);
      }
      return summary;
    } catch (error) {
      const message = String(error);
      fetchTimerWarn('sync failed', {
        reason,
        accountId: syncAccountId,
        error: message,
        durationMs: Math.round(performance.now() - startedAt),
      });
      setBackgroundSyncStatus(`后台同步暂停：${message}`);
      if (reason === 'manual') setStatus(message);
      throw error;
    } finally {
      backgroundSyncRef.current = false;
    }
  }, [
    notifyNewMail,
    setBackgroundSyncStatus,
    setStatus,
    setSyncRuns,
    setSyncSchedulePlan,
  ]);

  const executeBackgroundTask = useCallback(async (task: BackgroundTask): Promise<string> => {
    if (task.kind === 'sync') return runBackgroundSync(task.source);
    if (task.kind === 'outbox-smtp' && task.source === 'timer') return (await sendDueOutboxItems()).message;
    if (task.kind === 'outbox-smtp') return flushOutboxSmtp();
    return flushOutboxDryRun();
  }, [flushOutboxDryRun, flushOutboxSmtp, runBackgroundSync, sendDueOutboxItems]);

  const drainBackgroundTaskQueue = useCallback(async () => {
    if (backgroundTaskWorkerRef.current) return;
    backgroundTaskWorkerRef.current = true;
    try {
      while (true) {
        const nextTask = await invoke<BackgroundTask | null>('next_background_task');
        if (!nextTask) break;

        const runningTask = await invoke<BackgroundTask>('mark_background_task_running', { taskId: nextTask.id });
        await refreshBackgroundTasks();
        setBackgroundSyncStatus(`${runningTask.title}执行中...`);
        try {
          const message = await executeBackgroundTask(runningTask);
          await invoke<BackgroundTask>('complete_background_task', {
            taskId: runningTask.id,
            message,
          });
          await refreshBackgroundTasks();
          setBackgroundSyncStatus(message);
        } catch (error) {
          const message = String(error);
          await invoke<BackgroundTask>('fail_background_task', {
            taskId: runningTask.id,
            message,
          });
          await refreshBackgroundTasks();
          setBackgroundSyncStatus(`${runningTask.title}失败：${message}`);
          if (runningTask.source === 'manual') setStatus(message);
        }
      }
    } finally {
      backgroundTaskWorkerRef.current = false;
    }
  }, [
    executeBackgroundTask,
    refreshBackgroundTasks,
    setBackgroundSyncStatus,
    setStatus,
  ]);

  const enqueueBackgroundTask = useCallback(async (
    kind: BackgroundTaskKind,
    source: 'manual' | 'timer' = 'manual',
  ) => {
    fetchTimerLog('enqueue start', { kind, source });
    const task = await invoke<BackgroundTask>('enqueue_background_task', { input: { kind, source } });
    const tasks = await refreshBackgroundTasks();
    const isReusedActiveTask = task.kind === 'sync' && task.status !== 'queued';
    fetchTimerLog('enqueue done', {
      kind: task.kind,
      source: task.source,
      taskId: task.id,
      taskStatus: task.status,
      queuedTasks: tasks.filter((item) => item.status === 'queued').length,
    });
    setBackgroundSyncStatus(isReusedActiveTask ? '同步任务已在队列中' : `${task.title} 已入队`);
    if (!tasks.some((item) => item.status === 'queued')) return;
    void drainBackgroundTaskQueue();
  }, [drainBackgroundTaskQueue, refreshBackgroundTasks, setBackgroundSyncStatus]);


  useBackgroundScheduler({
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
  });

  return { enqueueBackgroundTask };
}

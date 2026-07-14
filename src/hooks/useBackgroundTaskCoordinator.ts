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
import type {
  Account,
  AccountScope,
  BackgroundTask,
  BackgroundTaskKind,
  FilterMode,
  Folder,
  Message,
  OutboxItem,
  SyncRun,
  SyncSchedulePlan,
} from '../app/types';
import type { PendingSendUndo } from '../components/UndoSnackbarStack';

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
  messages: Message[];
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
  ) => Promise<Message[]>;
  releaseDueSnoozedMessages: () => Promise<Message[]>;
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

const scheduledOutboxStatuses = new Set(['scheduled']);

function syncModeStatus(syncMode: string) {
  const intervalMs = syncIntervalMs(syncMode);
  if (!intervalMs) return '后台获取新邮件已关闭';
  const minutes = Math.round(intervalMs / 60_000);
  return `后台获取新邮件已启用：每 ${minutes} 分钟`;
}

function outboxFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('outbox-flow', event, details);
}

function outboxFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('outbox-flow', event, details);
}

function fetchTimerLog(event: string, details: Record<string, unknown> = {}) {
  diagnosticInfo('[better-email][fetch-timer]', event, details);
}

function fetchTimerWarn(event: string, details: Record<string, unknown> = {}) {
  diagnosticWarn('[better-email][fetch-timer]', event, details);
}

type OutboxInvoke = <T>(command: string) => Promise<T>;

export async function runDueOutboxSmtp(invokeCommand: OutboxInvoke = invoke): Promise<OutboxItem[]> {
  await invokeCommand<OutboxItem[]>('release_due_outbox_items');
  return invokeCommand<OutboxItem[]>('flush_outbox_smtp');
}

export function nextOutboxWakeItem(items: OutboxItem[]): OutboxItem | null {
  let nextItem: OutboxItem | null = null;
  let nextTimestamp = Number.POSITIVE_INFINITY;

  for (const item of items) {
    if (!scheduledOutboxStatuses.has(item.status) || !item.next_attempt_at) continue;
    const timestamp = Date.parse(item.next_attempt_at);
    if (!Number.isFinite(timestamp) || timestamp >= nextTimestamp) continue;
    nextItem = item;
    nextTimestamp = timestamp;
  }

  return nextItem;
}

export function outboxFlushMessage(items: OutboxItem[]): string {
  let failed = 0;
  let blocked = 0;
  let pendingRetry = 0;
  let archivePending = 0;

  for (const item of items) {
    if (item.status === 'retry') {
      failed += 1;
      if (item.next_attempt_at) pendingRetry += 1;
    } else if (item.status === 'failed') {
      blocked += 1;
    } else if (item.status === 'sent_remote_pending') {
      archivePending += 1;
    }
  }

  if (blocked > 0) {
    return `SMTP 发送暂停，${blocked} 封需要重新保存账号授权码`;
  }
  if (failed > 0) {
    return `SMTP 发送完成，${failed} 封需重试${pendingRetry > 0 ? '，已安排下次尝试' : ''}`;
  }
  if (archivePending > 0) {
    return `SMTP 发送完成，${archivePending} 封仅等待远端已发送留档重试`;
  }
  return 'SMTP 发件箱发送完成';
}

function outboxStatusCounts(items: OutboxItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

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
  loadMeta,
  loadMessages,
  releaseDueSnoozedMessages,
}: UseBackgroundTaskCoordinatorOptions) {
  const outboxScheduleTimerRef = useRef<number | null>(null);
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

  const refreshBackgroundTasks = useCallback(async () => {
    const tasks = await invoke<BackgroundTask[]>('list_background_tasks');
    setBackgroundTasks(tasks);
    return tasks;
  }, [setBackgroundTasks]);

  const notifyNewMail = useCallback(async (run: SyncRun, latestMessages?: Message[]) => {
    const current = currentRef.current;
    const candidates = (latestMessages ?? current.messages)
      .slice(0, Math.max(0, run.imported_messages));
    const accountIds = [...new Set(
      candidates
        .map((message) => message.account_id)
        .filter((accountId) => accountId > 0),
    )];
    const mutedThreadScopes = (
      await Promise.all(accountIds.map(async (accountId) => {
        const threadKeys = await invoke<string[]>('list_muted_thread_keys', { accountId });
        return threadKeys.map((threadKey) => notificationThreadScopeKey({
          account_id: accountId,
          thread_key: threadKey,
          sender_email: '',
          sender_name: '',
          subject: '',
        }));
      }))
    ).flat();
    const decision = newMailNotificationDecision(
      run,
      current.notificationPolicy,
      latestMessages ?? current.messages,
      new Date(),
      mutedThreadScopes,
    );
    const body = decision.body;
    setLastNewMailNotice(body);
    if (!body) {
      if (decision.reason === 'quiet-hours') setNotificationStatus('免打扰时段已静音');
      if (decision.reason === 'vip-only-no-match') setNotificationStatus('VIP 策略已过滤');
      if (decision.reason === 'account-muted') setNotificationStatus('账号静音已过滤');
      if (decision.reason === 'thread-muted') setNotificationStatus('静音会话已过滤');
      return;
    }

    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }
      if (!granted) {
        setNotificationStatus('系统提醒未授权');
        return;
      }
      sendNotification({ title: 'Better Email', body });
      setNotificationStatus(
        decision.vipMatches > 0
          ? 'VIP 系统提醒已发送'
          : decision.priorityMatches > 0
            ? '重点账号提醒已发送'
            : '系统提醒已发送',
      );
    } catch {
      setNotificationStatus('系统提醒不可用');
    }
  }, [setLastNewMailNotice, setNotificationStatus]);

  const flushOutboxDryRun = useCallback(async (): Promise<string> => {
    const items = await invoke<OutboxItem[]>('flush_outbox_dry_run');
    setOutbox(items);
    const current = currentRef.current;
    const meta = await current.loadMeta(current.folderId, current.accountScope, { mode: 'mailbox' });
    await current.loadMessages(meta.folderId, current.query, current.filter, current.accountScope);
    const message = '发件箱队列已完成本地发送演练';
    setStatus(message);
    return message;
  }, [setOutbox, setStatus]);

  const flushOutboxSmtp = useCallback(async (): Promise<string> => {
    outboxFlowLog('manual smtp flush start');
    const items = await invoke<OutboxItem[]>('flush_outbox_smtp');
    setOutbox(items);
    const current = currentRef.current;
    const meta = await current.loadMeta(current.folderId, current.accountScope, { mode: 'mailbox' });
    await current.loadMessages(meta.folderId, current.query, current.filter, current.accountScope);
    const message = outboxFlushMessage(items);
    outboxFlowLog('manual smtp flush done', {
      outboxItems: items.length,
      statuses: outboxStatusCounts(items),
      message,
    });
    setStatus(message);
    return message;
  }, [setOutbox, setStatus]);

  const sendDueOutboxItems = useCallback(async (): Promise<string> => {
    outboxFlowLog('scheduled smtp due start');
    let items: OutboxItem[];
    try {
      items = await runDueOutboxSmtp();
    } catch (error) {
      outboxFlowWarn('scheduled smtp due failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    setOutbox(items);
    const current = currentRef.current;
    const meta = await current.loadMeta(current.folderId, current.accountScope, { mode: 'mailbox' });
    await current.loadMessages(meta.folderId, current.query, current.filter, current.accountScope);
    const message = outboxFlushMessage(items);
    outboxFlowLog('scheduled smtp due done', {
      outboxItems: items.length,
      statuses: outboxStatusCounts(items),
      message,
    });
    setStatus(message);
    return message;
  }, [setOutbox, setStatus]);

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
        released.length > 0
          ? `${syncStatusLabel(run)}；已恢复 ${released.length} 封稍后邮件`
          : syncStatusLabel(run);
      setBackgroundSyncStatus(summary);
      await notifyNewMail(run, latestMessages);
      fetchTimerLog('sync done', {
        reason,
        accountId: syncAccountId,
        status: run.status,
        scannedFolders: run.scanned_folders,
        importedMessages: run.imported_messages,
        releasedSnoozedMessages: released.length,
        visibleMessages: latestMessages.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      if (reason === 'manual') {
        setStatus(released.length > 0 ? `${run.message} 已恢复 ${released.length} 封稍后邮件。` : run.message);
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
    if (task.kind === 'outbox-smtp' && task.source === 'timer') return sendDueOutboxItems();
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
      sendDueOutboxItems().catch((error) => setStatus(String(error)));
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
      enqueueBackgroundTask('sync', 'timer').catch((error) => {
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
    enqueueBackgroundTask,
    setBackgroundSyncStatus,
    setStatus,
  ]);

  return { enqueueBackgroundTask };
}

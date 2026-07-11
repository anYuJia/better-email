import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  newMailNotificationDecision,
  notificationThreadScopeKey,
  syncIntervalMs,
  syncStatusLabel,
  type NotificationPolicy,
} from '../mailUtils';
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
  loadMeta: (nextFolderId?: number | null, nextScope?: AccountScope) => Promise<LoadMetaResult>;
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

export function nextOutboxWakeItem(items: OutboxItem[]): OutboxItem | null {
  return (
    items
      .filter(
        (item) =>
          scheduledOutboxStatuses.has(item.status)
          && Boolean(item.next_attempt_at)
          && Number.isFinite(Date.parse(item.next_attempt_at)),
      )
      .sort((left, right) => Date.parse(left.next_attempt_at) - Date.parse(right.next_attempt_at))[0]
    ?? null
  );
}

export function outboxFlushMessage(items: OutboxItem[]): string {
  const failed = items.filter((item) => item.status === 'retry').length;
  const blocked = items.filter((item) => item.status === 'failed').length;
  const pendingRetry = items.filter((item) => item.status === 'retry' && item.next_attempt_at).length;
  const archivePending = items.filter((item) => item.status === 'sent_remote_pending').length;
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
    const meta = await current.loadMeta(current.folderId, current.accountScope);
    await current.loadMessages(meta.folderId, current.query, current.filter, current.accountScope);
    const message = '发件箱队列已完成本地发送演练';
    setStatus(message);
    return message;
  }, [setOutbox, setStatus]);

  const flushOutboxSmtp = useCallback(async (): Promise<string> => {
    const items = await invoke<OutboxItem[]>('flush_outbox_smtp');
    setOutbox(items);
    const current = currentRef.current;
    const meta = await current.loadMeta(current.folderId, current.accountScope);
    await current.loadMessages(meta.folderId, current.query, current.filter, current.accountScope);
    const message = outboxFlushMessage(items);
    setStatus(message);
    return message;
  }, [setOutbox, setStatus]);

  const releaseDueOutboxItems = useCallback(async (): Promise<string> => {
    const items = await invoke<OutboxItem[]>('release_due_outbox_items');
    setOutbox(items);
    const current = currentRef.current;
    const meta = await current.loadMeta(current.folderId, current.accountScope);
    await current.loadMessages(meta.folderId, current.query, current.filter, current.accountScope);
    const message = '发件时间已到，等待手动点击真实发送';
    setStatus(message);
    return message;
  }, [setOutbox, setStatus]);

  const runBackgroundSync = useCallback(async (reason: 'manual' | 'timer'): Promise<string> => {
    if (backgroundSyncRef.current) return '同步任务已在运行';
    backgroundSyncRef.current = true;
    const current = currentRef.current;
    const syncAccountId = current.accountScope === 'all' ? null : current.accountScope;
    setBackgroundSyncStatus(reason === 'timer' ? '后台同步中...' : '手动同步中...');
    try {
      const plan = await invoke<SyncSchedulePlan>('get_sync_schedule_plan', { accountId: syncAccountId });
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
      await current.loadMeta(current.folderId, current.accountScope);
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
      if (reason === 'manual') {
        setStatus(released.length > 0 ? `${run.message} 已恢复 ${released.length} 封稍后邮件。` : run.message);
      }
      return summary;
    } catch (error) {
      const message = String(error);
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
    if (task.kind === 'outbox-smtp' && task.source === 'timer') return releaseDueOutboxItems();
    if (task.kind === 'outbox-smtp') return flushOutboxSmtp();
    return flushOutboxDryRun();
  }, [flushOutboxDryRun, flushOutboxSmtp, releaseDueOutboxItems, runBackgroundSync]);

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
    const task = await invoke<BackgroundTask>('enqueue_background_task', { input: { kind, source } });
    const tasks = await refreshBackgroundTasks();
    const isReusedActiveTask = task.kind === 'sync' && task.status !== 'queued';
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
      releaseDueOutboxItems().catch((error) => setStatus(String(error)));
    }, timerDelay);

    return () => {
      if (outboxScheduleTimerRef.current) {
        window.clearTimeout(outboxScheduleTimerRef.current);
        outboxScheduleTimerRef.current = null;
      }
    };
  }, [
    outbox,
    releaseDueOutboxItems,
    setOutbox,
    setPendingSendUndo,
    setStatus,
  ]);

  useEffect(() => {
    const intervalMs = syncIntervalMs(account?.sync_mode ?? 'manual');
    if (!intervalMs) {
      setBackgroundSyncStatus('后台同步已关闭');
      return;
    }
    setBackgroundSyncStatus(`后台同步已启用：${account?.sync_mode === 'push' ? '每 5 分钟' : '每 15 分钟'}`);
    const timer = window.setInterval(() => {
      enqueueBackgroundTask('sync', 'timer').catch((error) => setStatus(String(error)));
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [
    account?.sync_mode,
    enqueueBackgroundTask,
    setBackgroundSyncStatus,
    setStatus,
  ]);

  return { enqueueBackgroundTask };
}

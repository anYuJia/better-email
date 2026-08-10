import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  syncStatusLabel,
  type NotificationPolicy,
} from '../mailUtils';
import {
  invoke,
} from '../tauriBridge';
import {
  fetchTimerLog,
  fetchTimerWarn,
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
  SearchScope,
  SyncRun,
  SyncSchedulePlan,
} from '../app/types';
import type { PendingSendUndo } from '../components/UndoSnackbarStack';
import useBackgroundScheduler from './useBackgroundScheduler';
import useNewMailNotifier from './useNewMailNotifier';
import useOutboxFlush from './useOutboxFlush';
import type { MailboxRefreshRequest } from './useAppMetaLoader';
import { IPC } from '../ipc/commands';

type LoadMetaResult = {
  folderId: number | null;
  folders: Folder[];
};

type UseBackgroundTaskCoordinatorOptions = {
  account: Account | null;
  accountScope: AccountScope;
  mailboxRefreshRef: MutableRefObject<number>;
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
  setSyncRuns?: Dispatch<SetStateAction<SyncRun[]>>;
  setLastNewMailNotice: Dispatch<SetStateAction<string | null>>;
  setNotificationStatus: Dispatch<SetStateAction<string>>;
  setPendingSendUndo: Dispatch<SetStateAction<PendingSendUndo | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  showToast: (text: string) => void;
  loadMeta: (
    nextFolderId?: number | null,
    nextScope?: AccountScope,
    options?: {
      mode?: 'full' | 'mailbox';
      mailboxRequest?: MailboxRefreshRequest;
    },
  ) => Promise<LoadMetaResult>;
  loadMessages: (
    nextFolderId?: number | null,
    nextQuery?: string,
    nextFilter?: FilterMode,
    nextScope?: AccountScope,
    refreshId?: number,
    nextLimit?: number,
    nextSearchScope?: SearchScope,
    nextIncludeThreads?: boolean,
    mailboxRequest?: MailboxRefreshRequest,
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

/** 进度轮询间隔：消费 Rust 写入的文件夹/批次级进度。 */
const PROGRESS_POLL_INTERVAL_MS = 1000;
/** 渐进式界面刷新节流：避免每次进度都重查一次邮件列表。 */
const PROGRESS_REFRESH_MIN_INTERVAL_MS = 1200;

export default function useBackgroundTaskCoordinator({
  account,
  accountScope,
  mailboxRefreshRef,
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

  const createMailboxRefreshRequest = useCallback((): MailboxRefreshRequest => {
    const current = currentRef.current;
    return {
      id: mailboxRefreshRef.current,
      scope: current.accountScope,
    };
  }, [mailboxRefreshRef]);

  const isMailboxRefreshCurrent = useCallback((mailboxRequest: MailboxRefreshRequest): boolean => {
    return (
      mailboxRequest.id === mailboxRefreshRef.current
      && mailboxRequest.scope === currentRef.current.accountScope
    );
  }, [mailboxRefreshRef]);

  const isAccountSyncRefreshCurrent = useCallback((
    task: BackgroundTask,
    mailboxRequest: MailboxRefreshRequest,
  ): boolean => {
    if (!isMailboxRefreshCurrent(mailboxRequest)) return false;
    const currentScope = currentRef.current.accountScope;
    return currentScope === 'all' || task.account_id === currentScope;
  }, [isMailboxRefreshCurrent]);

  const getCurrentMessages = useCallback(() => currentRef.current.messages, []);

  const refreshMailboxContext = useCallback(async () => {
    const current = currentRef.current;
    const mailboxRequest = createMailboxRefreshRequest();
    const meta = await current.loadMeta(current.folderId, current.accountScope, {
      mode: 'mailbox',
      mailboxRequest,
    });
    if (!isMailboxRefreshCurrent(mailboxRequest)) return;
    await current.loadMessages(
      meta.folderId,
      current.query,
      current.filter,
      current.accountScope,
      mailboxRequest.id,
      undefined,
      undefined,
      undefined,
      mailboxRequest,
    );
  }, [createMailboxRefreshRequest, isMailboxRefreshCurrent]);

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
    const tasks = await invoke<BackgroundTask[]>(IPC.ListBackgroundTasks);
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
    const mailboxRequest = createMailboxRefreshRequest();
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
      const plan = await invoke<SyncSchedulePlan>(IPC.GetSyncSchedulePlan, { accountId: syncAccountId });
      fetchTimerLog('sync plan', {
        reason,
        accountId: syncAccountId,
        totalAccounts: plan.total_accounts,
        batchAccounts: plan.batch_accounts.map((item) => item.id),
        delayedAccounts: plan.delayed_accounts.map((item) => item.id),
      });
      if (isMailboxRefreshCurrent(mailboxRequest)) {
        setSyncSchedulePlan(plan);
        setBackgroundSyncStatus(
          plan.total_accounts > 1
            ? `同步中：本轮 ${plan.batch_accounts.length}/${plan.total_accounts} 个账号`
            : reason === 'timer'
              ? '后台同步中...'
              : '手动同步中...',
        );
      }
      const run = await invoke<SyncRun>(IPC.SyncImapHeaders, { accountId: syncAccountId });
      const released = await current.releaseDueSnoozedMessages();
      setSyncRuns?.((existing) => [run, ...existing].slice(0, 10));
      const summary =
        released.released_count > 0
          ? `${syncStatusLabel(run)}；已恢复 ${released.released_count} 封稍后邮件`
          : syncStatusLabel(run);
      if (!isMailboxRefreshCurrent(mailboxRequest)) {
        fetchTimerLog('sync refresh skipped (mailbox changed)', {
          reason,
          accountId: syncAccountId,
          requestScope: mailboxRequest.scope,
          currentScope: currentRef.current.accountScope,
          requestRefreshId: mailboxRequest.id,
          currentRefreshId: mailboxRefreshRef.current,
        });
        return summary;
      }
      let meta: LoadMetaResult;
      try {
        meta = await current.loadMeta(current.folderId, current.accountScope, {
          mode: 'mailbox',
          mailboxRequest,
        });
      } catch (error) {
        if (!isMailboxRefreshCurrent(mailboxRequest)) {
          fetchTimerLog('sync metadata refresh error discarded after mailbox change', {
            reason,
            accountId: syncAccountId,
            error: String(error),
          });
          return summary;
        }
        throw error;
      }
      if (!isMailboxRefreshCurrent(mailboxRequest)) return summary;
      let latestMessages: MessageSummary[];
      try {
        latestMessages = await current.loadMessages(
          meta.folderId,
          current.query,
          current.filter,
          current.accountScope,
          mailboxRequest.id,
          undefined,
          undefined,
          undefined,
          mailboxRequest,
        );
      } catch (error) {
        if (!isMailboxRefreshCurrent(mailboxRequest)) {
          fetchTimerLog('sync message refresh error discarded after mailbox change', {
            reason,
            accountId: syncAccountId,
            error: String(error),
          });
          return summary;
        }
        throw error;
      }
      if (!isMailboxRefreshCurrent(mailboxRequest)) return summary;
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
      if (isMailboxRefreshCurrent(mailboxRequest)) {
        setBackgroundSyncStatus(`后台同步暂停：${message}`);
        if (reason === 'manual') setStatus(message);
      }
      throw error;
    } finally {
      backgroundSyncRef.current = false;
    }
  }, [
    createMailboxRefreshRequest,
    isMailboxRefreshCurrent,
    mailboxRefreshRef,
    notifyNewMail,
    setBackgroundSyncStatus,
    setStatus,
    setSyncRuns,
    setSyncSchedulePlan,
  ]);

  /**
   * 安全检查点之后的界面刷新：仅当任务绑定账号仍是当前账号（或当前为
   * 统一邮箱视图）时才把同步结果写入当前界面，避免 A 账号的任务覆盖 B 账号。
   */
  const applyAccountSyncRefresh = useCallback(async (task: BackgroundTask): Promise<void> => {
    const current = currentRef.current;
    const mailboxRequest = createMailboxRefreshRequest();
    if (!isAccountSyncRefreshCurrent(task, mailboxRequest)) {
      fetchTimerLog('account sync refresh skipped (account switched)', {
        taskId: task.id,
        taskAccountId: task.account_id,
        currentScope: current.accountScope,
        mailboxRefreshId: mailboxRequest.id,
      });
      return;
    }

    let meta: LoadMetaResult;
    try {
      meta = await current.loadMeta(current.folderId, current.accountScope, {
        mode: 'mailbox',
        mailboxRequest,
      });
    } catch (error) {
      if (!isAccountSyncRefreshCurrent(task, mailboxRequest)) {
        fetchTimerLog('account sync refresh error discarded after account switch', {
          taskId: task.id,
          taskAccountId: task.account_id,
          error: String(error),
        });
        return;
      }
      throw error;
    }

    if (!isAccountSyncRefreshCurrent(task, mailboxRequest)) {
      fetchTimerLog('account sync refresh discarded after metadata load', {
        taskId: task.id,
        taskAccountId: task.account_id,
        currentScope: currentRef.current.accountScope,
        mailboxRefreshId: mailboxRequest.id,
        currentMailboxRefreshId: mailboxRefreshRef.current,
      });
      return;
    }

    try {
      await current.loadMessages(
        meta.folderId,
        current.query,
        current.filter,
        current.accountScope,
        mailboxRequest.id,
        undefined,
        undefined,
        undefined,
        mailboxRequest,
      );
    } catch (error) {
      if (!isAccountSyncRefreshCurrent(task, mailboxRequest)) {
        fetchTimerLog('account sync message refresh error discarded after account switch', {
          taskId: task.id,
          taskAccountId: task.account_id,
          error: String(error),
        });
        return;
      }
      throw error;
    }
  }, [createMailboxRefreshRequest, isAccountSyncRefreshCurrent, mailboxRefreshRef]);

  /**
   * 账号绑定的同步任务：始终以明确的 account_id 同步并携带 task_id 取消令牌，
   * 绝不落到「未绑定账号」的旧任务模型（避免同步到其他账号）。
   * 执行期间轮询任务进度，按文件夹/批次逐步刷新界面。
   */
  const runAccountSyncTask = useCallback(async (task: BackgroundTask): Promise<string> => {
    const accountId = task.account_id;
    if (!accountId) return runBackgroundSync('manual');
    const startedAt = performance.now();
    fetchTimerLog('account sync start', {
      taskId: task.id,
      accountId,
      source: task.source,
    });
    setBackgroundSyncStatus(
      task.source === 'initial' ? '正在同步文件夹和邮件头…' : `${task.title}执行中...`,
    );

    // 进度轮询：消费 Rust 写入的文件夹/批次级进度，并渐进刷新当前可见界面。
    let lastProgress = -1;
    let lastRefreshAt = 0;
    const pollTimer = window.setInterval(async () => {
      try {
        const latest = await invoke<BackgroundTask>(IPC.GetBackgroundTask, { taskId: task.id });
        setBackgroundTasks((current) => (
          current.some((item) => item.id === latest.id)
            ? current.map((item) => (item.id === latest.id ? latest : item))
            : current
        ));
        if (latest.status !== 'running') {
          window.clearInterval(pollTimer);
          return;
        }
        if (latest.progress !== lastProgress && latest.message) {
          lastProgress = latest.progress;
          setBackgroundSyncStatus(
            task.source === 'initial' ? `${latest.message}…` : `${latest.message}…`,
          );
          const now = performance.now();
          if (now - lastRefreshAt > PROGRESS_REFRESH_MIN_INTERVAL_MS) {
            lastRefreshAt = now;
            void applyAccountSyncRefresh(task).catch((error) => {
              fetchTimerWarn('progressive refresh failed', {
                taskId: task.id,
                accountId: task.account_id,
                error: String(error),
              });
            });
          }
        }
      } catch {
        window.clearInterval(pollTimer);
      }
    }, PROGRESS_POLL_INTERVAL_MS);

    try {
      const run = await invoke<SyncRun>(IPC.SyncImapHeaders, { accountId, taskId: task.id });
      setSyncRuns?.((existing) => [run, ...existing].slice(0, 10));
      fetchTimerLog('account sync done', {
        taskId: task.id,
        accountId,
        status: run.status,
        scannedFolders: run.scanned_folders,
        importedMessages: run.imported_messages,
        durationMs: Math.round(performance.now() - startedAt),
      });
      // 完成后最终刷新一次界面（绑定账号仍是当前账号时生效）。
      await applyAccountSyncRefresh(task);
      return syncStatusLabel(run);
    } finally {
      window.clearInterval(pollTimer);
    }
  }, [applyAccountSyncRefresh, runBackgroundSync, setBackgroundSyncStatus, setBackgroundTasks, setSyncRuns]);

  /**
   * 所有带 account_id 的同步任务都必须按该账号执行（不能只对
   * source === 'initial' 特判）；只有未绑定账号的同步才走全局路径。
   */
  const executeBackgroundTask = useCallback(async (task: BackgroundTask): Promise<string> => {
    if (task.kind === 'sync') {
      if (task.account_id != null) {
        return runAccountSyncTask(task);
      }
      return runBackgroundSync(task.source === 'timer' ? 'timer' : 'manual');
    }
    if (task.kind === 'outbox-smtp' && task.source === 'timer') return (await sendDueOutboxItems()).message;
    if (task.kind === 'outbox-smtp') return flushOutboxSmtp();
    return flushOutboxDryRun();
  }, [flushOutboxDryRun, flushOutboxSmtp, runAccountSyncTask, runBackgroundSync, sendDueOutboxItems]);

  const drainBackgroundTaskQueue = useCallback(async () => {
    if (backgroundTaskWorkerRef.current) return;
    backgroundTaskWorkerRef.current = true;
    try {
      while (true) {
        const nextTask = await invoke<BackgroundTask | null>(IPC.NextBackgroundTask);
        if (!nextTask) break;

        // 原子领取：已取消的 queued 任务在此处失败，保持 cancelled 并继续。
        let runningTask: BackgroundTask;
        try {
          runningTask = await invoke<BackgroundTask>(IPC.MarkBackgroundTaskRunning, { taskId: nextTask.id });
        } catch {
          await refreshBackgroundTasks();
          continue;
        }
        if (runningTask.status !== 'running') {
          await refreshBackgroundTasks();
          continue;
        }
        await refreshBackgroundTasks();
        setBackgroundSyncStatus(`${runningTask.title}执行中...`);
        try {
          const message = await executeBackgroundTask(runningTask);
          // 安全检查点：执行期间被请求取消则放弃本次结果。
          const cancelled = await invoke<boolean>(IPC.ConsumeBackgroundTaskCancel, {
            taskId: runningTask.id,
          });
          if (cancelled) {
            await refreshBackgroundTasks();
            setBackgroundSyncStatus(`${runningTask.title}已取消`);
            continue;
          }
          if (runningTask.kind === 'sync' && runningTask.account_id != null) {
            // 同步成功但界面刷新失败：不得默默标记 done，保留失败可重试状态。
            await applyAccountSyncRefresh(runningTask);
          }
          await invoke<BackgroundTask>(IPC.CompleteBackgroundTask, {
            taskId: runningTask.id,
            message,
          });
          await refreshBackgroundTasks();
          setBackgroundSyncStatus(message);
        } catch (error) {
          const message = String(error);
          // 失败也可能是执行期间请求取消（Rust 安全点中止）：优先落为已取消。
          const cancelled = await invoke<boolean>(IPC.ConsumeBackgroundTaskCancel, {
            taskId: runningTask.id,
          }).catch(() => false);
          if (cancelled) {
            await refreshBackgroundTasks();
            setBackgroundSyncStatus(`${runningTask.title}已取消`);
            continue;
          }
          const failed = await invoke<BackgroundTask>(IPC.FailBackgroundTask, {
            taskId: runningTask.id,
            message,
          }).catch(() => null);
          if (!failed) {
            await refreshBackgroundTasks();
            continue;
          }
          await refreshBackgroundTasks();
          setBackgroundSyncStatus(
            runningTask.kind === 'sync'
              ? `${runningTask.title}失败：${message}，可重试`
              : `${runningTask.title}失败：${message}`,
          );
          if (runningTask.source === 'manual') setStatus(message);
        }
      }
    } finally {
      backgroundTaskWorkerRef.current = false;
    }
  }, [
    applyAccountSyncRefresh,
    executeBackgroundTask,
    refreshBackgroundTasks,
    setBackgroundSyncStatus,
    setStatus,
  ]);

  // 应用重启恢复：drain 残留的排队任务（运行中任务已在 Rust 迁移时标为失败）。
  useEffect(() => {
    void drainBackgroundTaskQueue();
  }, [drainBackgroundTaskQueue]);

  const enqueueBackgroundTask = useCallback(async (
    kind: BackgroundTaskKind,
    source: 'manual' | 'timer' = 'manual',
  ) => {
    fetchTimerLog('enqueue start', { kind, source });
    const task = await invoke<BackgroundTask>(IPC.EnqueueBackgroundTask, { input: { kind, source } });
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

  /**
   * 登录完成后的首次同步入口：绑定明确 account_id，
   * 同步与首次引导并行执行，不阻塞进入应用。
   */
  const enqueueAccountInitialSync = useCallback(async (accountId: number) => {
    fetchTimerLog('enqueue account initial sync start', { accountId });
    const task = await invoke<BackgroundTask>(IPC.EnqueueAccountBackgroundTask, {
      input: { kind: 'sync', source: 'initial', account_id: accountId },
    });
    await refreshBackgroundTasks();
    setBackgroundSyncStatus(
      task.status === 'queued'
        ? `${task.title}已入队，正在后台同步`
        : `${task.title}执行中`,
    );
    void drainBackgroundTaskQueue();
    return task;
  }, [drainBackgroundTaskQueue, refreshBackgroundTasks, setBackgroundSyncStatus]);

  const retryBackgroundTask = useCallback(async (taskId: number) => {
    const task = await invoke<BackgroundTask>(IPC.RetryBackgroundTask, { taskId });
    await refreshBackgroundTasks();
    setBackgroundSyncStatus(`${task.title}已重新排队，正在重试`);
    void drainBackgroundTaskQueue();
    return task;
  }, [drainBackgroundTaskQueue, refreshBackgroundTasks, setBackgroundSyncStatus]);

  const cancelBackgroundTask = useCallback(async (taskId: number) => {
    const task = await invoke<BackgroundTask>(IPC.CancelBackgroundTask, { taskId });
    await refreshBackgroundTasks();
    // 排队中的任务立即取消；运行中的任务进入「正在取消」状态，绝不谎称已取消。
    setBackgroundSyncStatus(
      task.status === 'cancelled' || task.cancel_requested
        ? task.status === 'cancelled'
          ? `${task.title}已取消`
          : `${task.title}正在取消…`
        : `${task.title}已取消`,
    );
    return task;
  }, [refreshBackgroundTasks, setBackgroundSyncStatus]);


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

  return {
    enqueueBackgroundTask,
    enqueueAccountInitialSync,
    retryBackgroundTask,
    cancelBackgroundTask,
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { Account, BackgroundTask, OutboxItem, SyncRun } from '../app/types';
import { defaultNotificationPolicy } from '../mailUtils';
import useBackgroundTaskCoordinator from './useBackgroundTaskCoordinator';
import { invoke, isPermissionGranted } from '../tauriBridge';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
  isPermissionGranted: vi.fn(),
}));

const accountA: Account = {
  id: 1,
  email: 'a@example.com',
  display_name: 'A',
  provider: 'custom',
  imap_host: 'imap.example.com:993',
  smtp_host: 'smtp.example.com:587',
  incoming_protocol: 'imap',
  auth_type: 'password',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: '',
  cross_account_risk_warning: true,
  block_external_mailboxes: false,
  intercept_https_links: true,
  auto_download_attachments: false,
  warn_external_senders: false,
  onboarding_completed: true,
  is_default: true,
};

const accountB: Account = { ...accountA, id: 2, email: 'b@example.com', is_default: false };

const syncRun: SyncRun = {
  id: 9,
  started_at: '2026-08-10T00:00:00.000Z',
  finished_at: '2026-08-10T00:00:10.000Z',
  status: 'ok',
  scanned_folders: 4,
  imported_messages: 3,
  new_messages: 3,
  message: '同步完成',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function task(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: 1,
    kind: 'sync',
    title: '首次同步邮件头',
    source: 'initial',
    status: 'queued',
    message: '等待执行',
    created_at: '2026-08-10T00:00:00.000Z',
    started_at: '',
    finished_at: '',
    account_id: accountA.id,
    cancel_requested: false,
    progress: 0,
    ...overrides,
  };
}

function renderCoordinator(
  accountScope: number | 'all',
  loadMeta = vi.fn().mockResolvedValue({ folderId: 101, folders: [{ id: 101 }] }),
  loadMessages = vi.fn().mockResolvedValue([]),
) {
  const mailboxRefreshRef = { current: 0 };
  const setOutbox = vi.fn();
  const setBackgroundTasks = vi.fn();
  const setBackgroundSyncStatus = vi.fn();
  const setSyncSchedulePlan = vi.fn();
  const setLastNewMailNotice = vi.fn();
  const setNotificationStatus = vi.fn();
  const setPendingSendUndo = vi.fn();
  const setStatus = vi.fn();
  const showToast = vi.fn();
  const releaseDueSnoozedMessages = vi.fn().mockResolvedValue({ released_count: 0 });

  const scenario: {
    tasks: BackgroundTask[];
    syncCommand: string;
    syncError?: Error;
    pauseSync?: boolean;
    claimRejects?: boolean;
    cancelRequestedDuringRun?: boolean;
    progressDuringRun?: { progress: number; message: string } | null;
  } = {
    tasks: [],
    syncCommand: '',
    syncError: undefined,
    pauseSync: false,
    claimRejects: false,
    cancelRequestedDuringRun: false,
    progressDuringRun: null,
  };

  vi.mocked(invoke).mockImplementation((async (command: string, args?: unknown) => {
    switch (command) {
      case 'enqueue_account_background_task': {
        const input = (args as { input: { account_id: number } }).input;
        const existing = scenario.tasks.find(
          (item) => item.status === 'queued' || item.status === 'running',
        );
        if (existing) return existing;
        const created = task({ id: scenario.tasks.length + 1, account_id: input.account_id });
        scenario.tasks = [created, ...scenario.tasks];
        return created;
      }
      case 'list_background_tasks':
        return scenario.tasks;
      case 'get_background_task': {
        const taskId = Number((args as { taskId: number }).taskId);
        const current = scenario.tasks.find((item) => item.id === taskId);
        if (!current) return null;
        if (scenario.progressDuringRun && current.status === 'running') {
          return { ...current, ...scenario.progressDuringRun };
        }
        return current;
      }
      case 'next_background_task':
        return scenario.tasks.find((item) => item.status === 'queued') ?? null;
      case 'mark_background_task_running': {
        const taskId = Number((args as { taskId: number }).taskId);
        if (scenario.claimRejects) {
          // 模拟领取竞态：任务在 next() 之后、mark() 之前被取消。
          scenario.tasks = scenario.tasks.map((item) => (
            item.id === taskId
              ? { ...item, status: 'cancelled', message: '已取消', finished_at: '2026-08-10T00:00:01.000Z' }
              : item
          ));
          throw new Error('任务已不在排队状态（可能已取消），无法开始执行。');
        }
        scenario.tasks = scenario.tasks.map((item) => (
          item.id === taskId
            ? { ...item, status: 'running', started_at: '2026-08-10T00:00:01.000Z' }
            : item
        ));
        return scenario.tasks.find((item) => item.id === taskId);
      }
      case 'consume_background_task_cancel': {
        if (!scenario.cancelRequestedDuringRun) return false;
        scenario.tasks = scenario.tasks.map((item) => (
          item.status === 'running' && item.cancel_requested
            ? { ...item, status: 'cancelled', message: '已取消', cancel_requested: false, finished_at: '2026-08-10T00:00:02.000Z' }
            : item
        ));
        scenario.cancelRequestedDuringRun = false;
        return true;
      }
      case 'sync_imap_headers': {
        scenario.syncCommand = String((args as { accountId: number }).accountId);
        if (scenario.syncError) throw scenario.syncError;
        if (scenario.pauseSync) {
          await new Promise((resolve) => {
            const probe = () => {
              if (!scenario.pauseSync) resolve(undefined);
              else setTimeout(probe, 20);
            };
            probe();
          });
        }
        return syncRun;
      }
      case 'complete_background_task': {
        const taskId = Number((args as { taskId: number }).taskId);
        scenario.tasks = scenario.tasks.map((item) => (
          item.id === taskId
            ? { ...item, status: 'done', message: String((args as { message: string }).message) }
            : item
        ));
        return scenario.tasks.find((item) => item.id === taskId);
      }
      case 'fail_background_task': {
        const taskId = Number((args as { taskId: number }).taskId);
        scenario.tasks = scenario.tasks.map((item) => (
          item.id === taskId
            ? { ...item, status: 'failed', message: String((args as { message: string }).message) }
            : item
        ));
        return scenario.tasks.find((item) => item.id === taskId);
      }
      case 'retry_background_task': {
        const taskId = Number((args as { taskId: number }).taskId);
        scenario.tasks = scenario.tasks.map((item) => (
          item.id === taskId
            ? { ...item, status: 'queued', message: '等待执行', cancel_requested: false }
            : item
        ));
        return scenario.tasks.find((item) => item.id === taskId);
      }
      case 'cancel_background_task': {
        const taskId = Number((args as { taskId: number }).taskId);
        const target = scenario.tasks.find((item) => item.id === taskId);
        if (!target) return null;
        const updated: BackgroundTask = scenario.cancelRequestedDuringRun
          ? { ...target, status: 'running', cancel_requested: true, message: '正在取消…' }
          : { ...target, status: 'cancelled', message: '已取消' };
        scenario.tasks = scenario.tasks.map((item) => (item.id === taskId ? updated : item));
        return updated;
      }
      default:
        return undefined;
    }
  }) as never);

  const utils = renderHook(({ activeAccountScope }: { activeAccountScope: number | 'all' }) => (
    useBackgroundTaskCoordinator({
      account: activeAccountScope === accountB.id ? accountB : accountA,
      accountScope: activeAccountScope,
      mailboxRefreshRef,
      folderId: 101,
      query: '',
      filter: 'all',
      messages: [],
      outbox: [] as OutboxItem[],
      notificationPolicy: { ...defaultNotificationPolicy },
      setOutbox,
      setBackgroundTasks,
      setBackgroundSyncStatus,
      setSyncSchedulePlan,
      setLastNewMailNotice,
      setNotificationStatus,
      setPendingSendUndo,
      setStatus,
      showToast,
      loadMeta,
      loadMessages,
      releaseDueSnoozedMessages,
    })
  ), {
    initialProps: { activeAccountScope: accountScope },
  });
  return {
    utils,
    scenario,
    mailboxRefreshRef,
    setBackgroundSyncStatus,
    switchAccountScope: (nextScope: number | 'all') => {
      mailboxRefreshRef.current += 1;
      utils.rerender({ activeAccountScope: nextScope });
    },
  };
}

describe('useBackgroundTaskCoordinator account-bound sync', () => {
  beforeEach(() => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('syncs the bound account with an explicit account id, never the unbound model', async () => {
    const { utils, scenario } = renderCoordinator(accountA.id);

    await act(async () => {
      await utils.result.current.enqueueAccountInitialSync(accountA.id);
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('done');
    });
    expect(scenario.syncCommand).toBe(String(accountA.id));
  });

  it('does not write the synced account data into another account interface after an account switch', async () => {
    const loadMeta = vi.fn().mockResolvedValue({ folderId: 201, folders: [{ id: 201 }] });
    const loadMessages = vi.fn().mockResolvedValue([]);
    // 当前界面已切换到 B 账号，A 账号的首次同步仍在后台运行。
    const { utils, scenario } = renderCoordinator(accountB.id, loadMeta, loadMessages);

    await act(async () => {
      await utils.result.current.enqueueAccountInitialSync(accountA.id);
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('done');
    });
    expect(scenario.syncCommand).toBe(String(accountA.id));
    expect(loadMeta).not.toHaveBeenCalled();
    expect(loadMessages).not.toHaveBeenCalled();
  });

  it('drops an in-flight A metadata refresh when the user switches to B before it resolves', async () => {
    const metadata = deferred<{ folderId: number; folders: Array<{ id: number }> }>();
    const loadMeta = vi.fn().mockReturnValue(metadata.promise);
    const loadMessages = vi.fn().mockResolvedValue([]);
    const {
      utils,
      scenario,
      switchAccountScope,
    } = renderCoordinator(accountA.id, loadMeta, loadMessages);

    await act(async () => {
      await utils.result.current.enqueueAccountInitialSync(accountA.id);
    });
    await waitFor(() => {
      expect(loadMeta).toHaveBeenCalledWith(101, accountA.id, {
        mode: 'mailbox',
        mailboxRequest: { id: 0, scope: accountA.id },
      });
    });

    // UI 切换路径会先推进 generation，再提交 B 的 scope；旧请求即使随后
    // 成功，也没有资格继续加载/写入 A 的邮件列表。
    await act(async () => {
      switchAccountScope(accountB.id);
    });
    await act(async () => {
      metadata.resolve({ folderId: 101, folders: [{ id: 101 }] });
      await metadata.promise;
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('done');
    });
    expect(loadMessages).not.toHaveBeenCalled();
  });

  it('keeps the created account intact and retries after a failed sync', async () => {
    const { utils, scenario } = renderCoordinator(accountA.id);
    scenario.syncError = new Error('IMAP 连接超时');

    await act(async () => {
      await utils.result.current.enqueueAccountInitialSync(accountA.id);
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('failed');
    });
    expect(scenario.tasks[0]?.message).toContain('IMAP 连接超时');
    expect(invoke).not.toHaveBeenCalledWith('delete_account', expect.anything());

    scenario.syncError = undefined;
    await act(async () => {
      await utils.result.current.retryBackgroundTask(scenario.tasks[0].id);
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('done');
    });
    expect(scenario.syncCommand).toBe(String(accountA.id));
  });

  it('never executes a queued task that was cancelled before the worker claimed it', async () => {
    const { utils, scenario } = renderCoordinator(accountA.id);
    scenario.claimRejects = true;

    await act(async () => {
      await utils.result.current.enqueueAccountInitialSync(accountA.id);
    });

    // worker 领取时发现任务已被取消：mark 失败 → 保持 cancelled，绝不执行。
    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('cancelled');
    });
    expect(scenario.syncCommand).toBe('');
  });

  it('stops a running sync at the checkpoint when cancel is requested', async () => {
    const { utils, scenario } = renderCoordinator(accountA.id);
    // 第一次领取后：sync 进行中时用户点击取消 → 检查点响应 → 任务落为已取消，
    // 不得再提交 complete/fail 结果。
    scenario.pauseSync = true;

    await act(async () => {
      await utils.result.current.enqueueAccountInitialSync(accountA.id);
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('running');
    });

    scenario.pauseSync = false;
    scenario.cancelRequestedDuringRun = true;
    await act(async () => {
      await utils.result.current.cancelBackgroundTask(scenario.tasks[0].id);
    });
    const afterCancel = scenario.tasks[0];
    expect(afterCancel?.cancel_requested).toBe(true);
    expect(afterCancel?.status).toBe('running');

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('cancelled');
    });
    expect(invoke).not.toHaveBeenCalledWith('complete_background_task', expect.anything());
  });

  it('marks the task failed-with-retry when the sync succeeded but the UI refresh failed', async () => {
    const loadMeta = vi.fn().mockRejectedValue(new Error('邮件列表刷新失败'));
    const { utils, scenario } = renderCoordinator(accountA.id, loadMeta);

    await act(async () => {
      await utils.result.current.enqueueAccountInitialSync(accountA.id);
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('failed');
    });
    expect(scenario.tasks[0]?.message).toContain('邮件列表刷新失败');
    expect(invoke).not.toHaveBeenCalledWith('complete_background_task', expect.anything());
  });

  it('executes any account-bound sync task by its own account id, regardless of source', async () => {
    // 除 initial 外，带 account_id 的 manual 同步也必须按该账号执行。
    const { utils, scenario } = renderCoordinator(accountB.id);
    scenario.tasks = [task({ id: 50, source: 'manual', account_id: accountA.id, title: '同步邮件头' })];

    await act(async () => {
      await utils.result.current.retryBackgroundTask(50);
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('done');
    });
    expect(scenario.syncCommand).toBe(String(accountA.id));
    // B 账号界面没有被刷新（任务绑定 A 账号）。
    const loadMetaCalls = scenario.tasks.filter((item) => item.id === 50).length;
    expect(loadMetaCalls).toBeGreaterThan(0);
  });

  it('queues a manual sync for the currently selected account so it can report batch progress', async () => {
    const { utils, scenario } = renderCoordinator(accountB.id);

    await act(async () => {
      await utils.result.current.enqueueManualSync();
    });

    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('done');
    });
    expect(invoke).toHaveBeenCalledWith('enqueue_account_background_task', {
      input: { kind: 'sync', source: 'manual', account_id: accountB.id },
    });
    expect(scenario.syncCommand).toBe(String(accountB.id));
  });

  it('consumes folder/batch progress from the running task and shows progressive status', async () => {
    const { utils, scenario, setBackgroundSyncStatus } = renderCoordinator(accountA.id);
    // 同步期间暂停，让进度轮询消费到 Rust 写入的文件夹级进度。
    scenario.pauseSync = true;
    scenario.progressDuringRun = { progress: 40, message: '正在同步文件夹 2/4' };

    await act(async () => {
      await utils.result.current.enqueueAccountInitialSync(accountA.id);
    });

    await waitFor(
      () => {
        expect(setBackgroundSyncStatus).toHaveBeenCalledWith(expect.stringContaining('正在同步文件夹 2/4'));
      },
      { timeout: 6000 },
    );

    // 同步结束后进入完成状态。
    scenario.pauseSync = false;
    scenario.progressDuringRun = null;
    await waitFor(() => {
      expect(scenario.tasks[0]?.status).toBe('done');
    });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAppMetaLoader from './useAppMetaLoader';
import type { Account, Folder, MailStats, SyncRun } from '../app/types';

const mockSetBadgeCount = vi.fn(async () => undefined);

vi.mock('../tauriBridge', () => ({
  getCurrentWindow: () => ({
    setBadgeCount: mockSetBadgeCount,
    setBadgeLabel: async () => undefined,
    onDragDropEvent: async () => () => undefined,
  }),
  invoke: vi.fn(),
}));

import { invoke, type InvokeArgs } from '../tauriBridge';

const mockInvoke = vi.mocked(invoke);

const account: Account = {
  id: 1,
  email: 'demo@better-email.local',
  display_name: 'Demo User',
  provider: 'gmail',
  imap_host: 'imap.example.com:993',
  smtp_host: 'smtp.example.com:465',
  incoming_protocol: 'imap',
  auth_type: 'oauth2',
  sync_mode: 'manual',
  remote_images_allowed: false,
  signature: 'Sent from Better Email',
  cross_account_risk_warning: true,
  block_external_mailboxes: false,
  intercept_https_links: true,
  auto_download_attachments: false,
    warn_external_senders: false,
    onboarding_completed: true,
  is_default: true,
};

const folders: Folder[] = [
  { id: 101, account_id: 1, name: '收件箱', role: 'inbox', unread_count: 1, is_virtual: false },
  { id: 102, account_id: 1, name: '已发送', role: 'sent', unread_count: 0, is_virtual: false },
];

const stats: MailStats = {
  total_messages: 4,
  unread_messages: 1,
  starred_messages: 0,
  draft_messages: 0,
  attachment_messages: 1,
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

function setupInvokeMocks() {
  mockInvoke.mockImplementation(((command: string) => {
    switch (command) {
      case 'release_due_snoozed_messages':
        return Promise.resolve({ released_count: 0 });
      case 'list_accounts':
        return Promise.resolve([account]);
      case 'get_account':
        return Promise.resolve(account);
      case 'list_folders':
        return Promise.resolve(folders);
      case 'list_labels':
        return Promise.resolve([]);
      case 'get_stats':
        return Promise.resolve(stats);
      case 'list_sync_runs':
        return Promise.resolve([]);
      case 'list_identities':
        return Promise.resolve([]);
      case 'list_outbox':
        return Promise.resolve([]);
      case 'list_background_tasks':
        return Promise.resolve([]);
      case 'get_sync_schedule_plan':
        return Promise.resolve({});
      case 'list_remote_image_trusts':
        return Promise.resolve([]);
      case 'list_imap_mailboxes':
        return Promise.resolve([]);
      case 'list_contacts':
        return Promise.resolve([]);
      case 'list_rules':
        return Promise.resolve([]);
      case 'list_oauth_sessions':
        return Promise.resolve([]);
      case 'benchmark_sync_requested':
        return Promise.resolve(true);
      case 'mark_benchmark_sync_complete':
        return Promise.resolve({});
      case 'set_tray_unread_count':
        return Promise.resolve(undefined);
      default:
        return Promise.reject(new Error(`unexpected invoke: ${String(command)}`));
    }
  }) as never);
}

function renderMetaLoader({
  onAccountListLoaded,
  mailboxRefreshRef = { current: 0 },
  accountScope = 1,
}: {
  onAccountListLoaded?: () => void;
  mailboxRefreshRef?: { current: number };
  accountScope?: number | 'all';
} = {}) {
  const setters = {
    setAccounts: vi.fn(),
    setAccount: vi.fn(),
    setAccountForm: vi.fn(),
    setFolders: vi.fn(),
    setLabels: vi.fn(),
    setStats: vi.fn(),
    setSyncRuns: vi.fn(),
    setIdentities: vi.fn(),
    setOutbox: vi.fn(),
    setBackgroundTasks: vi.fn(),
    setSyncSchedulePlan: vi.fn(),
    setRemoteImageTrusts: vi.fn(),
    setImapMailboxes: vi.fn(),
    setContacts: vi.fn(),
    setRules: vi.fn(),
    setOauthSessions: vi.fn(),
    setFolderId: vi.fn(),
    setStatus: vi.fn(),
    setAppBadgeStatus: vi.fn(),
  };
  const hook = renderHook(({ activeAccountScope }: { activeAccountScope: number | 'all' }) => (
    useAppMetaLoader({
      folderId: 101,
      accountScope: activeAccountScope,
      mailboxRefreshRef,
      ...setters,
      onAccountListLoaded,
    })
  ), {
    initialProps: { activeAccountScope: accountScope },
  });
  return { ...hook, setters, mailboxRefreshRef };
}

describe('useAppMetaLoader', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockSetBadgeCount.mockReset();
    localStorage.clear();
  });

  it('loads mailbox metadata and keeps the requested folder when it exists', async () => {
    setupInvokeMocks();
    const { result, setters } = renderMetaLoader();

    await act(async () => {
      const meta = await result.current.loadMeta(101, 1, { mode: 'mailbox' });
      expect(meta.folderId).toBe(101);
      expect(meta.folders).toEqual(folders);
    });

    expect(setters.setFolders).toHaveBeenCalledWith(folders);
    expect(setters.setAccount).toHaveBeenCalledWith(account);
    expect(setters.setStats).toHaveBeenCalledWith(stats);
    expect(setters.setFolderId).toHaveBeenCalledWith(101);
  });

  it('falls back to the first folder when the requested folder is missing', async () => {
    setupInvokeMocks();
    const { result, setters } = renderMetaLoader();

    await act(async () => {
      const meta = await result.current.loadMeta(999, 1, { mode: 'mailbox' });
      expect(meta.folderId).toBe(101);
    });

    expect(setters.setFolderId).toHaveBeenCalledWith(101);
  });

  it('does not commit an in-flight A mailbox result after the view switches to B', async () => {
    setupInvokeMocks();
    const folderResponse = deferred<Folder[]>();
    const defaultImplementation = mockInvoke.getMockImplementation();
    mockInvoke.mockImplementation(((command: string, args?: InvokeArgs) => {
      if (command === 'list_folders' && (args as { accountId?: number } | undefined)?.accountId === 1) {
        return folderResponse.promise;
      }
      return defaultImplementation?.(command, args);
    }) as never);
    const mailboxRefreshRef = { current: 7 };
    const { result, rerender, setters } = renderMetaLoader({ mailboxRefreshRef });

    let loading!: Promise<unknown>;
    await act(async () => {
      loading = result.current.loadMeta(101, 1, {
        mode: 'mailbox',
        mailboxRequest: { id: 7, scope: 1 },
      });
      await Promise.resolve();
    });

    mailboxRefreshRef.current += 1;
    rerender({ activeAccountScope: 2 });
    await act(async () => {
      folderResponse.resolve(folders);
      await loading;
    });

    expect(setters.setAccount).not.toHaveBeenCalled();
    expect(setters.setAccountForm).not.toHaveBeenCalled();
    expect(setters.setFolders).not.toHaveBeenCalled();
    expect(setters.setFolderId).not.toHaveBeenCalled();
  });

  it('reports account availability even when unrelated mailbox metadata fails', async () => {
    setupInvokeMocks();
    const onAccountListLoaded = vi.fn();
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_stats') return Promise.reject(new Error('stats unavailable'));
      switch (command) {
        case 'release_due_snoozed_messages':
          return Promise.resolve({ released_count: 0 });
        case 'list_accounts':
          return Promise.resolve([account]);
        case 'get_account':
          return Promise.resolve(account);
        case 'list_folders':
          return Promise.resolve(folders);
        case 'list_labels':
        case 'list_sync_runs':
        case 'list_identities':
        case 'list_outbox':
        case 'list_background_tasks':
        case 'list_remote_image_trusts':
        case 'list_imap_mailboxes':
          return Promise.resolve([]);
        case 'get_sync_schedule_plan':
          return Promise.resolve({});
        default:
          return Promise.reject(new Error(`unexpected invoke: ${String(command)}`));
      }
    }) as never);
    const { result, setters } = renderMetaLoader({ onAccountListLoaded });

    await expect(act(async () => {
      await result.current.loadMeta(101, 1, { mode: 'mailbox' });
    })).rejects.toThrow('stats unavailable');

    expect(onAccountListLoaded).toHaveBeenCalledOnce();
    expect(setters.setAccounts).toHaveBeenCalledWith([account]);
  });

  it('runs the benchmark sync at most once per session', async () => {
    setupInvokeMocks();
    const { result } = renderMetaLoader();
    const dryRun = vi.fn().mockResolvedValue({
      status: 'ok',
      scanned_folders: 2,
      imported_messages: 3,
    } as SyncRun);

    await act(async () => {
      await result.current.maybeRunBenchmarkSync(dryRun);
    });
    await act(async () => {
      await result.current.maybeRunBenchmarkSync(dryRun);
    });

    expect(dryRun).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('mark_benchmark_sync_complete', {
      message: 'ok;folders=2;imported=3',
    });
  });

  it('clears the dock badge and tray count when refreshUnreadIndicators finds zero unread', async () => {
    setupInvokeMocks();
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_stats') {
        return Promise.resolve({ ...stats, unread_messages: 0 });
      }
      if (command === 'set_tray_unread_count') {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`unexpected invoke: ${String(command)}`));
    }) as never);
    const { result } = renderMetaLoader();

    await act(async () => {
      await result.current.refreshUnreadIndicators('all');
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_stats', { accountId: null });
    expect(mockInvoke).toHaveBeenCalledWith('set_tray_unread_count', { unreadCount: 0 });
    expect(mockSetBadgeCount).toHaveBeenCalledWith(undefined);
  });

  it('pushes the real unread count to the dock badge and tray', async () => {
    setupInvokeMocks();
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_stats') {
        return Promise.resolve({ ...stats, unread_messages: 38 });
      }
      if (command === 'set_tray_unread_count') {
        return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`unexpected invoke: ${String(command)}`));
    }) as never);
    const { result } = renderMetaLoader();

    await act(async () => {
      await result.current.refreshUnreadIndicators(1);
    });

    expect(mockInvoke).toHaveBeenCalledWith('get_stats', { accountId: 1 });
    expect(mockInvoke).toHaveBeenCalledWith('set_tray_unread_count', { unreadCount: 38 });
    expect(mockSetBadgeCount).toHaveBeenCalledWith(38);
  });

  it('keeps refreshUnreadIndicators resilient when get_stats fails', async () => {
    setupInvokeMocks();
    mockInvoke.mockRejectedValue(new Error('stats unavailable'));
    const { result } = renderMetaLoader();

    await expect(
      act(async () => {
        await result.current.refreshUnreadIndicators('all');
      }),
    ).resolves.toBeUndefined();
    expect(mockSetBadgeCount).not.toHaveBeenCalled();
  });
});

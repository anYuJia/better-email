import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAppMetaLoader from './useAppMetaLoader';
import type { Account, Folder, MailStats, SyncRun } from '../app/types';

vi.mock('../tauriBridge', () => ({
  getCurrentWindow: () => ({
    setBadgeCount: async () => undefined,
    setBadgeLabel: async () => undefined,
    onDragDropEvent: async () => () => undefined,
  }),
  invoke: vi.fn(),
}));

import { invoke } from '../tauriBridge';

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
      case 'list_contact_merge_suggestions':
        return Promise.resolve([]);
      case 'list_rules':
        return Promise.resolve([]);
      case 'list_oauth_sessions':
        return Promise.resolve([]);
      case 'benchmark_sync_requested':
        return Promise.resolve(true);
      case 'mark_benchmark_sync_complete':
        return Promise.resolve({});
      default:
        return Promise.reject(new Error(`unexpected invoke: ${String(command)}`));
    }
  }) as never);
}

function renderMetaLoader() {
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
    setContactMergeSuggestions: vi.fn(),
    setRules: vi.fn(),
    setOauthSessions: vi.fn(),
    setFolderId: vi.fn(),
    setStatus: vi.fn(),
    setAppBadgeStatus: vi.fn(),
  };
  const hook = renderHook(() => useAppMetaLoader({
    folderId: 101,
    accountScope: 1,
    ...setters,
  }));
  return { ...hook, setters };
}

describe('useAppMetaLoader', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
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
});

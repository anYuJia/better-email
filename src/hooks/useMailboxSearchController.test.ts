import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { FormEvent } from 'react';
import useMailboxSearchController, { type MailboxSearchLoaders } from './useMailboxSearchController';
import {
  listSortStorageKey,
  loadListSort,
  messagePageSize,
  savedSearchesStorageKey,
} from '../app/appConfig';
import type {
  Account,
  Folder,
  ImapMailboxState,
  MessageSummary,
  SavedSearch,
} from '../app/types';

vi.mock('../tauriBridge', () => ({
  getCurrentWindow: () => ({
    setBadgeCount: async () => undefined,
    setBadgeLabel: async () => undefined,
    onDragDropEvent: async () => () => undefined,
  }),
  invoke: vi.fn(),
}));

const account: Account = {
  id: 7,
  email: 'demo@better-email.local',
  display_name: 'Demo',
  provider: 'custom',
  imap_host: 'imap.example.com',
  smtp_host: 'smtp.example.com',
  incoming_protocol: 'imap',
  auth_type: 'plain',
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

const folders: Folder[] = [
  { id: 101, account_id: 7, name: '收件箱', role: 'inbox', unread_count: 2, is_virtual: false },
];

const incompleteMailbox: ImapMailboxState = {
  id: 1,
  account_id: 7,
  account_email: 'demo@better-email.local',
  remote_name: 'INBOX',
  delimiter: '/',
  attributes: '\\HasNoChildren',
  local_role: 'inbox',
  local_folder_id: 101,
  local_folder_name: '收件箱',
  uid_validity: '1',
  highest_uid: 100,
  lowest_uid: 1,
  history_complete: false,
  history_last_sync_at: '',
  last_seen_at: '',
  last_sync_at: '',
};

function createLoaders() {
  const loadMessagesWithVisibleFallback = vi.fn(async (): Promise<MessageSummary[]> => []);
  const loadMessages = vi.fn(async (): Promise<MessageSummary[]> => []);
  const loadMeta = vi.fn(async () => ({ folderId: 101, folders }));
  const syncImapHistoryPage = vi.fn(async () => ({
    id: 1,
    started_at: '',
    finished_at: '',
    status: 'ok',
    scanned_folders: 1,
    imported_messages: 2,
    new_messages: 2,
    new_message_ids: [],
    message: '同步完成',
  }));
  const loadersRef: { current: MailboxSearchLoaders | null } = {
    current: { loadMessagesWithVisibleFallback, loadMessages, loadMeta, syncImapHistoryPage },
  };
  return { loadMessagesWithVisibleFallback, loadMessages, loadMeta, syncImapHistoryPage, loadersRef };
}

function renderController({
  accountScope = 'all',
  folderId = 101,
  imapMailboxes = [],
  messages = [],
  mailboxRefreshRefValue = 1,
}: {
  accountScope?: Account['id'] | 'all';
  folderId?: number | null;
  imapMailboxes?: ImapMailboxState[];
  messages?: MessageSummary[];
  mailboxRefreshRefValue?: number;
} = {}) {
  const loaders = createLoaders();
  const setStatus = vi.fn();
  const setActiveThread = vi.fn();
  const setThreadMessages = vi.fn();
  // 稳定引用：搜索控制器会自增 mailboxRefreshRef，若在 render 回调内联创建，
  // 每次重渲染都会重置为初值，掩盖刷新 token 语义。
  const mailboxRefreshRef: { current: number } = { current: mailboxRefreshRefValue };
  const utils = renderHook(() => useMailboxSearchController({
    account,
    accountScope,
    folderId,
    folders,
    imapMailboxes,
    messages,
    mailboxRefreshRef,
    loadersRef: loaders.loadersRef,
    setActiveThread,
    setThreadMessages,
    setStatus,
  }));
  return { ...utils, ...loaders, setStatus, setActiveThread, setThreadMessages };
}

describe('useMailboxSearchController', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('starts with a clean mailbox search state', () => {
    const { result } = renderController();
    expect(result.current.queryDraft).toBe('');
    expect(result.current.appliedQuery).toBe('');
    expect(result.current.searchScope).toBe('folder');
    expect(result.current.filter).toBe('all');
    expect(result.current.listMode).toBe('messages');
    expect(result.current.listSort).toBe(loadListSort());
    expect(result.current.savedSearches).toEqual([]);
    expect(result.current.messageLimit).toBe(messagePageSize);
    expect(result.current.hasMoreMessages).toBe(false);
    expect(result.current.loadMoreStatus).toBeNull();
  });

  it('restores list sort and saved searches from storage', () => {
    window.localStorage.setItem(listSortStorageKey, 'sender');
    window.localStorage.setItem(savedSearchesStorageKey, JSON.stringify([
      { id: 's1', name: '发票', query: 'invoice', filter: 'all', scope: 'all' },
    ]));
    const { result } = renderController();
    expect(result.current.listSort).toBe('sender');
    expect(result.current.savedSearches).toEqual([
      { id: 's1', name: '发票', query: 'invoice', filter: 'all', scope: 'all' },
    ]);
  });

  it('persists list sort and saved searches changes', () => {
    const { result } = renderController();
    act(() => result.current.setListSort('oldest'));
    expect(window.localStorage.getItem(listSortStorageKey)).toBe('oldest');
    act(() => result.current.setSavedSearches([{
      id: 's1', name: '发票', query: 'invoice', filter: 'all', scope: 'all',
    } as SavedSearch]));
    expect(JSON.parse(window.localStorage.getItem(savedSearchesStorageKey) ?? '[]')).toEqual([
      { id: 's1', name: '发票', query: 'invoice', filter: 'all', scope: 'all' },
    ]);
  });

  it('runSearch applies the draft once and submits it in the current scope', async () => {
    const { result, loadMessagesWithVisibleFallback, setStatus } = renderController();
    const event = { preventDefault: vi.fn() } as unknown as FormEvent;
    act(() => result.current.handleQueryChange('invoice'));
    expect(result.current.queryDraft).toBe('invoice');
    expect(result.current.appliedQuery).toBe('');
    expect(loadMessagesWithVisibleFallback).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.runSearch(event);
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.appliedQuery).toBe('invoice');
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledTimes(1);
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledWith(
      101, 'invoice', 'all', 'all', 2, folders, messagePageSize, 'folder', false,
    );
    expect(setStatus).toHaveBeenCalledWith('已搜索：invoice');
  });

  it('changeSearchScope reloads with the new scope and resets the list view', async () => {
    const { result, loadMessagesWithVisibleFallback, setStatus, setActiveThread, setThreadMessages } = renderController();
    await act(async () => {
      await result.current.changeSearchScope('account');
    });
    expect(result.current.searchScope).toBe('account');
    expect(result.current.listMode).toBe('messages');
    expect(setActiveThread).toHaveBeenCalledWith(null);
    expect(setThreadMessages).toHaveBeenCalledWith([]);
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledWith(
      101, '', 'all', 'all', 2, folders, messagePageSize, 'account', false,
    );
    expect(setStatus).toHaveBeenCalledWith('搜索范围已切换为：当前账号');
  });

  it('applySearchShortcut appends a colon shortcut and focuses the input', async () => {
    const { result, loadMessagesWithVisibleFallback, setStatus } = renderController();
    act(() => result.current.setQuery('安全'));
    const fakeInput = { focus: vi.fn(), setSelectionRange: vi.fn() } as unknown as HTMLInputElement;
    act(() => {
      result.current.searchInputRef.current = fakeInput;
    });
    await act(async () => {
      await result.current.applySearchShortcut('from:');
    });
    expect(result.current.queryDraft).toBe('安全 from:');
    expect(result.current.appliedQuery).toBe('安全 from:');
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledWith(
      101, '安全 from:', 'all', 'all', 2, folders, messagePageSize, 'folder', false,
    );
    expect(fakeInput.focus).toHaveBeenCalled();
    expect(fakeInput.setSelectionRange).toHaveBeenCalledWith('安全 from:'.length, '安全 from:'.length);
    expect(setStatus).toHaveBeenCalledWith('已插入搜索条件：from:');
  });

  it('applySearchShortcut replaces the query for a plain shortcut', async () => {
    const { result, loadMessagesWithVisibleFallback, setStatus } = renderController();
    await act(async () => {
      await result.current.applySearchShortcut('invoice');
    });
    expect(result.current.queryDraft).toBe('invoice');
    expect(result.current.appliedQuery).toBe('invoice');
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledWith(
      101, 'invoice', 'all', 'all', 2, folders, messagePageSize, 'folder', false,
    );
    expect(setStatus).toHaveBeenCalledWith('已搜索：invoice');
  });

  it('clearSearchAndFilter resets query filter and scope before reloading', async () => {
    const { result, loadMessagesWithVisibleFallback, setStatus } = renderController();
    const searchInput = { focus: vi.fn() } as unknown as HTMLInputElement;
    act(() => {
      result.current.setQuery('invoice');
      result.current.setFilter('unread');
      result.current.setSearchScope('all');
      result.current.setListMode('threads');
      result.current.searchInputRef.current = searchInput;
    });
    await act(async () => {
      await result.current.clearSearchAndFilter();
    });
    expect(result.current.queryDraft).toBe('');
    expect(result.current.appliedQuery).toBe('');
    expect(result.current.filter).toBe('all');
    expect(result.current.searchScope).toBe('folder');
    expect(result.current.listMode).toBe('threads');
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledWith(
      101, '', 'all', 'all', 3, folders, messagePageSize, 'folder', true,
    );
    expect(searchInput.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(setStatus).toHaveBeenCalledWith('已清空搜索和筛选');
  });

  it('loadMoreMessages grows the limit and reports the visible count', async () => {
    const { result, loadMessagesWithVisibleFallback, setStatus } = renderController();
    loadMessagesWithVisibleFallback.mockResolvedValue([{ id: 1 } as MessageSummary]);
    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledWith(
      101, '', 'all', 'all', 1, folders, messagePageSize + messagePageSize, 'folder', false,
    );
    expect(setStatus).toHaveBeenCalledWith('已加载 1 封邮件');
    expect(result.current.loadMoreStatus).toBeNull();
  });

  it('loadMoreMessages ignores concurrent invocations', async () => {
    const { result, loadMessagesWithVisibleFallback } = renderController();
    let resolveFirst: ((value: MessageSummary[]) => void) | null = null;
    loadMessagesWithVisibleFallback.mockImplementation(() => new Promise((resolve) => {
      resolveFirst = resolve;
    }));
    let first: Promise<MessageSummary[]> | null = null;
    act(() => {
      first = result.current.loadMoreMessages();
    });
    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst?.([{ id: 1 } as MessageSummary]);
      await first;
    });
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledTimes(1);
  });

  it('loadMoreMessages pulls server history when the local cache is exhausted', async () => {
    const { result, loadMessagesWithVisibleFallback, syncImapHistoryPage, loadMeta, setStatus } = renderController({
      imapMailboxes: [incompleteMailbox],
      messages: [{ id: 1 } as MessageSummary, { id: 2 } as MessageSummary],
    });
    loadMessagesWithVisibleFallback.mockResolvedValueOnce([{ id: 1 } as MessageSummary]);
    loadMessagesWithVisibleFallback.mockResolvedValueOnce([{ id: 3 } as MessageSummary]);
    await act(async () => {
      await result.current.loadMoreMessages();
    });
    expect(syncImapHistoryPage).toHaveBeenCalledWith(7);
    expect(loadMeta).toHaveBeenCalledWith(101, 'all', { mode: 'mailbox' });
    expect(loadMessagesWithVisibleFallback).toHaveBeenLastCalledWith(
      101, '', 'all', 'all', 1, folders, messagePageSize + messagePageSize, 'folder', false,
    );
    expect(setStatus).toHaveBeenCalledWith('同步完成 · 已显示 1 封邮件');
  });

  it('runSavedSearch applies the saved query filter and scope', async () => {
    const { result, loadMessages, setStatus } = renderController();
    const savedSearch: SavedSearch = { id: 's1', name: '发票', query: 'invoice', filter: 'starred', scope: 'all' };
    await act(async () => {
      await result.current.runSavedSearch(savedSearch);
    });
    expect(result.current.queryDraft).toBe('invoice');
    expect(result.current.appliedQuery).toBe('invoice');
    expect(result.current.filter).toBe('starred');
    expect(result.current.searchScope).toBe('all');
    expect(result.current.listMode).toBe('messages');
    expect(loadMessages).toHaveBeenCalledWith(
      101, 'invoice', 'starred', 'all', 2, messagePageSize, 'all', false,
    );
    expect(setStatus).toHaveBeenCalledWith('已运行保存搜索：发票');
  });

  it('saveCurrentSearch rejects an empty query', () => {
    const { result, setStatus } = renderController();
    act(() => result.current.saveCurrentSearch('', 'all', 'folder'));
    expect(setStatus).toHaveBeenCalledWith('请输入搜索条件后再保存');
    expect(result.current.savedSearches).toEqual([]);
  });

  it('saveCurrentSearch dedupes by name and by identical query filter and scope', () => {
    const { result, setStatus } = renderController();
    act(() => {
      result.current.setQuery('invoice');
      result.current.setFilter('starred');
      result.current.setSearchScope('all');
      result.current.setSavedSearchName('发票');
    });
    act(() => result.current.saveCurrentSearch('invoice', 'starred', 'all'));
    act(() => {
      result.current.setSavedSearchName('发票');
      result.current.saveCurrentSearch('invoice', 'starred', 'all');
    });
    act(() => {
      result.current.setSavedSearchName('');
      result.current.saveCurrentSearch('invoice', 'starred', 'all');
    });
    expect(result.current.savedSearches).toHaveLength(1);
    expect(result.current.savedSearches[0]).toMatchObject({
      name: 'invoice', query: 'invoice', filter: 'starred', scope: 'all',
    });
    expect(result.current.savedSearches[0].id).toBeTypeOf('string');
    expect(result.current.savedSearchName).toBe('');
    expect(setStatus).toHaveBeenLastCalledWith('已保存搜索：invoice');
  });

  it('deleteSavedSearch removes the saved search by id', () => {
    const { result } = renderController();
    act(() => {
      result.current.setSavedSearches([
        { id: 's1', name: '发票', query: 'invoice', filter: 'all', scope: 'all' },
        { id: 's2', name: '行程', query: 'travel', filter: 'all', scope: 'account' },
      ]);
    });
    act(() => result.current.deleteSavedSearch({ id: 's1', name: '发票', query: 'invoice', filter: 'all', scope: 'all' }));
    expect(result.current.savedSearches.map((item) => item.id)).toEqual(['s2']);
  });

  it('handleQueryChange only updates the draft and never invokes a loader', () => {
    const { result, loadMessagesWithVisibleFallback } = renderController();
    act(() => {
      result.current.setQuery('existing');
    });
    loadMessagesWithVisibleFallback.mockClear();
    act(() => {
      result.current.handleQueryChange('i');
      result.current.handleQueryChange('in');
      result.current.handleQueryChange('invoice');
    });
    expect(result.current.queryDraft).toBe('invoice');
    expect(result.current.appliedQuery).toBe('existing');
    expect(loadMessagesWithVisibleFallback).not.toHaveBeenCalled();
  });

  it('clearing the input by typing keeps the current applied search until explicit clear', () => {
    const { result, loadMessagesWithVisibleFallback } = renderController();
    act(() => result.current.setQuery('invoice'));
    act(() => result.current.handleQueryChange(''));
    expect(result.current.queryDraft).toBe('');
    expect(result.current.appliedQuery).toBe('invoice');
    expect(loadMessagesWithVisibleFallback).not.toHaveBeenCalled();
  });

  it('handleShowMessages resets to the message list and clears the open thread', () => {
    const { result, setActiveThread, setThreadMessages } = renderController();
    act(() => result.current.setListMode('threads'));
    act(() => result.current.handleShowMessages());
    expect(result.current.listMode).toBe('messages');
    expect(setActiveThread).toHaveBeenCalledWith(null);
    expect(setThreadMessages).toHaveBeenCalledWith([]);
  });

  it('handleShowThreads loads threads in the current scope', async () => {
    const { result, loadMessagesWithVisibleFallback } = renderController();
    await act(async () => {
      await result.current.handleShowThreads();
    });
    expect(result.current.listMode).toBe('threads');
    expect(loadMessagesWithVisibleFallback).toHaveBeenCalledWith(
      101, '', 'all', 'all', 2, folders, messagePageSize, 'folder', true,
    );
  });

  it('resetSearch clears query filter scope and list mode', () => {
    const { result } = renderController();
    act(() => {
      result.current.setQuery('invoice');
      result.current.setFilter('unread');
      result.current.setSearchScope('all');
      result.current.setListMode('threads');
    });
    act(() => result.current.resetSearch());
    expect(result.current.queryDraft).toBe('');
    expect(result.current.appliedQuery).toBe('');
    expect(result.current.filter).toBe('all');
    expect(result.current.searchScope).toBe('folder');
    expect(result.current.listMode).toBe('messages');
  });
});

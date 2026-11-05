import { useRef, useState } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMailboxNavigation from './useMailboxNavigation';
import useMailboxBootstrap from './useMailboxBootstrap';
import useMailboxData from './useMailboxData';
import type { AccountScope, Folder, MessageSummary } from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
const noop = () => undefined;
const folders: Folder[] = [101, 202].map((id) => ({
  id, account_id: 1, name: `Folder ${id}`, role: id === 101 ? 'inbox' : 'sent', unread_count: 0, is_virtual: false,
}));
const row = (id: number) => ({ id, folder_id: id } as MessageSummary);
function deferred() {
  let resolve!: (rows: MessageSummary[]) => void;
  const promise = new Promise<MessageSummary[]>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(initialQuery = '') {
  return renderHook(() => {
    const [folderId, setFolderId] = useState<number | null>(101);
    const [query, setQuery] = useState(initialQuery);
    const [messages, setMessages] = useState<MessageSummary[]>([]);
    const [, setSelectedMessageIds] = useState<number[]>([]);
    const mailboxRefreshRef = useRef(0);
    const skipNextFolderEffectLoadRef = useRef(false);
    const navigationScopeClaimRef = useRef<AccountScope | null>(1);
    const loadMeta = async () => ({ folderId, folders });
    const data = useMailboxData({
      accountScope: 1, currentAccountId: 1, folderId, searchScope: 'folder', query, filter: 'all', listMode: 'messages', listSort: 'newest',
      folders, imapMailboxes: [], messages, setMessages, setThreads: noop, setMessageLimit: noop, setHasMoreMessages: noop,
      setSelectedId: noop, setSelectedMessageIds, setFilter: noop, setStatus: noop, mailboxRefreshRef,
      loadMeta, maybeRunBenchmarkSync: async () => undefined,
    });
    const navigation = useMailboxNavigation({
      account: null, accounts: [], accountScope: 1, folderId, folders, mailboxRefreshRef, skipNextFolderEffectLoadRef, navigationScopeClaimRef,
      resetSearch: () => { setQuery(''); setSelectedMessageIds([]); }, loadMeta, loadMessagesWithVisibleFallback: data.loadMessagesWithVisibleFallback,
      setActiveSettingsSection: noop, setActiveThread: noop, setAccountScope: noop, setAttachments: noop, setFolderId, setMessages, setSelectedId: noop, setSelectedMessageIds,
      setSettingsOpen: noop, setStatus: noop, setThreadMessages: noop,
    });
    useMailboxBootstrap({
      accountScope: 1, folderId, folderRevision: navigation.folderRevision, appliedQuery: query, filter: 'all', listSort: 'newest', mailboxListStateKey: `scope=1|folder=${folderId}`,
      mailboxRefreshRef, navigationScopeClaimRef, skipNextFolderEffectLoadRef, refreshMailbox: data.refreshMailbox, loadMessages: data.loadMessages, setAccountScope: noop, setStatus: noop,
    });
    return { ...navigation, mailboxView: data.mailboxView, messages, folderId };
  });
}
beforeEach(() => { mockInvoke.mockReset(); window.localStorage.clear(); });
afterEach(cleanup);

describe('explicit folder intent owns a replacement request', () => {
  it('finishes loading after reselecting an in-flight folder and rejects the superseded result', async () => {
    const old = deferred(); const current = deferred(); let calls = 0;
    mockInvoke.mockImplementation((command) => (command === IPC.ListMessages
      ? ++calls === 1 ? Promise.resolve([row(101)]) : calls === 2 ? old.promise : current.promise
      : Promise.resolve(1)) as never);
    const { result } = setup();
    await act(async () => undefined);
    expect(result.current.mailboxView.pending).toBe(false);
    act(() => result.current.selectFolder(202));
    act(() => result.current.selectFolder(202));
    expect(calls).toBe(3);
    await act(async () => { old.resolve([row(999)]); await old.promise; });
    expect(result.current.mailboxView.pending).toBe(true);
    expect(result.current.messages).toEqual([row(101)]);
    await act(async () => { current.resolve([row(202)]); await current.promise; });
    expect(result.current.mailboxView).toMatchObject({ pending: false, unavailable: false, error: null });
    expect(result.current.messages).toEqual([row(202)]);
  });

  it('reloads the final folder when A → B → A is batched without a folderId change', async () => {
    const latest = deferred(); let calls = 0;
    mockInvoke.mockImplementation((command) => (command === IPC.ListMessages
      ? ++calls === 1 ? Promise.resolve([row(101)]) : latest.promise : Promise.resolve(1)) as never);
    const { result } = setup();
    await act(async () => undefined);
    act(() => { result.current.selectFolder(202); result.current.selectFolder(101); });
    expect(calls).toBe(2);
    expect(mockInvoke.mock.calls.filter(([command]) => command === IPC.ListMessages)[1][1]?.folderId).toBe(101);
    await act(async () => { latest.resolve([row(102)]); await latest.promise; });
    expect(result.current.messages).toEqual([row(102)]);
    expect(result.current.mailboxView.pending).toBe(false);
  });

  it('loads the unfiltered view when reselecting the folder clears an existing query', async () => {
    mockInvoke.mockImplementation((command) => Promise.resolve(command === IPC.ListMessages ? [row(101)] : 1) as never);
    const { result } = setup('invoice');
    await act(async () => undefined);
    await act(async () => result.current.selectFolder(101));
    const calls = mockInvoke.mock.calls.filter(([command]) => command === IPC.ListMessages);
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toMatchObject({ folderId: 101, query: null });
    expect(result.current.mailboxView.committedKey).toContain('|query=|');
    expect(result.current.mailboxView.pending).toBe(false);
  });
});

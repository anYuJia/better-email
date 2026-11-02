import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useMailboxNavigation from './useMailboxNavigation';
import type { MessageSummary, ThreadSummary } from '../app/types';
import { invoke } from '../tauriBridge';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
const thread = (key: string) => ({ thread_key: key, subject: key } as ThreadSummary);
const messages = (id: number) => [{ id, account_id: 1 }] as MessageSummary[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function navigation() {
  const setters = {
    setActiveSettingsSection: vi.fn(), setActiveThread: vi.fn(), setAccountScope: vi.fn(),
    setAttachments: vi.fn(), setFolderId: vi.fn(), setMessages: vi.fn(), setSelectedId: vi.fn(),
    setSelectedMessageIds: vi.fn(), setSettingsOpen: vi.fn(), setStatus: vi.fn(), setThreadMessages: vi.fn(),
  };
  const mailboxRefreshRef = { current: 0 };
  const hook = renderHook(() => useMailboxNavigation({
    account: null, accounts: [], accountScope: 1, folderId: 101, folders: [],
    mailboxRefreshRef, skipNextFolderEffectLoadRef: { current: false },
    navigationScopeClaimRef: { current: null }, resetSearch: vi.fn(),
    loadMeta: vi.fn(), loadMessagesWithVisibleFallback: vi.fn(), ...setters,
  }));
  return { ...hook, setters, mailboxRefreshRef };
}

describe('thread navigation request ownership', () => {
  beforeEach(() => { mockInvoke.mockReset(); });
  it('only commits the last selected thread when responses arrive out of order', async () => {
    const first = deferred<MessageSummary[]>();
    const second = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, setters } = navigation();
    const firstRequest = result.current.openThread(thread('first'));
    const secondRequest = result.current.openThread(thread('second'));
    await act(async () => { second.resolve(messages(2)); await secondRequest; });
    await act(async () => { first.resolve(messages(1)); await firstRequest; });
    expect(setters.setActiveThread).toHaveBeenCalledTimes(1);
    expect(setters.setActiveThread).toHaveBeenLastCalledWith(thread('second'));
    expect(setters.setSelectedId).toHaveBeenLastCalledWith(2);
  });
  it.each(['account', 'folder', 'mode'] as const)('ignores an old thread after %s navigation', async (navigationType) => {
    const pending = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValue(pending.promise);
    const { result, setters } = navigation();
    const request = result.current.openThread(thread('old'));
    act(() => {
      if (navigationType === 'account') result.current.changeAccountScope('2');
      else if (navigationType === 'folder') result.current.selectFolder(202);
      else result.current.invalidateThreadRequest();
    });
    setters.setActiveThread.mockClear();
    setters.setSelectedId.mockClear();
    await act(async () => { pending.resolve(messages(9)); await request; });
    expect(setters.setActiveThread).not.toHaveBeenCalled();
    expect(setters.setSelectedId).not.toHaveBeenCalled();
  });
  it('ignores an error from a superseded thread request', async () => {
    const pending = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValue(pending.promise);
    const { result, mailboxRefreshRef } = navigation();
    const request = result.current.openThread(thread('old'));
    act(() => result.current.selectFolder(202));
    expect(mailboxRefreshRef.current).toBe(1);
    await act(async () => {
      pending.reject(new Error('old failure'));
      const received = await request;
      expect(received).toEqual([]);
    });
  });
});

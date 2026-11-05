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
  it('selects a requested conversation and removes the previous messages before its read resolves', async () => {
    const pending = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValue(pending.promise);
    const { result, setters } = navigation();
    let request!: Promise<MessageSummary[]>;
    act(() => { request = result.current.openThread(thread('next')); });
    expect(setters.setActiveThread).toHaveBeenLastCalledWith(thread('next'));
    expect(setters.setThreadMessages).toHaveBeenLastCalledWith([]);
    expect(setters.setSelectedId).toHaveBeenLastCalledWith(null);
    await act(async () => { pending.resolve(messages(2)); await request; });
  });
  it('only commits the last selected thread when responses arrive out of order', async () => {
    const first = deferred<MessageSummary[]>();
    const second = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, setters } = navigation();
    let firstRequest!: Promise<MessageSummary[]>, secondRequest!: Promise<MessageSummary[]>;
    act(() => {
      firstRequest = result.current.openThread(thread('first'));
      secondRequest = result.current.openThread(thread('second'));
    });
    expect(result.current.threadReaderProps.threadLoadState).toEqual({ threadKey: 'second', status: 'loading' });
    await act(async () => { second.resolve(messages(2)); await secondRequest; });
    await act(async () => { first.resolve(messages(1)); await firstRequest; });
    expect(setters.setActiveThread).toHaveBeenCalledTimes(2);
    expect(setters.setActiveThread).toHaveBeenLastCalledWith(thread('second'));
    expect(setters.setSelectedId).toHaveBeenLastCalledWith(2);
    expect(result.current.threadReaderProps.threadLoadState).toBeNull();
  });
  it.each(['account', 'folder', 'mode'] as const)('ignores an old thread after %s navigation', async (navigationType) => {
    const pending = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValue(pending.promise);
    const { result, setters } = navigation();
    let request!: Promise<MessageSummary[]>;
    act(() => { request = result.current.openThread(thread('old')); });
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
    let request!: Promise<MessageSummary[]>;
    act(() => { request = result.current.openThread(thread('old')); });
    act(() => result.current.selectFolder(202));
    expect(mailboxRefreshRef.current).toBe(1);
    await act(async () => {
      pending.reject(new Error('old failure'));
      const received = await request;
      expect(received).toEqual([]);
    });
  });

  it.each(['filter', 'search'])('cancels a pending reader when %s advances the mailbox generation', async () => {
    const pending = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValue(pending.promise);
    const { result, rerender, setters, mailboxRefreshRef } = navigation();
    let request!: Promise<MessageSummary[]>;
    act(() => { request = result.current.openThread(thread('old')); });
    act(() => { mailboxRefreshRef.current += 1; rerender(); });
    expect(result.current.threadReaderProps.threadLoadState).toBeNull();
    expect(setters.setActiveThread).toHaveBeenLastCalledWith(null);
    setters.setThreadMessages.mockClear();
    await act(async () => { pending.resolve(messages(9)); await request; });
    expect(setters.setThreadMessages).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed target available for one local retry without leaking the raw error', async () => {
    const failed = deferred<MessageSummary[]>(), retry = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise);
    const { result } = navigation();
    let request!: Promise<MessageSummary[]>;
    act(() => { request = result.current.openThread(thread('target')); });
    await act(async () => { failed.reject(new Error('private database details')); expect(await request).toEqual([]); });
    expect(result.current.threadReaderProps.threadLoadState).toEqual({ threadKey: 'target', status: 'error' });
    act(() => result.current.threadReaderProps.onRetryThread());
    expect(result.current.threadReaderProps.threadLoadState).toEqual({ threadKey: 'target', status: 'loading' });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    await act(async () => { retry.resolve(messages(2)); await retry.promise; });
    expect(result.current.threadReaderProps.threadLoadState).toBeNull();
  });

  it('finishes an empty response without restoring the previous selection or staying busy', async () => {
    mockInvoke.mockResolvedValue([]);
    const { result, setters } = navigation();
    await act(async () => { await result.current.openThread(thread('empty')); });
    expect(result.current.threadReaderProps.threadLoadState).toBeNull();
    expect(setters.setActiveThread).toHaveBeenLastCalledWith(thread('empty'));
    expect(setters.setThreadMessages).toHaveBeenLastCalledWith([]);
    expect(setters.setSelectedId).toHaveBeenLastCalledWith(null);
    expect(setters.setStatus).toHaveBeenLastCalledWith('此会话暂无可显示的邮件');
  });

  it('reads a context menu target without selecting it or superseding the pending reader', async () => {
    const selected = deferred<MessageSummary[]>(), menu = deferred<MessageSummary[]>();
    mockInvoke.mockReturnValueOnce(selected.promise).mockReturnValueOnce(menu.promise);
    const { result, setters } = navigation();
    let readerRequest!: Promise<MessageSummary[]>;
    act(() => { readerRequest = result.current.openThread(thread('reader')); });
    const menuRequest = result.current.loadThreadMessages(thread('menu'));
    await act(async () => { menu.resolve(messages(8)); expect(await menuRequest).toEqual(messages(8)); });
    expect(setters.setActiveThread).toHaveBeenCalledTimes(1);
    expect(result.current.threadReaderProps.threadLoadState).toEqual({ threadKey: 'reader', status: 'loading' });
    await act(async () => { selected.resolve(messages(1)); await readerRequest; });
    expect(setters.setSelectedId).toHaveBeenLastCalledWith(1);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it('refreshes a ready current thread without clearing content or replacing its selected child', async () => {
    mockInvoke.mockResolvedValue(messages(1));
    const { result, setters } = navigation();
    await act(async () => { await result.current.openThread(thread('reader')); });
    setters.setThreadMessages.mockClear(); setters.setSelectedId.mockClear(); setters.setActiveThread.mockClear();
    const refresh = deferred<MessageSummary[]>(); mockInvoke.mockReturnValue(refresh.promise);
    let request!: Promise<MessageSummary[]>;
    act(() => { request = result.current.openThread(thread('reader'), false); });
    expect(result.current.threadReaderProps.threadLoadState).toBeNull();
    expect(setters.setThreadMessages).not.toHaveBeenCalled();
    await act(async () => { refresh.resolve([...messages(1), ...messages(2)]); await request; });
    expect(setters.setActiveThread).not.toHaveBeenCalled();
    const update = setters.setSelectedId.mock.calls[0][0];
    expect(update(1)).toBe(1);
    expect(update(99)).toBe(2);
  });

  it('does not let stale background work return to the previous thread or duplicate a pending read', async () => {
    const pending = deferred<MessageSummary[]>(); mockInvoke.mockReturnValue(pending.promise);
    const { result } = navigation();
    let request!: Promise<MessageSummary[]>;
    act(() => { request = result.current.openThread(thread('new')); });
    expect(await result.current.openThread(thread('old'), false)).toEqual([]);
    expect(await result.current.openThread(thread('new'), false)).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(messages(2)); await request; });
    expect(await result.current.openThread(thread('old'), false)).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

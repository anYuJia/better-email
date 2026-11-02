import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useQuickReplyDraft from './useQuickReplyDraft';

const storageKey = (account: number, message: number) => `better-email.quickReply.v1.${account}:${message}`;
function renderDraft(accountId = 1, messageId = 10) {
  const onError = vi.fn();
  const hook = renderHook((props) => useQuickReplyDraft(props.accountId, props.messageId, onError), {
    initialProps: { accountId, messageId },
  });
  return { ...hook, onError };
}

describe('quick reply recovery by account and message', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());
  it('restores replies after message/account navigation and a remount', () => {
    const { result, rerender, unmount } = renderDraft();
    act(() => result.current.setQuickReplyBody('A 的未发送回复'));
    rerender({ accountId: 1, messageId: 20 });
    expect(result.current.quickReplyBody).toBe('');
    act(() => result.current.setQuickReplyBody('B 的未发送回复'));
    rerender({ accountId: 2, messageId: 10 });
    expect(result.current.quickReplyBody).toBe('');
    rerender({ accountId: 1, messageId: 10 });
    expect(result.current.quickReplyBody).toBe('A 的未发送回复');
    unmount();
    const restored = renderDraft();
    expect(restored.result.current.quickReplyBody).toBe('A 的未发送回复');
  });
  it('only clears the submitted revision and never another message or newer edit', () => {
    const { result, rerender } = renderDraft();
    act(() => result.current.setQuickReplyBody('first version'));
    const submitted = result.current.getQuickReplySnapshot();
    act(() => result.current.setQuickReplyBody('new edit after submission'));
    act(() => result.current.clearSubmittedQuickReply(submitted));
    expect(result.current.quickReplyBody).toBe('new edit after submission');
    const updated = result.current.getQuickReplySnapshot();
    rerender({ accountId: 1, messageId: 20 });
    act(() => result.current.setQuickReplyBody('another reply'));
    act(() => result.current.clearSubmittedQuickReply(updated));
    expect(result.current.quickReplyBody).toBe('another reply');
    rerender({ accountId: 1, messageId: 10 });
    expect(result.current.quickReplyBody).toBe('');
  });
  it('retains in-memory edits on storage failure and retries failed records after navigation', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disk full'); });
    const { result, rerender, onError } = renderDraft();
    act(() => result.current.setQuickReplyBody('must survive'));
    expect(result.current.quickReplyBody).toBe('must survive');
    expect(result.current.quickReplySaveError).toContain('未能保存');
    expect(onError).toHaveBeenCalled();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    rerender({ accountId: 1, messageId: 20 });
    expect(result.current.quickReplySaveError).toContain('未能保存');
    write.mockRestore();
    act(() => result.current.retryQuickReplySave());
    expect(result.current.quickReplySaveError).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey(1, 10))!).body).toBe('must survive');
  });
  it('keeps a sent reply cleared in memory if tombstone persistence fails and retries clearing', () => {
    const { result } = renderDraft();
    act(() => result.current.setQuickReplyBody('already submitted'));
    const submitted = result.current.getQuickReplySnapshot();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('write blocked'); });
    act(() => result.current.clearSubmittedQuickReply(submitted));
    expect(result.current.quickReplyBody).toBe('');
    expect(result.current.quickReplySaveError).toContain('请勿重复发送');
    write.mockRestore();
    act(() => result.current.retryQuickReplySave());
    expect(JSON.parse(localStorage.getItem(storageKey(1, 10))!).body).toBe('');
    expect(result.current.quickReplySaveError).toBeNull();
  });
  it('does not resurrect its own older saved text when the submitted edit failed to persist', () => {
    const { result } = renderDraft();
    act(() => result.current.setQuickReplyBody('older local version'));
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disk full'); });
    act(() => result.current.setQuickReplyBody('newer submitted version'));
    const submitted = result.current.getQuickReplySnapshot();
    act(() => result.current.clearSubmittedQuickReply(submitted));
    expect(result.current.quickReplyBody).toBe('');
    expect(result.current.quickReplySaveError).toContain('请勿重复发送');
    write.mockRestore();
    act(() => result.current.retryQuickReplySave());
    expect(JSON.parse(localStorage.getItem(storageKey(1, 10))!).body).toBe('');
  });
  it('does not erase a newer revision saved by another window', () => {
    const { result } = renderDraft();
    act(() => result.current.setQuickReplyBody('submitted'));
    const submitted = result.current.getQuickReplySnapshot();
    localStorage.setItem(storageKey(1, 10), JSON.stringify({ body: 'other window edit', revision: 'other-revision' }));
    act(() => result.current.clearSubmittedQuickReply(submitted));
    expect(result.current.quickReplyBody).toBe('other window edit');
  });
  it('bounds recently read messages and reloads an evicted saved reply after reading 100 messages', () => {
    const { result, rerender } = renderDraft(1, 1);
    act(() => result.current.setQuickReplyBody('persisted early reply'));
    const read = vi.spyOn(Storage.prototype, 'getItem');
    for (let messageId = 2; messageId <= 100; messageId += 1) rerender({ accountId: 1, messageId });
    read.mockClear();
    rerender({ accountId: 1, messageId: 99 });
    rerender({ accountId: 1, messageId: 81 });
    expect(read).not.toHaveBeenCalled();
    rerender({ accountId: 1, messageId: 80 });
    expect(read).toHaveBeenCalledExactlyOnceWith(storageKey(1, 80));
    read.mockClear();
    rerender({ accountId: 1, messageId: 1 });
    expect(read).toHaveBeenCalledExactlyOnceWith(storageKey(1, 1));
    expect(result.current.quickReplyBody).toBe('persisted early reply');
  });
  it('keeps failed writes outside the cache bound until they are safely persisted', () => {
    const { result, rerender } = renderDraft(1, 1);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disk full'); });
    act(() => result.current.setQuickReplyBody('only surviving copy'));
    for (let messageId = 2; messageId <= 100; messageId += 1) rerender({ accountId: 1, messageId });
    rerender({ accountId: 1, messageId: 1 });
    expect(result.current.quickReplyBody).toBe('only surviving copy');
    expect(result.current.quickReplySaveError).toContain('未能保存');
    write.mockRestore();
    act(() => result.current.retryQuickReplySave());
    expect(JSON.parse(localStorage.getItem(storageKey(1, 1))!).body).toBe('only surviving copy');
  });
  it('clears a successfully submitted revision even after its cache entry is evicted', () => {
    const { result, rerender } = renderDraft(1, 1);
    act(() => result.current.setQuickReplyBody('submitted before navigation'));
    const submitted = result.current.getQuickReplySnapshot();
    for (let messageId = 2; messageId <= 100; messageId += 1) rerender({ accountId: 1, messageId });
    act(() => result.current.clearSubmittedQuickReply(submitted));
    expect(JSON.parse(localStorage.getItem(storageKey(1, 1))!).body).toBe('');
    rerender({ accountId: 1, messageId: 1 });
    expect(result.current.quickReplyBody).toBe('');
  });
  it('reflects a separate composer consuming the source, ignoring stale events and preserving unsaved local edits', () => {
    const { result } = renderDraft();
    act(() => result.current.setQuickReplyBody('转入独立窗口'));
    const key = storageKey(1, 10);
    const consumed = JSON.stringify({ body: '', revision: 'submitted' });
    localStorage.setItem(key, consumed);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue: consumed })));
    expect(result.current.quickReplyBody).toBe('');
    act(() => result.current.setQuickReplyBody('后续编辑'));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue: consumed })));
    expect(result.current.quickReplyBody).toBe('后续编辑');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    act(() => result.current.setQuickReplyBody('唯一未保存副本'));
    write.mockRestore();
    localStorage.setItem(key, consumed);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key, newValue: consumed })));
    expect(result.current.quickReplyBody).toBe('唯一未保存副本');
    expect(result.current.quickReplySaveError).toContain('未能保存');
  });

});

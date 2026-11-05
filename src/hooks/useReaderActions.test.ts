import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, Message } from '../app/types';
import { invoke } from '../tauriBridge';
import useReaderActions from './useReaderActions';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
const first: Message = {
  id: 1, account_id: 1, account_email: 'me@example.com', folder_id: 1, folder_role: 'inbox',
  sender_name: 'One', sender_email: 'one@example.com', recipients: 'me@example.com', cc: '', bcc: '',
  subject: 'First message', snippet: '', body: '', sanitized_html: '', security_warnings: [],
  received_at: '2026-10-30T00:00:00Z', is_read: true, is_starred: false, has_attachments: false,
  snoozed_until: '', labels: [], attachment_count: 0, remote_uid: 1, remote_mailbox: 'INBOX',
};
const second = { ...first, id: 2, body: 'Second message' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  let currentDetail: Message | null = first;
  let currentAttachments = [{ id: 20, message_id: 2 }] as Attachment[];
  const setSelectedDetail = vi.fn((value) => { currentDetail = typeof value === 'function' ? value(currentDetail) : value; });
  const setAttachments = vi.fn((value) => { currentAttachments = typeof value === 'function' ? value(currentAttachments) : value; });
  const setStatus = vi.fn();
  const onUpdateCache = vi.fn();
  const rest = {
    setSelectedDetail, setAttachments, setStatus, onUpdateCache, activeThread: null, folderId: 1,
    setMessages: vi.fn(), setThreadMessages: vi.fn(), setRemoteImageTrusts: vi.fn(), setRules: vi.fn(),
    setSelectedId: vi.fn(), visibleFolderIdForRole: vi.fn(() => 1), loadMeta: vi.fn(), loadMessages: vi.fn(),
    bodyFetchFailedRef: { current: new Set<number>() }, bodyFetchInFlightRef: { current: new Set<number>() },
    onBodyFetchStart: vi.fn(), onBodyFetchSuccess: vi.fn(), onBodyFetchError: vi.fn(),
  };
  const hook = renderHook(({ selected }) => useReaderActions({ ...rest, selected, selectedDetail: selected }), { initialProps: { selected: first } });
  return { ...hook, ...rest, detail: () => currentDetail, attachments: () => currentAttachments,
    select: (selected: Message) => { currentDetail = selected; hook.rerender({ selected }); } };
}

beforeEach(() => { mockInvoke.mockReset(); });
afterEach(cleanup);

describe('reader action result ownership', () => {
  it('registers an explicit refresh once when repeated before its request settles', async () => {
    const body = deferred<Message>();
    mockInvoke.mockImplementation(async (command) => command === 'fetch_message_body' ? body.promise : []);
    const view = setup();
    let firstRequest!: Promise<void>;
    let repeatedRequest!: Promise<void>;
    act(() => {
      firstRequest = view.result.current.fetchSelectedBody();
      repeatedRequest = view.result.current.fetchSelectedBody();
    });
    expect(view.onBodyFetchStart).toHaveBeenCalledExactlyOnceWith(1, 'manual');
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'fetch_message_body')).toHaveLength(1);
    await act(async () => { body.resolve({ ...first, body: 'Loaded' }); await Promise.all([firstRequest, repeatedRequest]); });
    expect(view.bodyFetchInFlightRef.current.size).toBe(0);
    expect(view.onBodyFetchSuccess).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each(['openAttachment', 'saveAttachmentAs'] as const)('refreshes a missing local file after %s so download becomes available', async (action) => {
    const missing = { id: 10, message_id: 1, is_downloaded: true, local_path: '/old/temp.pdf' } as Attachment;
    const refreshed = [{ ...missing, is_downloaded: false, local_path: '' }];
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'list_attachments') return refreshed;
      throw new Error('本地副本已丢失，请重新下载');
    });
    const view = setup();
    await act(async () => { await view.result.current[action](missing); });
    expect(view.attachments()).toEqual(refreshed);
    expect(view.setStatus).toHaveBeenCalledWith(expect.stringContaining('重新下载'));
  });

  it('does not replace another message attachments when a file-access recovery arrives late', async () => {
    const refreshed = deferred<Attachment[]>();
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'list_attachments') return refreshed.promise;
      throw new Error('附件文件丢失');
    });
    const view = setup();
    let pending!: Promise<void>;
    await act(async () => { pending = view.result.current.openAttachment({ id: 10, message_id: 1, is_downloaded: true } as Attachment); });
    view.select(second);
    await act(async () => { refreshed.resolve([]); await pending; });
    expect(view.attachments()).toEqual([{ id: 20, message_id: 2 }]);
  });
  it('keeps the new message and its attachments when an earlier body request completes', async () => {
    const body = deferred<Message>();
    mockInvoke.mockImplementation(async (command) => command === 'fetch_message_body' ? body.promise : [{ id: 10, message_id: 1 }]);
    const view = setup();
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.fetchSelectedBody(); });
    view.select(second);
    const updated = { ...first, body: 'Late first message' };
    await act(async () => { body.resolve(updated); await pending; });
    expect(view.detail()).toBe(second);
    expect(view.attachments()).toEqual([{ id: 20, message_id: 2 }]);
    expect(view.onUpdateCache).toHaveBeenCalledWith(updated);
    expect(view.setStatus).not.toHaveBeenCalled();
  });

  it('does not apply attachments that arrive after leaving a successfully loaded message', async () => {
    const attachments = deferred<Attachment[]>();
    mockInvoke.mockImplementation(async (command) => command === 'fetch_message_body' ? { ...first, body: 'Loaded' } : attachments.promise);
    const view = setup();
    let pending!: Promise<void>;
    await act(async () => { pending = view.result.current.fetchSelectedBody(); });
    expect(view.detail()?.body).toBe('Loaded');
    view.select(second);
    await act(async () => { attachments.resolve([{ id: 10, message_id: 1 }] as Attachment[]); await pending; });
    expect(view.detail()).toBe(second);
    expect(view.attachments()).toEqual([{ id: 20, message_id: 2 }]);
  });

  it.each(['allowRemoteImagesForSelectedOnce', 'renderSelectedWithRemoteImagePolicy'] as const)('does not replace a newer selection after %s', async (action) => {
    const response = deferred<Message>();
    mockInvoke.mockImplementation(async () => response.promise);
    const view = setup();
    let pending!: Promise<unknown>;
    act(() => { pending = view.result.current[action](); });
    view.select(second);
    const updated = { ...first, sanitized_html: '<img src="https://example.com/picture">' };
    await act(async () => { response.resolve(updated); await pending; });
    expect(view.detail()).toBe(second);
    expect(view.onUpdateCache).toHaveBeenCalledWith(updated);
    expect(view.setStatus).not.toHaveBeenCalled();
  });

  it('applies an unfinished body when returning to the same message', async () => {
    const body = deferred<Message>();
    mockInvoke.mockImplementation(async (command) => command === 'fetch_message_body' ? body.promise : []);
    const view = setup();
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.fetchSelectedBody(); });
    view.select(second);
    view.select(first);
    const updated = { ...first, body: 'Finished after returning' };
    await act(async () => { body.resolve(updated); await pending; });
    expect(view.detail()).toBe(updated);
    expect(view.setStatus).toHaveBeenCalledWith('远端正文已拉取并缓存到本地');
  });
});

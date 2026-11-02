import { useLayoutEffect, useRef, useState } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../app/types';
import { invoke } from '../tauriBridge';
import { MessageDetailLRU } from './readerSelectionState';
import useReaderBodyLoading, { type ReaderBodyFetchState } from './useReaderBodyLoading';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
const header: Message = {
  id: 1, account_id: 1, account_email: 'me@example.com', folder_id: 1, folder_role: 'inbox',
  sender_name: 'Ada', sender_email: 'ada@example.com', recipients: 'me@example.com', cc: '', bcc: '',
  subject: 'Body load', snippet: '', body: '', sanitized_html: '', security_warnings: [],
  received_at: '', is_read: false, is_starred: false, has_attachments: false, snoozed_until: '',
  labels: [], attachment_count: 0, remote_mailbox: 'INBOX', remote_uid: 7,
};

function setup() {
  const history: { message: Message; state: ReaderBodyFetchState | null }[] = [];
  const setters = { setAttachments: vi.fn(), setMessages: vi.fn(), setStatus: vi.fn(), setThreadMessages: vi.fn() };
  const view = renderHook(({ selected }) => {
    const [detail, setDetail] = useState(selected);
    useLayoutEffect(() => setDetail(selected), [selected]);
    const cache = useRef(new MessageDetailLRU());
    const loading = useReaderBodyLoading({
      readerSelectedDetail: detail, selectedDetail: detail, selectedSenderTrusted: false,
      activeThread: null, messageDetailCacheRef: cache, setSelectedDetail: setDetail, ...setters,
    });
    history.push({ message: detail!, state: loading.bodyFetchState });
    return { ...loading, detail, setDetail };
  }, { initialProps: { selected: header as Message | null } });
  return { ...view, history, ...setters };
}

beforeEach(() => mockInvoke.mockReset());
afterEach(cleanup);

describe('remote body availability', () => {
  it('exposes header-only loading on the first render before effects schedule the request', () => {
    mockInvoke.mockResolvedValue([]);
    const view = setup();
    expect(view.history[0].state).toEqual({ messageId: 1, status: 'loading', error: null });
    expect(mockInvoke).not.toHaveBeenCalledWith('fetch_message_body', expect.anything());
  });

  it('commits fetched content and completion together without a readable empty-header frame', async () => {
    let resolve!: (message: Message) => void;
    const pending = new Promise<Message>((yes) => { resolve = yes; });
    mockInvoke.mockImplementation(async (command) => command === 'fetch_message_body' ? pending : []);
    const view = setup();
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('fetch_message_body', { messageId: 1 }));
    const fetched = { ...header, body: '正文'.repeat(150_000) };
    await act(async () => resolve(fetched));
    await waitFor(() => expect(view.result.current.detail).toEqual(fetched));
    expect(view.result.current.bodyFetchState).toBeNull();
    expect(view.history.filter(({ message }) => message.body === '').every(({ state }) => state?.status === 'loading')).toBe(true);
  });

  it('retains a successful empty body on return and allows an explicit failed reload to recover', async () => {
    mockInvoke.mockImplementation(async (command) => command === 'fetch_message_body' ? { ...header } : []);
    const view = setup();
    await waitFor(() => expect(view.result.current.bodyFetchState).toBeNull());
    const other = { ...header, id: 2, body: '另一封邮件' };
    view.rerender({ selected: other });
    view.rerender({ selected: header });
    expect(view.result.current.bodyFetchState).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'fetch_message_body')).toHaveLength(1);

    act(() => view.result.current.markBodyFetchStarted(1));
    expect(view.result.current.bodyFetchState?.status).toBe('loading');
    act(() => view.result.current.markBodyFetchFailed(1, '重新加载失败'));
    expect(view.result.current.bodyFetchState?.error).toBe('重新加载失败');
    act(() => view.result.current.markBodyFetchStarted(1));
    act(() => view.result.current.markBodyFetchSucceeded(1));
    expect(view.result.current.bodyFetchState).toBeNull();
  });
});

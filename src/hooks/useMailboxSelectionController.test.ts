import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useLayoutEffect } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import useMailboxSelectionController from './useMailboxSelectionController';
import type { Attachment, Folder, MailStats, Message, MessageSummary, ThreadSummary } from '../app/types';

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

function message(id: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    account_id: 1,
    account_email: 'demo@better-email.local',
    folder_id: 101,
    folder_role: 'inbox',
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'demo@better-email.local',
    cc: '',
    bcc: '',
    subject: `Subject ${id}`,
    snippet: 'Snippet',
    body: `Body ${id}`,
    sanitized_html: `<p>Body ${id}</p>`,
    security_warnings: [],
    received_at: '2026-07-09T10:00:00+08:00',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: id,
    message_id_header: `<mock-${id}@better-email.local>`,
    in_reply_to_header: '',
    references_header: '',
    ...overrides,
  };
}

function summary(id: number, overrides: Partial<MessageSummary> = {}): MessageSummary {
  const detail = message(id);
  const { body, sanitized_html, ...rest } = detail;
  return { ...rest, security_warnings: detail.security_warnings, ...overrides };
}

const folders: Folder[] = [
  { id: 101, account_id: 1, name: '收件箱', role: 'inbox', unread_count: 2, is_virtual: false },
];

const stats: MailStats = {
  total_messages: 2,
  unread_messages: 2,
  starred_messages: 0,
  draft_messages: 0,
  attachment_messages: 0,
};

function renderController({
  mailboxContextKey = '1|101||all|messages',
  messages = [summary(1), summary(2)],
  threadMessages = [],
  threads = [],
  activeThread = null,
  remoteImageTrusts = [],
}: {
  mailboxContextKey?: string;
  messages?: MessageSummary[];
  threadMessages?: MessageSummary[];
  threads?: ThreadSummary[];
  activeThread?: ThreadSummary | null;
  remoteImageTrusts?: Parameters<typeof useMailboxSelectionController>[0]['remoteImageTrusts'];
} = {}) {
  const setters = {
    setMessages: vi.fn(),
    setThreadMessages: vi.fn(),
    setThreads: vi.fn(),
    setActiveThread: vi.fn(),
    setStats: vi.fn(),
    setFolders: vi.fn(),
    setAttachments: vi.fn(),
    setStatus: vi.fn(),
  };
  const initialProps: {
    mailboxContextKey: string;
    remoteImageTrusts?: Parameters<typeof useMailboxSelectionController>[0]['remoteImageTrusts'];
  } = { mailboxContextKey };
  const commits: Array<{ selectedId: number | null; detailId: number | null; loading: string; attachmentsLoaded: boolean }> = [];
  const hook = renderHook(
    (props: { mailboxContextKey: string; remoteImageTrusts?: Parameters<typeof useMailboxSelectionController>[0]['remoteImageTrusts'] }) => {
      const result = useMailboxSelectionController({
      messages,
      threadMessages,
      threads,
      activeThread,
      folders,
      stats,
      mailboxContextKey: props.mailboxContextKey,
      remoteImageTrusts: props.remoteImageTrusts ?? remoteImageTrusts,
      ...setters,
      });
      useLayoutEffect(() => {
        commits.push({ selectedId: result.selectedId, detailId: result.readerSelectedDetail?.id ?? null,
          loading: result.detailLoadState.status, attachmentsLoaded: result.attachmentsLoaded });
      });
      return result;
    },
    { initialProps },
  );
  return { ...hook, setters, commits };
}

describe('useMailboxSelectionController', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    localStorage.clear();
  });

  it('loads the detail for the initially selected message', async () => {
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_message_detail') return Promise.resolve(message(1));
      return Promise.resolve([]);
    }) as never);
    const { result } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_message_detail', { messageId: 1 });
    });
    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.id).toBe(1);
    });
    expect(result.current.readerSelectedDetail?.subject).toBe('Subject 1');
  });

  it('revisits a cached message without committing a loading surface or reusing another message attachment state', async () => {
    mockInvoke.mockImplementation(((command: string, args?: { messageId: number }) => command === 'get_message_detail'
      ? Promise.resolve(message(args!.messageId)) : Promise.resolve([])) as never);
    const { result, commits } = renderController();
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(result.current.attachmentsLoaded).toBe(true));
    act(() => result.current.setSelectedId(2));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(2));
    await waitFor(() => expect(result.current.attachmentsLoaded).toBe(true));
    commits.length = 0;
    act(() => result.current.setSelectedId(1));
    expect(commits[0]).toEqual({ selectedId: 1, detailId: 1, loading: 'idle', attachmentsLoaded: false });
    expect(commits.every(commit => commit.detailId === 1 && commit.loading === 'idle')).toBe(true);
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'get_message_detail')).toHaveLength(2);
  });

  it('does not reveal cached content on the first commit after a mailbox context change', async () => {
    let resolveReload!: (value: Message) => void;
    mockInvoke.mockImplementation(((command: string) => command === 'get_message_detail'
      ? Promise.resolve(message(1)) : Promise.resolve([])) as never);
    const { result, rerender, commits } = renderController();
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(1));
    mockInvoke.mockImplementation(((command: string) => command === 'get_message_detail'
      ? new Promise<Message>(resolve => { resolveReload = resolve; }) : Promise.resolve([])) as never);
    commits.length = 0;
    rerender({ mailboxContextKey: '1|101|new-search|all|messages' });
    expect(commits[0].detailId).toBeNull();
    expect(commits.every(commit => commit.detailId === null && commit.loading === 'loading')).toBe(true);
    await act(async () => resolveReload(message(1, { body: 'Reloaded content' })));
    expect(result.current.readerSelectedDetail?.body).toBe('Reloaded content');
  });

  it('syncs optimistic label updates to both list and thread caches and selected detail', async () => {
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_message_detail') return Promise.resolve(message(1));
      return Promise.resolve([]);
    }) as never);
    const { result, setters } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });
    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.id).toBe(1);
    });
    expect(result.current.selectedDetail?.labels).toEqual([]);

    act(() => {
      result.current.patchSelectedDetailMetadata(1, { labels: ['工作'] });
    });

    expect(result.current.selectedDetail?.labels).toEqual(['工作']);
    expect(setters.setMessages).toHaveBeenCalledTimes(1);
    expect(setters.setThreadMessages).toHaveBeenCalledTimes(1);

    const applyMessages = setters.setMessages.mock.calls[0][0];
    const applyThreadMessages = setters.setThreadMessages.mock.calls[0][0];
    const fromMessages = applyMessages([summary(1), summary(2)]);
    const fromThreads = applyThreadMessages([summary(1, { labels: ['旧标签'] })]);

    expect(fromMessages[0].labels).toEqual(['工作']);
    expect(fromThreads[0].labels).toEqual(['工作']);
  });

  it('reloads the detail when the mailbox context changes even if the id is unchanged', async () => {
    const details: Record<number, () => Promise<Message>> = {
      1: () => Promise.resolve(message(1)),
    };
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_message_detail') return details[1]();
      return Promise.resolve([]);
    }) as never);
    const { result, rerender } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });
    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.id).toBe(1);
    });
    const detailCalls = () => mockInvoke.mock.calls.filter((call) => call[0] === 'get_message_detail');
    expect(detailCalls()).toHaveLength(1);

    rerender({ mailboxContextKey: '1|101|security|all|messages' });

    await waitFor(() => {
      expect(detailCalls()).toHaveLength(2);
    });
    expect(mockInvoke).toHaveBeenLastCalledWith('get_message_detail', { messageId: 1 });
    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.id).toBe(1);
    });
  });

  it('does not let an older slow request overwrite a newer selection', async () => {
    let resolveFirst!: (value: Message) => void;
    mockInvoke.mockImplementation(((command: string, args?: { messageId?: number }) => {
      if (command === 'get_message_detail') {
        if (args?.messageId === 1) {
          return new Promise<Message>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(message(2));
      }
      return Promise.resolve([]);
    }) as never);
    const { result } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });
    act(() => {
      result.current.setSelectedId(2);
    });

    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.id).toBe(2);
    });

    act(() => {
      resolveFirst(message(1));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.readerSelectedDetail?.id).toBe(2);
  });

  it('hides the previous detail while a new selection loads so reader actions cannot target another message', async () => {
    let resolveDetail2!: (value: Message) => void;
    mockInvoke.mockImplementation(((command: string, args?: { messageId?: number }) => {
      if (command === 'get_message_detail') {
        if (args?.messageId === 1) {
          return Promise.resolve(message(1));
        }
        return new Promise<Message>((resolve) => {
          resolveDetail2 = resolve;
        });
      }
      return Promise.resolve([]);
    }) as never);
    const { result } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });
    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.id).toBe(1);
    });

    act(() => {
      result.current.setSelectedId(2);
    });
    expect(result.current.readerSelectedDetail).toBeNull();
    expect(result.current.readerDisplayedId).toBeNull();
    expect(result.current.detailLoadState).toEqual({ status: 'loading', messageId: 2 });

    act(() => {
      resolveDetail2(message(2));
    });
    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.id).toBe(2);
    });
    expect(result.current.readerDisplayedId).toBe(2);
  });

  it('clears the detail state and pending work when selection is cleared', async () => {
    let resolveDetail!: (value: Message) => void;
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_message_detail') {
        return new Promise<Message>((resolve) => {
          resolveDetail = resolve;
        });
      }
      return Promise.resolve([]);
    }) as never);
    const { result } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_message_detail', { messageId: 1 });
    });

    act(() => {
      result.current.setSelectedId(null);
    });
    expect(result.current.selectedDetail).toBeNull();
    expect(result.current.readerSelectedDetail).toBeNull();

    act(() => {
      resolveDetail(message(1));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.selectedDetail).toBeNull();
  });

  it('marks an unread message as read and respects manual unread suppression', async () => {
    let resolveRead!: (value: unknown) => void;
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'set_message_read') {
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      }
      return Promise.resolve([]);
    }) as never);
    const { result, setters } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });

    const unread = summary(1);
    act(() => {
      result.current.markMessageReadAfterReading(unread);
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_message_read', { messageId: 1, isRead: true });
    });

    // 并发去重：请求仍在途时重复触发不应再次发起
    mockInvoke.mockClear();
    act(() => {
      result.current.markMessageReadAfterReading(unread);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockInvoke).not.toHaveBeenCalledWith('set_message_read', { messageId: 1, isRead: true });

    act(() => {
      resolveRead({ message: '本地已标为已读' });
    });
    await waitFor(() => {
      expect(setters.setMessages).toHaveBeenCalled();
    });
    const applied = setters.setMessages.mock.calls[0][0]([unread]);
    expect(applied[0].is_read).toBe(true);

    // 手动标为未读的消息不应被自动标记已读
    act(() => {
      result.current.rememberManualReadState([1], false);
    });
    mockInvoke.mockClear();
    act(() => {
      result.current.markMessageReadAfterReading(unread);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockInvoke).not.toHaveBeenCalledWith('set_message_read', { messageId: 1, isRead: true });
  });

  it('loads attachments for the selected message and clears them on switch', async () => {
    const attachment: Attachment = {
      id: 1,
      message_id: 1,
      filename: 'note.txt',
      mime_type: 'text/plain',
      size_bytes: 10,
      is_downloaded: false,
      local_path: '/tmp/note.txt',
      content_id: '',
      is_inline: false,
    };
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_message_detail') return Promise.resolve(message(1));
      if (command === 'list_attachments') return Promise.resolve([attachment]);
      return Promise.resolve([]);
    }) as never);
    const { result, setters } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });
    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.id).toBe(1);
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('list_attachments', { messageId: 1 });
    });
    await waitFor(() => {
      expect(setters.setAttachments).toHaveBeenCalledWith([attachment]);
    });

    act(() => {
      result.current.setSelectedId(null);
    });
    await waitFor(() => {
      expect(setters.setAttachments).toHaveBeenCalledWith([]);
    });
  });

  it('keeps detail cleared when loading fails or returns no value', async () => {
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_message_detail') {
        return Promise.reject(new Error('detail unavailable'));
      }
      return Promise.resolve([]);
    }) as never);
    const { result } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_message_detail', { messageId: 1 });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.selectedDetail).toBeNull();
    expect(result.current.readerSelectedDetail).toBeNull();
  });

  it('fetches the remote body when message detail has no cached body content', async () => {
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_message_detail') {
        return Promise.resolve(message(1, {
          body: '',
          sanitized_html: '',
          snippet: 'Server-side preview only',
          remote_uid: 123,
        }));
      }
      if (command === 'fetch_message_body') {
        return Promise.resolve(message(1, {
          body: 'Fetched remote body',
          sanitized_html: '',
          snippet: 'Server-side preview only',
          remote_uid: 123,
        }));
      }
      return Promise.resolve([]);
    }) as never);
    const { result, setters } = renderController();

    act(() => {
      result.current.setSelectedId(1);
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_message_detail', { messageId: 1 });
    });
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('fetch_message_body', { messageId: 1 });
    });
    await waitFor(() => {
      expect(result.current.readerSelectedDetail?.body).toBe('Fetched remote body');
    });
    expect(setters.setMessages).toHaveBeenCalled();
  });

  it('exposes a reactive inline error when automatic body loading fails', async () => {
    mockInvoke.mockImplementation(((command: string) => {
      if (command === 'get_message_detail') {
        return Promise.resolve(message(1, {
          body: '',
          sanitized_html: '',
          remote_uid: 123,
        }));
      }
      if (command === 'fetch_message_body') {
        return Promise.reject(new Error('network unavailable'));
      }
      return Promise.resolve([]);
    }) as never);
    const { result } = renderController();

    act(() => result.current.setSelectedId(1));

    await waitFor(() => {
      expect(result.current.bodyFetchState?.status).toBe('error');
    });
    expect(result.current.bodyFetchState?.messageId).toBe(1);
    expect(result.current.bodyFetchState?.error).toBe('network unavailable');

    act(() => result.current.markBodyFetchStarted(1));
    expect(result.current.bodyFetchState?.status).toBe('loading');
    act(() => result.current.markBodyFetchSucceeded(1));
    expect(result.current.bodyFetchState).toBeNull();
  });

  it('finishes a pending body when returning to its message before the fetch completes', async () => {
    let resolveBody!: (value: Message) => void;
    const pendingBody = new Promise<Message>((resolve) => { resolveBody = resolve; });
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'get_message_detail') {
        const id = (args as { messageId: number }).messageId;
        return id === 1 ? message(1, { body: '', sanitized_html: '' }) : message(id);
      }
      if (command === 'fetch_message_body') return pendingBody;
      return [];
    });
    const { result } = renderController();
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('fetch_message_body', { messageId: 1 }));
    act(() => result.current.setSelectedId(2));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(2));
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(1));
    await act(async () => { resolveBody(message(1, { body: 'Fetched once', sanitized_html: '' })); });
    await waitFor(() => expect(result.current.readerSelectedDetail?.body).toBe('Fetched once'));
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'fetch_message_body')).toHaveLength(1);
  });

  it('caches background body completion without leaving a loading state on return', async () => {
    let resolveBody!: (value: Message) => void;
    const pendingBody = new Promise<Message>((resolve) => { resolveBody = resolve; });
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'get_message_detail') {
        const id = (args as { messageId: number }).messageId;
        return id === 1 ? message(1, { body: '', sanitized_html: '' }) : message(id);
      }
      if (command === 'fetch_message_body') return pendingBody;
      return [];
    });
    const { result } = renderController();
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('fetch_message_body', { messageId: 1 }));
    act(() => result.current.setSelectedId(2));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(2));
    await act(async () => { resolveBody(message(1, { body: 'Cached in background' })); });
    expect(result.current.readerSelectedDetail?.id).toBe(2);
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(result.current.readerSelectedDetail?.body).toBe('Cached in background'));
    expect(result.current.bodyFetchState).toBeNull();
  });

  it('keeps the current body loading state when a different message fails, and restores that error on return', async () => {
    let rejectFirst!: (error: Error) => void;
    const firstBody = new Promise<Message>((_, reject) => { rejectFirst = reject; });
    const secondBody = new Promise<Message>(() => undefined);
    mockInvoke.mockImplementation(async (command, args) => {
      const id = (args as { messageId: number }).messageId;
      if (command === 'get_message_detail') return message(id, { body: '', sanitized_html: '' });
      if (command === 'fetch_message_body') return id === 1 ? firstBody : secondBody;
      return [];
    });
    const { result, setters } = renderController();
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('fetch_message_body', { messageId: 1 }));
    act(() => result.current.setSelectedId(2));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('fetch_message_body', { messageId: 2 }));
    setters.setStatus.mockClear();
    await act(async () => { rejectFirst(new Error('First message offline')); });
    expect(result.current.bodyFetchState).toEqual({ messageId: 2, status: 'loading', error: null });
    expect(setters.setStatus).not.toHaveBeenCalled();
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(result.current.bodyFetchState).toEqual({ messageId: 1, status: 'error', error: 'First message offline', errorKind: 'network' }));
  });

  it('preserves a successfully fetched body when refreshing its attachments fails', async () => {
    let attachmentCalls = 0;
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'get_message_detail') return message(1, { body: '', sanitized_html: '' });
      if (command === 'fetch_message_body') return message(1, { body: 'Readable body', sanitized_html: '' });
      if (command === 'list_attachments' && ++attachmentCalls > 1) throw new Error('Attachment database unavailable');
      return [];
    });
    const { result, setters } = renderController();
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(setters.setStatus).toHaveBeenCalledWith('正文已加载，但附件列表刷新失败：Attachment database unavailable'));
    expect(result.current.readerSelectedDetail?.body).toBe('Readable body');
    expect(result.current.bodyFetchState).toBeNull();
    expect(result.current.bodyFetchFailedRef.current.has(1)).toBe(false);
    expect(result.current.attachmentsLoaded).toBe(true);
  });

  it.each([false, true])('restores trusted remote content on return (request already finished: %s)', async (finishBeforeReturn) => {
    let resolveRender!: (value: Message) => void;
    const pendingRender = new Promise<Message>((resolve) => { resolveRender = resolve; });
    const source = message(1, {
      body: '<p>Body</p><img src="https://example.com/picture.png">',
      sanitized_html: '<p>Body</p>',
    });
    const rendered = { ...source, sanitized_html: source.body };
    let policyCalls = 0;
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'get_message_detail') return (args as { messageId: number }).messageId === 1 ? source : message(2);
      if (command === 'render_message_with_remote_image_policy') return ++policyCalls === 1 ? pendingRender : rendered;
      return [];
    });
    const { result } = renderController({ remoteImageTrusts: [{
      id: 1, account_id: 1, account_email: source.account_email,
      scope: 'sender', value: source.sender_email, created_at: '',
    }] });
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(policyCalls).toBe(1));
    act(() => result.current.setSelectedId(2));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(2));
    if (finishBeforeReturn) await act(async () => { resolveRender(rendered); });
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(1));
    if (!finishBeforeReturn) await act(async () => { resolveRender(rendered); });
    await waitFor(() => expect(result.current.readerSelectedDetail?.sanitized_html).toBe(source.body));
    expect(policyCalls).toBe(finishBeforeReturn ? 2 : 1);
  });

  it('does not display or cache remote HTML from a request whose trust was revoked', async () => {
    let resolveRender!: (value: Message) => void;
    const pendingRender = new Promise<Message>((resolve) => { resolveRender = resolve; });
    const source = message(1, {
      body: '<p>Body</p><img src="https://example.com/picture.png">', sanitized_html: '<p>Body</p>',
    });
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'get_message_detail') return (args as { messageId: number }).messageId === 1 ? source : message(2);
      if (command === 'render_message_with_remote_image_policy') return pendingRender;
      return [];
    });
    const { result, rerender } = renderController({ remoteImageTrusts: [{
      id: 1, account_id: 1, account_email: source.account_email,
      scope: 'sender', value: source.sender_email, created_at: '',
    }] });
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('render_message_with_remote_image_policy', { messageId: 1 }));
    rerender({ mailboxContextKey: '1|101||all|messages', remoteImageTrusts: [] });
    await act(async () => { resolveRender({ ...source, sanitized_html: source.body }); });
    expect(result.current.readerSelectedDetail?.sanitized_html).toBe('<p>Body</p>');
    act(() => result.current.setSelectedId(2));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(2));
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(1));
    expect(result.current.readerSelectedDetail?.sanitized_html).toBe('<p>Body</p>');
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'render_message_with_remote_image_policy')).toHaveLength(1);
  });
});

describe('message detail failures', () => {
  beforeEach(() => { mockInvoke.mockReset(); localStorage.clear(); });
  it('exposes a retryable error without showing the previously selected message', async () => {
    let failSecond = true;
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'get_message_detail') {
        const id = (args as { messageId: number }).messageId;
        if (id === 2 && failSecond) throw new Error('database unavailable');
        return message(id);
      }
      return [];
    });
    const { result } = renderController();
    act(() => result.current.setSelectedId(1));
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(1));
    act(() => result.current.setSelectedId(2));
    await waitFor(() => expect(result.current.detailLoadState).toEqual({
      status: 'error', messageId: 2, error: 'database unavailable',
    }));
    expect(result.current.readerSelectedDetail).toBeNull();
    expect(result.current.selected?.id).toBe(2);
    failSecond = false;
    act(() => result.current.retrySelectedDetail());
    expect(result.current.detailLoadState).toEqual({ status: 'loading', messageId: 2 });
    await waitFor(() => expect(result.current.readerSelectedDetail?.id).toBe(2));
    expect(result.current.detailLoadState).toEqual({ status: 'idle' });
  });
});

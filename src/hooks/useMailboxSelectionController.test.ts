import { describe, expect, it, vi, beforeEach } from 'vitest';
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
  const hook = renderHook(
    (props: { mailboxContextKey: string }) => useMailboxSelectionController({
      messages,
      threadMessages,
      threads,
      activeThread,
      folders,
      stats,
      mailboxContextKey: props.mailboxContextKey,
      remoteImageTrusts,
      ...setters,
    }),
    { initialProps: { mailboxContextKey } },
  );
  return { ...hook, setters };
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
    expect(result.current.readerSelectedDetail).toBeNull();
    expect(result.current.selectedDetail).toBeNull();

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

  it('keeps the detail cleared when loading fails or returns no value', async () => {
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
});

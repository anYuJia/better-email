import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useNewMailNotifier from './useNewMailNotifier';
import { defaultNotificationPolicy } from '../mailUtils';
import type { MessageSummary, SyncRun } from '../app/types';

const sendNotification = vi.fn();
const isPermissionGranted = vi.fn(async () => true);
const requestPermission = vi.fn(async () => 'granted' as const);
const invoke = vi.fn();

vi.mock('../tauriBridge', () => ({
  isPermissionGranted: () => isPermissionGranted(),
  requestPermission: () => requestPermission(),
  sendNotification: (payload: { title: string; body: string }) => sendNotification(payload),
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));

function newMessage(id: number, subject: string, accountId = 1): MessageSummary {
  return {
    id,
    account_id: accountId,
    account_email: `a${accountId}@example.com`,
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: `Sender ${id}`,
    sender_email: `s${id}@example.com`,
    recipients: 'me@example.com',
    subject,
    snippet: '',
    cc: '',
    bcc: '',
    security_warnings: [],
    received_at: '2026-01-01T00:00:00Z',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    remote_mailbox: 'INBOX',
    remote_uid: id,
    message_id_header: '',
    in_reply_to_header: '',
    references_header: '',
    labels: [],
    attachment_count: 0,
  } as MessageSummary;
}

function run(overrides: Partial<SyncRun> = {}): SyncRun {
  return {
    id: 1,
    started_at: '',
    finished_at: '',
    status: 'imap_headers_account',
    scanned_folders: 1,
    imported_messages: 2,
    new_messages: 2,
    new_message_ids: [100, 101],
    message: '',
    ...overrides,
  };
}

function renderNotifier({
  getCurrentMessages = () => [] as MessageSummary[],
  notificationPolicy = defaultNotificationPolicy,
  setLastNewMailNotice = vi.fn(),
  setNotificationStatus = vi.fn(),
}: {
  getCurrentMessages?: () => MessageSummary[];
  notificationPolicy?: typeof defaultNotificationPolicy;
  setLastNewMailNotice?: ReturnType<typeof vi.fn>;
  setNotificationStatus?: ReturnType<typeof vi.fn>;
} = {}) {
  return renderHook(() => useNewMailNotifier({
    notificationPolicy,
    getCurrentMessages,
    setLastNewMailNotice,
    setNotificationStatus,
  }));
}

describe('useNewMailNotifier', () => {
  beforeEach(() => {
    sendNotification.mockReset();
    isPermissionGranted.mockReset().mockResolvedValue(true);
    invoke.mockReset();
  });

  it('notifies based on the actual new messages, not the current visible list', async () => {
    // 用户当前在归档视图，可见列表是旧邮件；本次真正新增的是 100。
    const getCurrentMessages = () => [
      newMessage(1, '旧的归档邮件'),
      newMessage(2, '另一个旧邮件'),
    ];
    invoke.mockImplementation((command: string) => {
      if (command === 'list_messages_by_ids') {
        return Promise.resolve([newMessage(100, '本次新邮件')]);
      }
      if (command === 'list_muted_thread_keys') return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected ${command}`));
    });
    const { result } = renderNotifier({ getCurrentMessages });
    const syncRun = run({ new_messages: 1, imported_messages: 1, new_message_ids: [100] });

    await act(async () => {
      await result.current.notifyNewMail(syncRun);
    });

    expect(invoke).toHaveBeenCalledWith('list_messages_by_ids', { messageIds: [100] });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const body = sendNotification.mock.calls[0][0].body as string;
    expect(body).toContain('本次新邮件');
    expect(body).not.toContain('旧的归档邮件');
  });

  it('does not notify for history backfill with no new messages', async () => {
    const { result } = renderNotifier();
    await act(async () => {
      await result.current.notifyNewMail(run({ new_messages: 0, new_message_ids: [], imported_messages: 5 }));
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('degrades visibly when the muted-thread query fails for one account', async () => {
    const setNotificationStatus = vi.fn();
    invoke.mockImplementation((command: string) => {
      if (command === 'list_messages_by_ids') {
        return Promise.resolve([newMessage(100, '新邮件')]);
      }
      if (command === 'list_muted_thread_keys') {
        return Promise.reject(new Error('db locked'));
      }
      return Promise.reject(new Error(`unexpected ${command}`));
    });
    const { result } = renderNotifier({ setNotificationStatus });

    await act(async () => {
      await result.current.notifyNewMail(run());
    });
    // 静音查询失败不产生未处理 rejection，且提示可见降级状态。
    expect(setNotificationStatus).toHaveBeenCalledWith('静音会话查询失败，已按未静音处理');
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('falls back to the visible list when new_message_ids is unavailable', async () => {
    invoke.mockImplementation((command: string) => {
      if (command === 'list_muted_thread_keys') return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected ${command}`));
    });
    const getCurrentMessages = () => [newMessage(7, '可见列表新邮件')];
    const { result } = renderNotifier({ getCurrentMessages });

    await act(async () => {
      await result.current.notifyNewMail(run({ new_message_ids: [] }));
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0].body).toContain('可见列表新邮件');
  });
});

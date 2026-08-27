import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useComposerController from './useComposerController';
import type { Message, OutboxItem } from '../app/types';

vi.mock('../tauriBridge', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: async () => () => undefined,
  }),
  invoke: vi.fn(),
}));

import { invoke } from '../tauriBridge';
import {
  composerAutosaveStorageKey,
  emptyDraft,
  type SendUndoDelaySeconds,
} from '../app/appConfig';

const mockInvoke = vi.mocked(invoke);

function renderComposer(sendUndoDelaySeconds: SendUndoDelaySeconds = 5) {
  const setOutbox = vi.fn();
  const setPendingSendUndo = vi.fn();
  const setSelectedId = vi.fn();
  const setStatus = vi.fn();
  const showToast = vi.fn();
  const refreshAll = vi.fn().mockResolvedValue(undefined);
  const loadMeta = vi.fn().mockResolvedValue({ folderId: 101, folders: [] });
  const focusMailboxRole = vi.fn().mockResolvedValue(undefined);

  const hook = renderHook(() => useComposerController({
    account: null,
    accounts: [],
    identities: [],
    selectedId: null,
    pendingSendUndo: null,
    sendUndoDelaySeconds,
    setOutbox,
    setPendingSendUndo,
    setSelectedId,
    setStatus,
    showToast,
    loadMeta,
    refreshAll,
    focusMailboxRole,
  }));

  return {
    ...hook,
    mocks: {
      setOutbox,
      setPendingSendUndo,
      setSelectedId,
      setStatus,
      showToast,
      refreshAll,
      loadMeta,
      focusMailboxRole,
    },
  };
}

describe('useComposerController close lifecycle', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    localStorage.clear();
  });

  it('saving a draft closes the composer without the unsaved-changes confirmation', async () => {
    const { result, mocks } = renderComposer();
    mockInvoke.mockResolvedValueOnce({ message: '草稿已保存', draft_id: 7 });
    mocks.refreshAll.mockImplementationOnce(async () => {
      mocks.setStatus('已刷新本地邮箱数据');
    });

    act(() => {
      result.current.setDraft({ ...result.current.draft, to: 'a@example.com', subject: 'Hi', body: 'Body' });
      result.current.setComposerOpen(true);
      result.current.openComposer();
    });
    await act(async () => {
      await result.current.saveDraft();
    });

    expect(mockInvoke).toHaveBeenCalledWith('save_draft', expect.anything());
    expect(result.current.isComposerOpen).toBe(false);
    expect(result.current.composerCloseConfirmOpen).toBe(false);
    expect(mocks.setStatus).toHaveBeenCalledWith('正在保存草稿…');
    expect(mocks.setStatus).toHaveBeenCalledWith('草稿已保存');
    expect(mocks.setStatus).toHaveBeenLastCalledWith('草稿已保存');
  });

  it('keeps the composer content open when saving a draft fails', async () => {
    const { result, mocks } = renderComposer();
    const failedDraft = {
      ...result.current.draft,
      to: 'a@example.com',
      subject: '不能丢失',
      body: '保留的正文',
    };
    mockInvoke.mockRejectedValueOnce(new Error('草稿服务暂时不可用'));

    act(() => {
      result.current.setDraft(failedDraft);
      result.current.setComposerOpen(true);
    });
    await expect(act(async () => {
      await result.current.saveDraft();
    })).rejects.toThrow('草稿服务暂时不可用');

    expect(result.current.isComposerOpen).toBe(true);
    expect(result.current.draft).toEqual(failedDraft);
    expect(mocks.setStatus).toHaveBeenLastCalledWith(
      '保存失败，邮件内容已保留：草稿服务暂时不可用',
    );
  });

  it('queuing a draft closes the composer without the unsaved-changes confirmation', async () => {
    const { result, mocks } = renderComposer();
    mockInvoke.mockResolvedValueOnce({
      id: 1,
      message_id: 0,
      recipients: 'a@example.com',
      subject: 'Queued',
      status: 'queued',
      attempts: 0,
      last_error: '',
      queued_at: '',
      next_attempt_at: '',
    } as OutboxItem);

    act(() => {
      result.current.setDraft({ ...result.current.draft, to: 'a@example.com', subject: 'Queued', body: 'Body' });
      result.current.openComposer();
    });
    await act(async () => {
      await result.current.queueDraft();
    });

    expect(result.current.isComposerOpen).toBe(false);
    expect(result.current.composerCloseConfirmOpen).toBe(false);
    expect(mocks.focusMailboxRole).toHaveBeenCalledWith(
      'outbox',
      null,
      '邮件已加入发件箱队列',
    );
  });

  it('sending with the undo delay closes the composer and keeps the current mailbox context', async () => {
    const { result, mocks } = renderComposer();
    mockInvoke.mockResolvedValueOnce({
      id: 1,
      message_id: 0,
      recipients: 'a@example.com',
      subject: 'Sent',
      status: 'queued',
      attempts: 0,
      last_error: '',
      queued_at: new Date(Date.now() + 5000).toISOString(),
      next_attempt_at: '',
    } as OutboxItem);

    act(() => {
      result.current.setDraft({ ...result.current.draft, to: 'a@example.com', subject: 'Sent', body: 'Body' });
      result.current.openComposer();
    });
    await act(async () => {
      await result.current.sendDraft();
    });

    expect(result.current.isComposerOpen).toBe(false);
    expect(result.current.composerCloseConfirmOpen).toBe(false);
    expect(mocks.focusMailboxRole).not.toHaveBeenCalled();
    expect(mocks.setStatus).toHaveBeenLastCalledWith('邮件将在 5 秒后发送，可立即撤回');
  });

  it('keeps the current mailbox context after a successful direct send', async () => {
    const { result, mocks } = renderComposer(0);
    mockInvoke
      .mockResolvedValueOnce({ id: 91, status: 'queued', progress: 0, message: '等待发送' })
      .mockResolvedValueOnce({ id: 91, status: 'running', progress: 0, message: '发送中' })
      .mockResolvedValueOnce(42)
      .mockResolvedValueOnce({ id: 91, status: 'success', progress: 100, message: '发送完成' });

    act(() => {
      result.current.setDraft({ ...result.current.draft, to: 'a@example.com', subject: '直接发送', body: '正文' });
      result.current.openComposer();
    });
    await act(async () => {
      await result.current.sendDraft();
    });

    expect(result.current.isComposerOpen).toBe(false);
    expect(result.current.draft).toEqual(emptyDraft);
    expect(mocks.focusMailboxRole).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith('邮件已发送');
    expect(mockInvoke).toHaveBeenCalledWith('complete_background_task', {
      taskId: 91,
      message: '发送完成',
    });
  });

  it('keeps the composer and its content open after a direct send failure', async () => {
    const { result, mocks } = renderComposer(0);
    mockInvoke
      .mockResolvedValueOnce({ id: 92, status: 'queued', progress: 0, message: '等待发送' })
      .mockResolvedValueOnce({ id: 92, status: 'running', progress: 0, message: '发送中' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 92, status: 'failed', progress: 0, message: 'offline' });
    const failedDraft = {
      ...result.current.draft,
      to: 'a@example.com',
      subject: '不能丢失',
      body: '保留的正文',
    };

    act(() => {
      result.current.setDraft(failedDraft);
      result.current.openComposer();
    });
    await act(async () => {
      await result.current.sendDraft();
    });

    expect(result.current.isComposerOpen).toBe(true);
    expect(result.current.draft).toEqual(failedDraft);
    expect(result.current.composerCloseConfirmOpen).toBe(false);
    expect(mocks.focusMailboxRole).not.toHaveBeenCalled();
    expect(mocks.setStatus).toHaveBeenLastCalledWith(expect.stringContaining('邮件内容已保留'));
  });

  it('manually closing a composer with a non-empty draft asks for confirmation', () => {
    const { result } = renderComposer();

    act(() => {
      result.current.setDraft({ ...result.current.draft, to: 'a@example.com' });
      result.current.setComposerOpen(true);
    });
    act(() => {
      result.current.closeComposer();
    });

    expect(result.current.isComposerOpen).toBe(true);
    expect(result.current.composerCloseConfirmOpen).toBe(true);
  });

  it('manually closing an empty composer closes it directly', () => {
    const { result } = renderComposer();

    act(() => {
      result.current.setComposerOpen(true);
      result.current.closeComposer();
    });

    expect(result.current.isComposerOpen).toBe(false);
    expect(result.current.composerCloseConfirmOpen).toBe(false);
  });

  it('describes local autosave recovery as a recovery point instead of a mailbox draft', () => {
    localStorage.setItem(composerAutosaveStorageKey, JSON.stringify({
      draft: { ...emptyDraft, subject: '恢复内容', body: '恢复正文' },
      isRichComposer: true,
      saved_at: '2026-08-23T12:00:00.000Z',
    }));
    const { result, mocks } = renderComposer();

    act(() => result.current.openComposer(undefined, { restoreAutosave: true }));

    expect(result.current.draft.subject).toBe('恢复内容');
    expect(mocks.setStatus).toHaveBeenCalledWith(expect.stringMatching(/^已从恢复点还原邮件：/));
  });

  it('reuses the open composer and requests focus instead of replacing its draft', () => {
    const { result } = renderComposer();
    const existingDraft = {
      ...result.current.draft,
      subject: '继续编辑',
      body: '保留这份正文',
    };

    act(() => {
      result.current.setDraft(existingDraft);
      result.current.setComposerOpen(true);
    });
    act(() => result.current.setComposerMinimized(true));
    const focusRequestBefore = result.current.composerFocusRequest;

    act(() => result.current.openComposer(emptyDraft));

    expect(result.current.isComposerOpen).toBe(true);
    expect(result.current.isComposerMinimized).toBe(false);
    expect(result.current.draft).toEqual(existingDraft);
    expect(result.current.composerFocusRequest).toBe(focusRequestBefore + 1);
  });

  it('forwards a quick reply into the full composer while retaining the background draft', async () => {
    const { result } = renderComposer();
    const sourceMessage = {
      id: 7,
      account_id: 1,
      account_email: 'me@example.com',
      folder_id: 10,
      folder_role: 'inbox',
      sender_name: 'Ada',
      sender_email: 'ada@example.com',
      recipients: 'me@example.com',
      cc: '',
      bcc: '',
      subject: 'Roadmap',
      snippet: 'Original',
      body: 'Original body',
      sanitized_html: '',
      security_warnings: [],
      received_at: '2026-08-23T12:00:00.000Z',
      is_read: true,
      is_starred: false,
      has_attachments: false,
      snoozed_until: '',
      labels: [],
      attachment_count: 0,
      remote_mailbox: 'INBOX',
      remote_uid: 42,
    } satisfies Message;

    act(() => result.current.setQuickReplyBody('保留的快速回复'));
    await act(async () => {
      await result.current.composeFromMessage(sourceMessage, 'reply', '保留的快速回复');
    });

    expect(result.current.draft.body).toMatch(/^保留的快速回复\n\n/);
    expect(result.current.quickReplyBody).toBe('保留的快速回复');
    expect(result.current.isComposerOpen).toBe(true);
  });

  it('queues a quick reply without navigating to a missing outbox folder', async () => {
    const { result, mocks } = renderComposer();
    const sourceMessage = {
      id: 8,
      account_id: 1,
      account_email: 'me@example.com',
      folder_id: 10,
      folder_role: 'inbox',
      sender_name: 'Ada',
      sender_email: 'ada@example.com',
      recipients: 'me@example.com',
      cc: '',
      bcc: '',
      subject: 'Roadmap',
      snippet: 'Original',
      body: 'Original body',
      sanitized_html: '',
      security_warnings: [],
      received_at: '2026-08-23T12:00:00.000Z',
      is_read: true,
      is_starred: false,
      has_attachments: false,
      snoozed_until: '',
      labels: [],
      attachment_count: 0,
      remote_mailbox: 'INBOX',
      remote_uid: 43,
    } satisfies Message;
    mockInvoke.mockResolvedValueOnce({
      id: 12,
      message_id: 0,
      recipients: sourceMessage.sender_email,
      subject: 'Re: Roadmap',
      status: 'queued',
      attempts: 0,
      last_error: '',
      queued_at: '2026-08-23T12:00:00.000Z',
      next_attempt_at: '',
    } as OutboxItem);
    act(() => result.current.setQuickReplyBody('准备发送'));

    await act(async () => {
      await result.current.sendQuickReply(sourceMessage);
    });

    expect(result.current.quickReplyBody).toBe('');
    expect(mocks.focusMailboxRole).not.toHaveBeenCalled();
    expect(mocks.setSelectedId).not.toHaveBeenCalled();
    expect(mocks.setStatus).toHaveBeenLastCalledWith('快速回复将在 5 秒后发送，可立即撤回');
    expect(mocks.setPendingSendUndo).toHaveBeenCalledWith(expect.objectContaining({ outboxId: 12 }));
  });

  it('keeps the quick reply editable when queue creation fails', async () => {
    const { result, mocks } = renderComposer();
    const sourceMessage = {
      id: 9,
      account_id: 1,
      sender_name: 'Ada',
      sender_email: 'ada@example.com',
      subject: 'Roadmap',
      body: 'Original body',
    } as Message;
    mockInvoke.mockRejectedValueOnce(new Error('offline'));
    act(() => result.current.setQuickReplyBody('不能丢失'));

    await act(async () => {
      await result.current.sendQuickReply(sourceMessage);
    });

    expect(result.current.quickReplyBody).toBe('不能丢失');
    expect(mocks.focusMailboxRole).not.toHaveBeenCalled();
    expect(mocks.setStatus).toHaveBeenLastCalledWith(expect.stringContaining('快速回复排队失败'));
  });
});

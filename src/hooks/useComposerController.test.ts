import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useComposerController from './useComposerController';
import type { Message, MessageSummary, OutboxItem } from '../app/types';

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderComposer(sendUndoDelaySeconds: SendUndoDelaySeconds = 5, selectedId: number | null = null) {
  const setOutbox = vi.fn();
  const setPendingSendUndo = vi.fn();
  const setSelectedId = vi.fn();
  const setStatus = vi.fn();
  const showToast = vi.fn();
  const refreshAll = vi.fn().mockResolvedValue(undefined);
  const refreshContacts = vi.fn().mockResolvedValue([]);
  const loadMeta = vi.fn().mockResolvedValue({ folderId: 101, folders: [] });
  const focusMailboxRole = vi.fn().mockResolvedValue(undefined);

  const hook = renderHook((selection) => useComposerController({
    account: null,
    accounts: [],
    identities: [],
    selectedId: selection.selectedId,
    quickReplyAccountId: selection.accountId,
    pendingSendUndo: null,
    sendUndoDelaySeconds,
    setOutbox,
    setPendingSendUndo,
    setSelectedId,
    setStatus,
    showToast,
    loadMeta,
    refreshAll,
    refreshContacts,
    focusMailboxRole,
  }), { initialProps: { selectedId, accountId: 1 } });

  return {
    ...hook,
    mocks: {
      setOutbox,
      setPendingSendUndo,
      setSelectedId,
      setStatus,
      showToast,
      refreshAll,
      refreshContacts,
      loadMeta,
      focusMailboxRole,
    },
  };
}

describe('asynchronous composer opening ownership', () => {
  const summary = { id: 1, account_id: 1, subject: 'Earlier reply' } as MessageSummary;
  const fullMessage = {
    ...summary, sender_email: 'sender@example.com', sender_name: 'Sender',
    recipients: 'me@example.com', received_at: '2026-10-29T00:00:00Z',
    body: 'Original body', sanitized_html: '', has_attachments: false,
  } as Message;

  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command) => (
      command === 'load_composer_recovery' ? { revision: 0, payload: null } : true
    ));
  });

  it.each(['reply', 'replyAll'] as const)('inherits the current message quick reply for an implicit %s', async (mode) => {
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('当前邮件的快速回复'));
    await act(async () => { await result.current.composeFromMessage(fullMessage, mode); });
    expect(result.current.draft.body).toMatch(/^当前邮件的快速回复\n\n/);
    expect(result.current.quickReplyBody).toBe('当前邮件的快速回复');
  });

  it.each([
    { id: 2, account_id: 1 },
    { id: 1, account_id: 2 },
  ])('does not inherit another message/account reply ($account_id:$id)', async (identity) => {
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('仅属于当前邮件的快速回复'));
    await act(async () => { await result.current.composeFromMessage({ ...fullMessage, ...identity }, 'reply'); });
    expect(result.current.draft.body).not.toContain('仅属于当前邮件的快速回复');
    expect(result.current.quickReplyBody).toBe('仅属于当前邮件的快速回复');
  });

  it('routes an implicit current reply to the reader but other identities and reply modes to full compose', async () => {
    const { result } = renderComposer(5, 1);
    const focus = vi.fn();
    result.current.readerReplyRef.current = { key: '1:1', focus };
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply'); });
    expect(focus).toHaveBeenCalledOnce();
    expect(result.current.isComposerOpen).toBe(false);
    for (const message of [{ ...fullMessage, id: 2 }, { ...fullMessage, account_id: 2 }]) {
      await act(async () => { await result.current.composeFromMessage(message, 'reply'); });
      expect(result.current.isComposerOpen).toBe(true);
    }
    for (const mode of ['replyAll', 'forward'] as const) {
      await act(async () => { await result.current.composeFromMessage(fullMessage, mode); });
      expect(result.current.isComposerOpen).toBe(true);
    }
    expect(focus).toHaveBeenCalledOnce();
  });

  it('resumes the same expanded reply after minimize/close without replacing later full-editor changes', async () => {
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('inline 原文'));
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply', 'inline 原文'); });
    const source = result.current.draft.quick_reply_source;
    expect(source).toMatchObject({ key: '1:1', body: 'inline 原文', mode: 'reply' });
    act(() => {
      result.current.setDraft((draft) => ({ ...draft, body: '完整窗口新增的重要正文' }));
      result.current.setComposerMinimized(true);
    });
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply'); });
    expect(result.current.isComposerMinimized).toBe(false);
    expect(result.current.draft.body).toBe('完整窗口新增的重要正文');
    act(() => result.current.forceCloseComposer());
    expect(result.current.quickReplyBody).toBe('inline 原文');
    act(() => result.current.setQuickReplyBody('关闭后新的 inline 编辑'));
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply', '关闭后新的 inline 编辑'); });
    expect(result.current.draft.body).toBe('完整窗口新增的重要正文');
    expect(result.current.draft.quick_reply_source).toEqual(source);
    expect(result.current.quickReplyBody).toBe('关闭后新的 inline 编辑');
  });

  it.each(['sendDraft', 'queueDraft'] as const)('consumes only the transferred source after successful %s', async (action) => {
    const { result, rerender } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('原稿 A'));
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply', '原稿 A'); });
    const queue = deferred<OutboxItem>();
    mockInvoke.mockImplementation(async (command) => command === 'queue_outbox_message' ? queue.promise : true);
    let pending!: Promise<unknown>;
    await act(async () => { pending = result.current[action](); });
    rerender({ selectedId: 1, accountId: 2 });
    act(() => result.current.setQuickReplyBody('另一个账号相同 id 的原稿 B'));
    await act(async () => { queue.resolve({ id: 8, message_id: 9 } as OutboxItem); await pending; });
    expect(result.current.quickReplyBody).toBe('另一个账号相同 id 的原稿 B');
    rerender({ selectedId: 1, accountId: 1 });
    expect(result.current.quickReplyBody).toBe('');
    expect(result.current.draft).toEqual(emptyDraft);
  });

  it('preserves later inline and full draft edits when a delayed handoff submission succeeds', async () => {
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('提交的原稿'));
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply', '提交的原稿'); });
    const queue = deferred<OutboxItem>();
    mockInvoke.mockImplementation(async (command) => command === 'queue_outbox_message' ? queue.promise : true);
    let pending!: Promise<unknown>;
    await act(async () => { pending = result.current.sendDraft(); });
    act(() => {
      result.current.setQuickReplyBody('提交后新增的 inline 内容');
      result.current.setDraft((draft) => ({ ...draft, body: '提交后新增的完整正文' }));
    });
    await act(async () => { queue.resolve({ id: 8, message_id: 9 } as OutboxItem); await pending; });
    expect(result.current.quickReplyBody).toBe('提交后新增的 inline 内容');
    expect(result.current.draft.body).toBe('提交后新增的完整正文');
    expect(result.current.isComposerOpen).toBe(true);
  });

  it.each([false, true])('consumes the source only after SaveDraft confirms a durable id, preserving later edits (%s)', async (edited) => {
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('交接到草稿箱'));
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply', '交接到草稿箱'); });
    mockInvoke.mockImplementation(async (command) => command === 'save_draft' ? { message: '无编号' } : true);
    await act(async () => { await expect(result.current.saveDraft()).rejects.toThrow('草稿编号'); });
    expect(result.current.quickReplyBody).toBe('交接到草稿箱');
    expect(result.current.isComposerOpen).toBe(true);
    const save = deferred<{ draft_id: number; message: string }>();
    mockInvoke.mockImplementation(async (command) => command === 'save_draft' ? save.promise : true);
    let pending!: Promise<unknown>;
    await act(async () => { pending = result.current.saveDraft(); });
    expect(result.current.quickReplyBody).toBe('交接到草稿箱');
    if (edited) act(() => result.current.setQuickReplyBody('保存期间新增的 inline'));
    await act(async () => { save.resolve({ draft_id: 88, message: '草稿已保存' }); await pending; });
    expect(result.current.quickReplyBody).toBe(edited ? '保存期间新增的 inline' : '');
    expect(result.current.isComposerOpen).toBe(false);
  });

  it('retains both copies after failed submission and clears the matching source only on successful retry', async () => {
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('失败不得丢失'));
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply', '失败不得丢失'); });
    const original = result.current.draft;
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'queue_outbox_message') throw new Error('离线');
      return true;
    });
    await act(async () => { await expect(result.current.sendDraft()).rejects.toThrow('离线'); });
    expect(result.current.quickReplyBody).toBe('失败不得丢失');
    expect(result.current.draft).toEqual(original);
    mockInvoke.mockImplementation(async (command) => command === 'queue_outbox_message' ? { id: 8, message_id: 9 } : true);
    await act(async () => { await result.current.sendDraft(); });
    expect(result.current.quickReplyBody).toBe('');
  });

  it('does not bind explicit replacement content or forwards to an unrelated inline version', async () => {
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('现有 inline'));
    for (const prefill of ['', 'AI 生成的不同内容']) {
      await act(async () => { await result.current.composeFromMessage(fullMessage, 'reply', prefill); });
      expect(result.current.draft.quick_reply_source).toBeUndefined();
    }
    await act(async () => { await result.current.composeFromMessage(fullMessage, 'forward'); });
    expect(result.current.draft.quick_reply_source).toBeUndefined();
    expect(result.current.quickReplyBody).toBe('现有 inline');
  });

  it('includes edits made to the same quick reply while message details are loading', async () => {
    const detail = deferred<Message>();
    mockInvoke.mockImplementation(async (command) => (
      command === 'get_message_detail' ? detail.promise : { revision: 0, payload: null }
    ));
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('第一段'));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.composeFromMessage(summary, 'reply'); });
    act(() => result.current.setQuickReplyBody('第一段和后续编辑'));
    await act(async () => { detail.resolve(fullMessage); await pending; });
    expect(result.current.draft.body).toMatch(/^第一段和后续编辑\n\n/);
    expect(result.current.quickReplyBody).toBe('第一段和后续编辑');
  });

  it('keeps a newer reply when detail requests complete in reverse order', async () => {
    const older = deferred<Message>();
    mockInvoke.mockImplementation(async (command) => (
      command === 'get_message_detail' ? older.promise : { revision: 0, payload: null }
    ));
    const { result } = renderComposer();
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.composeFromMessage(summary, 'reply'); });
    await act(async () => {
      await result.current.composeFromMessage({ ...fullMessage, id: 2, subject: 'Latest reply' }, 'reply');
    });
    await act(async () => { older.resolve(fullMessage); await pending; });
    expect(result.current.draft.subject).toBe('Re: Latest reply');
    expect(result.current.composerContextAccountId).toBe(1);
  });

  it('does not replace new typed content with an older reply preparation', async () => {
    const older = deferred<Message>();
    mockInvoke.mockImplementation(async (command) => (
      command === 'get_message_detail' ? older.promise : { revision: 0, payload: null }
    ));
    const { result } = renderComposer();
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.composeFromMessage(summary, 'reply'); });
    act(() => {
      result.current.openComposer({ ...emptyDraft, body: 'My newer unsaved letter' });
      result.current.setDraft((current) => ({ ...current, body: `${current.body}\nMore edits` }));
    });
    await act(async () => { older.resolve(fullMessage); await pending; });
    expect(result.current.draft.body).toBe('My newer unsaved letter\nMore edits');
    expect(result.current.composerContextAccountId).toBeNull();
  });

  it('does not reopen after a newer close while draft attachments are loading', async () => {
    const attachments = deferred<never[]>();
    mockInvoke.mockImplementation(async (command) => (
      command === 'list_attachments' ? attachments.promise : { revision: 0, payload: null }
    ));
    const { result } = renderComposer();
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.editDraftMessage(fullMessage); });
    act(() => result.current.forceCloseComposer());
    await act(async () => { attachments.resolve([]); await pending; });
    expect(result.current.isComposerOpen).toBe(false);
    expect(result.current.draft).toEqual(emptyDraft);
  });

  it('preserves edits to an already open draft while a different draft prepares attachments', async () => {
    const attachments = deferred<never[]>();
    mockInvoke.mockImplementation(async (command) => (
      command === 'list_attachments' ? attachments.promise : { revision: 0, payload: null }
    ));
    const { result } = renderComposer();
    act(() => result.current.openComposer({ ...emptyDraft, body: 'Working draft' }));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.editDraftMessage(fullMessage); });
    act(() => result.current.setDraft((current) => ({ ...current, body: 'Working draft edited during loading' })));
    await act(async () => { attachments.resolve([]); await pending; });
    expect(result.current.draft.body).toBe('Working draft edited during loading');
    expect(result.current.isComposerOpen).toBe(true);
  });

  it('does not apply an obsolete forward after its attachment lookup fails', async () => {
    const attachments = deferred<never[]>();
    mockInvoke.mockImplementation(async (command) => (
      command === 'list_attachments' ? attachments.promise : { revision: 0, payload: null }
    ));
    const { result, mocks } = renderComposer();
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.composeFromMessage({ ...fullMessage, has_attachments: true }, 'forward'); });
    await act(async () => {
      await result.current.composeFromMessage({ ...fullMessage, subject: 'Latest' }, 'reply');
    });
    mocks.setStatus.mockClear();
    await act(async () => { attachments.reject(new Error('older attachment failed')); await pending; });
    expect(result.current.draft.subject).toBe('Re: Latest');
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it('ignores an obsolete failure after changing the selected account/message', async () => {
    const older = deferred<Message>();
    mockInvoke.mockImplementation(async (command) => (
      command === 'get_message_detail' ? older.promise : { revision: 0, payload: null }
    ));
    const { result, rerender, mocks } = renderComposer(5, 1);
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.composeFromMessage(summary, 'reply'); });
    rerender({ selectedId: 2, accountId: 2 });
    await act(async () => {
      older.reject(new Error('old detail failed'));
      await expect(pending).resolves.toBe(false);
    });
    expect(result.current.isComposerOpen).toBe(false);
    expect(mocks.setStatus).not.toHaveBeenCalledWith(expect.stringContaining('old detail failed'));
  });

  it('still rejects a current preparation failure so the caller can show the error', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'get_message_detail') throw new Error('current detail failed');
      return { revision: 0, payload: null };
    });
    const { result } = renderComposer();
    await act(async () => {
      await expect(result.current.composeFromMessage(summary, 'reply')).rejects.toThrow('current detail failed');
    });
    expect(result.current.draft).toEqual(emptyDraft);
  });
});

describe('useComposerController close lifecycle', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'load_composer_recovery') return { revision: 0, payload: null };
      if (command === 'save_composer_recovery' || command === 'clear_composer_recovery') return true;
      return undefined;
    });
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
    mockInvoke.mockResolvedValueOnce(true).mockResolvedValueOnce({
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
    mockInvoke.mockResolvedValueOnce(true).mockResolvedValueOnce({
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
      .mockResolvedValueOnce(true)
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
    expect(mocks.refreshContacts).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('complete_background_task', {
      taskId: 91,
      message: '发送完成',
    });
  });

  it('keeps the composer and its content open after a direct send failure', async () => {
    const { result, mocks } = renderComposer(0);
    mockInvoke
      .mockResolvedValueOnce(true)
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
    expect(mocks.setStatus).toHaveBeenLastCalledWith(expect.stringContaining('正文和附件已保留'));
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
    const { result, mocks } = renderComposer(5, 8);
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
    const { result, mocks } = renderComposer(5, 9);
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

  it('does not report delivery failure when only progress completion fails', async () => {
    const { result, mocks } = renderComposer(0);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'load_composer_recovery') return { revision: 0, payload: null };
      if (command === 'enqueue_background_task' || command === 'mark_background_task_running') return { id: 70, progress: 0 };
      if (command === 'send_message') return 701;
      if (command === 'complete_background_task') throw new Error('task database unavailable');
      return true;
    });
    act(() => { result.current.setDraft({ ...emptyDraft, to: 'a@example.com', body: 'sent once' }); });
    await act(async () => { await result.current.sendDraft(); });
    expect(mocks.showToast).toHaveBeenCalledWith('邮件已发送');
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'fail_background_task')).toHaveLength(0);
    expect(result.current.draft.body).toBe('');
  });

  it('does not submit the same draft twice while the first SMTP call is pending', async () => {
    const { result } = renderComposer(0);
    let finish!: (id: number) => void;
    const pending = new Promise<number>((resolve) => { finish = resolve; });
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'load_composer_recovery') return { revision: 0, payload: null };
      if (command === 'enqueue_background_task' || command === 'mark_background_task_running') return { id: 71, progress: 0 };
      if (command === 'send_message') return pending;
      return true;
    });
    act(() => { result.current.setDraft({ ...emptyDraft, to: 'a@example.com', body: 'one delivery' }); });
    await act(async () => {
      const first = result.current.sendDraft();
      const second = result.current.sendDraft();
      await Promise.resolve();
      await Promise.resolve();
      finish(702);
      await Promise.all([first, second]);
    });
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'send_message')).toHaveLength(1);
  });

  it('retains uncertain mail without inviting automatic or immediate resubmission', async () => {
    const { result, mocks } = renderComposer(0);
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'load_composer_recovery') return { revision: 0, payload: null };
      if (command === 'enqueue_background_task' || command === 'mark_background_task_running') return { id: 72, progress: 0 };
      if (command === 'send_message') throw new Error('[SEND_OUTCOME_UNKNOWN] connection closed after DATA');
      if (command === 'list_outbox') return [];
      if (command === 'fail_background_task') return { message: 'unknown' };
      return true;
    });
    act(() => { result.current.setDraft({ ...emptyDraft, to: 'a@example.com', body: 'keep me' }); });
    await act(async () => { await result.current.sendDraft(); });
    expect(result.current.draft.body).toBe('keep me');
    expect(mocks.setStatus).toHaveBeenLastCalledWith(expect.stringContaining('不要直接重发'));
    expect(mocks.showToast).not.toHaveBeenCalledWith('邮件已发送');
  });

});

describe('composer submission ownership', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    localStorage.clear();
  });
  it.each(['save', 'queue', 'send', 'direct'] as const)('protects close/replacement and preserves newer edits during %s', async (operation) => {
    let resolveSubmission!: (value: unknown) => void;
    const command = operation === 'save' ? 'save_draft' : operation === 'direct' ? 'send_message' : 'queue_outbox_message';
    mockInvoke.mockImplementation(async (name) => {
      if (name === 'load_composer_recovery') return { revision: 0, payload: null };
      if (name === command) return new Promise((resolve) => { resolveSubmission = resolve; });
      if (name === 'enqueue_background_task') return { id: 1, progress: 0 };
      return true;
    });
    const { result } = renderComposer(operation === 'direct' ? 0 : 5);
    act(() => result.current.openComposer({ ...emptyDraft, to: 'a@example.com', body: 'submitted version' }));
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = operation === 'save' ? result.current.saveDraft()
        : operation === 'queue' ? result.current.queueDraft() : result.current.sendDraft();
      await Promise.resolve();
    });
    expect(result.current.isSubmitting).toBe(true);
    act(() => {
      result.current.closeComposer();
      result.current.forceCloseComposer();
      result.current.openComposer({ ...emptyDraft, body: 'replacement' }, { replaceExisting: true });
    });
    expect(result.current.isComposerOpen).toBe(true);
    expect(result.current.draft.body).toBe('submitted version');
    // Even a programmatic edit or late attachment callback bypassing UI inert
    // must not be consumed by completion of the older submission.
    act(() => result.current.setDraft({ ...result.current.draft, body: 'new edit must survive' }));
    await act(async () => {
      resolveSubmission(operation === 'save' ? { draft_id: 1, message: '草稿已保存' }
        : operation === 'direct' ? 1 : { id: 1, message_id: 1 });
      await pending;
    });
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.isComposerOpen).toBe(true);
    expect(result.current.draft.body).toBe('new edit must survive');
    expect(mockInvoke.mock.calls.some(([name]) => name === 'clear_composer_recovery')).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith(command, expect.objectContaining({
      input: expect.objectContaining({ body: 'submitted version' }),
    }));
  });
  it('preserves a newer quick reply while an earlier revision finishes sending', async () => {
    let resolveQueue!: (value: unknown) => void;
    mockInvoke.mockImplementation(async (name) => {
      if (name === 'load_composer_recovery') return { revision: 0, payload: null };
      if (name === 'queue_outbox_message') return new Promise((resolve) => { resolveQueue = resolve; });
      return true;
    });
    const { result } = renderComposer(5, 1);
    act(() => result.current.setQuickReplyBody('submitted quick reply'));
    const source = { id: 1, account_id: 1, subject: 'Topic', sender_email: 'a@example.com', body: 'Original' } as Message;
    let pending!: Promise<void>;
    act(() => { pending = result.current.sendQuickReply(source); });
    expect(result.current.submissionKind).toBe('quick-reply');
    act(() => result.current.setQuickReplyBody('new quick reply version'));
    await act(async () => { resolveQueue({ id: 1, message_id: 1 }); await pending; });
    expect(result.current.quickReplyBody).toBe('new quick reply version');
    expect(result.current.isSubmitting).toBe(false);
  });
  it.each([0, 5] as const)('rejects stale message/account callbacks before a %s-second reply submission', async (delay) => {
    const { result, rerender, mocks } = renderComposer(delay, 1);
    act(() => result.current.setQuickReplyBody('reply for original message'));
    const staleSend = result.current.sendQuickReply;
    rerender({ selectedId: 2, accountId: 2 });
    act(() => result.current.setQuickReplyBody('reply for current message'));
    await act(async () => {
      await staleSend({ id: 1, account_id: 1 } as Message);
      await result.current.sendQuickReply({ id: 2, account_id: 1 } as Message);
      await result.current.sendQuickReply({ id: 1, account_id: 2 } as Message);
    });
    expect(mockInvoke.mock.calls.some(([name]) => name === 'queue_outbox_message' || name === 'send_message' || name === 'enqueue_background_task')).toBe(false);
    expect(result.current.quickReplyBody).toBe('reply for current message');
    expect(mocks.setStatus).toHaveBeenLastCalledWith(expect.stringContaining('邮件已切换'));
  });
});


describe('composer attachment ownership and submission gating', () => {
  const readyAttachment = { filename: 'report.pdf', mime_type: 'application/pdf', size_bytes: 12, local_path: '/temp/report.pdf' };
  beforeEach(() => {
    localStorage.clear();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async command => command === 'load_composer_recovery' ? { revision: 0, payload: null } : true);
  });

  it.each(['send', 'queue'] as const)('waits for durable attachment references and flushed editor input before %s', async operation => {
    const checkpoint = deferred<boolean>();
    mockInvoke.mockImplementation(async command => {
      if (command === 'load_composer_recovery') return { revision: 0, payload: null };
      if (command === 'save_composer_recovery') return checkpoint.promise;
      if (command === 'enqueue_background_task') return { id: 1, progress: 0 };
      if (command === 'queue_outbox_message') return { id: 1, message_id: 1 };
      if (command === 'send_message') return 1;
      return true;
    });
    const { result } = renderComposer(0);
    act(() => result.current.openComposer({ ...emptyDraft, account_id: 1, to: 'reader@example.com', body: 'Before flush', attachments: [readyAttachment] }));
    result.current.editorFlushRef.current = () => result.current.setDraft(current => ({ ...current, body: 'Final editor input' }));
    let pending!: Promise<void>;
    await act(async () => {
      pending = operation === 'send' ? result.current.sendDraft() : result.current.queueDraft();
      await Promise.resolve();
    });
    const saved = mockInvoke.mock.calls.find(([command]) => command === 'save_composer_recovery');
    expect(JSON.parse(String(saved?.[1]?.payloadJson)).draft).toMatchObject({ account_id: 1, body: 'Final editor input', attachments: [readyAttachment] });
    expect(mockInvoke.mock.calls.some(([command]) => ['send_message', 'queue_outbox_message', 'enqueue_background_task'].includes(command))).toBe(false);
    expect(result.current.isSubmitting).toBe(true);
    await act(async () => { checkpoint.resolve(true); await pending; });
    expect(mockInvoke).toHaveBeenCalledWith(operation === 'send' ? 'send_message' : 'queue_outbox_message', expect.objectContaining({
      input: expect.objectContaining({ body: 'Final editor input', attachments: [readyAttachment] }),
    }));
  });

  it.each(['send', 'queue'] as const)('retains attachment paths and blocks %s when recovery persistence fails', async operation => {
    mockInvoke.mockImplementation(async command => {
      if (command === 'load_composer_recovery') return { revision: 0, payload: null };
      if (command === 'save_composer_recovery') throw new Error('database full');
      return true;
    });
    const { result, mocks } = renderComposer(0);
    act(() => result.current.openComposer({ ...emptyDraft, to: 'reader@example.com', body: 'Retained body', attachments: [readyAttachment] }));
    await act(async () => {
      await expect(operation === 'send' ? result.current.sendDraft() : result.current.queueDraft()).rejects.toThrow('database full');
    });
    expect(mockInvoke.mock.calls.some(([command]) => ['send_message', 'queue_outbox_message', 'enqueue_background_task', 'cleanup_temp_attachments'].includes(command))).toBe(false);
    expect(result.current.isComposerOpen).toBe(true);
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.draft).toMatchObject({ body: 'Retained body', attachments: [readyAttachment] });
    expect(result.current.sendIssue).toMatchObject({ kind: 'failed', message: expect.stringContaining('database full') });
    expect(mocks.setStatus).toHaveBeenLastCalledWith(expect.stringContaining('正文和附件已保留'));
  });

  it('blocks send, queue and manual save synchronously while the picker prepares attachments', async () => {
    const picked = deferred<typeof readyAttachment[]>();
    mockInvoke.mockImplementation(async command => {
      if (command === 'pick_outbound_attachments') return picked.promise;
      if (command === 'load_composer_recovery') return { revision: 0, payload: null };
      return true;
    });
    const { result } = renderComposer();
    act(() => result.current.openComposer({ ...emptyDraft, to: 'reader@example.com', subject: 'With attachment' }));
    let importing!: Promise<void>;
    await act(async () => {
      importing = result.current.pickDraftAttachments();
      await result.current.sendDraft();
      await result.current.queueDraft();
      await result.current.saveDraft();
    });
    expect(mockInvoke.mock.calls.some(([command]) => ['send_message', 'queue_outbox_message', 'save_draft'].includes(command))).toBe(false);
    expect(result.current.isImportingAttachments).toBe(true);
    expect(result.current.isComposerOpen).toBe(true);
    await act(async () => { picked.resolve([readyAttachment]); await importing; });
    expect(result.current.draft.attachments).toEqual([readyAttachment]);
    expect(result.current.isImportingAttachments).toBe(false);
  });

  it('retains a successful file when another import fails and requires acknowledging that failure before saving', async () => {
    let picks = 0;
    mockInvoke.mockImplementation(async command => {
      if (command === 'pick_outbound_attachments') {
        if (++picks === 1) return [readyAttachment];
        throw new Error('Another attachment cannot be read');
      }
      if (command === 'save_draft') return { message: '已保存草稿' };
      return command === 'load_composer_recovery' ? { revision: 0, payload: null } : true;
    });
    const { result } = renderComposer();
    act(() => result.current.openComposer({ ...emptyDraft, body: 'Keep my work' }));
    await act(async () => result.current.pickDraftAttachments());
    await act(async () => result.current.pickDraftAttachments());
    await act(async () => result.current.saveDraft());
    expect(mockInvoke.mock.calls.some(([command]) => command === 'save_draft')).toBe(false);
    expect(result.current.draft.attachments).toEqual([readyAttachment]);
    const failed = result.current.attachmentImports.find(item => item.status === 'failed')!;
    act(() => result.current.dismissAttachmentImport(failed.id));
    await act(async () => result.current.saveDraft());
    expect(mockInvoke).toHaveBeenCalledWith('save_draft', expect.objectContaining({ input: expect.objectContaining({ attachments: [readyAttachment] }) }));
  });

  it('does not attach a late picker result to a replacement draft', async () => {
    const picked = deferred<typeof readyAttachment[]>();
    mockInvoke.mockImplementation(async command => command === 'pick_outbound_attachments'
      ? picked.promise : { revision: 0, payload: null });
    const { result } = renderComposer();
    act(() => result.current.openComposer({ ...emptyDraft, subject: 'Old letter' }));
    let importing!: Promise<void>;
    act(() => { importing = result.current.pickDraftAttachments(); });
    act(() => result.current.openComposer({ ...emptyDraft, subject: 'New letter' }, { replaceExisting: true }));
    await act(async () => { picked.resolve([readyAttachment]); await importing; });
    expect(result.current.draft.subject).toBe('New letter');
    expect(result.current.draft.attachments).toEqual([]);
    expect(result.current.attachmentImports).toEqual([]);
  });

  it('asks before closing an otherwise empty draft with a pending import and invalidates it on explicit discard', async () => {
    const picked = deferred<typeof readyAttachment[]>();
    mockInvoke.mockImplementation(async command => command === 'pick_outbound_attachments'
      ? picked.promise : { revision: 0, payload: null });
    const { result } = renderComposer();
    act(() => result.current.openComposer(emptyDraft));
    let importing!: Promise<void>;
    act(() => { importing = result.current.pickDraftAttachments(); });
    act(() => result.current.closeComposer());
    expect(result.current.composerCloseConfirmOpen).toBe(true);
    expect(result.current.isComposerOpen).toBe(true);
    act(() => result.current.forceCloseComposer());
    act(() => result.current.openComposer({ ...emptyDraft, subject: 'Next' }));
    await act(async () => { picked.resolve([readyAttachment]); await importing; });
    expect(result.current.draft.subject).toBe('Next');
    expect(result.current.draft.attachments).toEqual([]);
  });
  it('reloads a partial-import checkpoint with the good attachment and a blocking failed-file marker', async () => {
    let checkpoint: unknown = null;
    mockInvoke.mockImplementation(async (command, args) => {
      if (command === 'load_composer_recovery') return { revision: checkpoint ? 50 : 0, payload: checkpoint };
      if (command === 'save_temp_attachment') {
        if (args?.filename === 'bad.txt') throw new Error('Cannot prepare file');
        return '/temp/good.txt';
      }
      if (command === 'save_composer_recovery') { checkpoint = JSON.parse(String(args?.payloadJson)); return true; }
      if (command === 'pick_outbound_attachments') return [{ filename: 'bad.txt', size_bytes: 4, mime_type: 'text/plain', local_path: '/temp/bad.txt' }];
      return true;
    });
    const original = renderComposer();
    act(() => original.result.current.openComposer({ ...emptyDraft, to: 'reader@example.com', body: 'Keep all files' }));
    await act(async () => original.result.current.processDroppedOrPastedFiles([
      new File(['body'], 'good.txt', { type: 'text/plain' }),
      new File(['body'], 'bad.txt', { type: 'text/plain' }),
    ]));
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(checkpoint).toMatchObject({
      draft: { attachments: [expect.objectContaining({ filename: 'good.txt' })] },
      pending_attachments: [{ filename: 'bad.txt', size_bytes: 4, is_inline: false }],
    });
    original.unmount();
    localStorage.clear();
    const restored = renderComposer();
    await act(async () => { await Promise.resolve(); });
    act(() => restored.result.current.openComposer(undefined, { restoreAutosave: true }));
    expect(restored.result.current.draft.attachments.map(file => file.filename)).toEqual(['good.txt']);
    expect(restored.result.current.attachmentImports[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('bad.txt') });
    await act(async () => {
      await restored.result.current.sendDraft();
      await restored.result.current.queueDraft();
      await restored.result.current.saveDraft();
    });
    expect(mockInvoke.mock.calls.some(([command]) => ['send_message', 'queue_outbox_message', 'save_draft'].includes(command))).toBe(false);
    await act(async () => restored.result.current.retryAttachmentImport(restored.result.current.attachmentImports[0].id));
    expect(restored.result.current.draft.attachments.map(file => file.filename)).toEqual(['good.txt', 'bad.txt']);
    expect(restored.result.current.attachmentImports).toEqual([]);
    restored.unmount();
  });

});

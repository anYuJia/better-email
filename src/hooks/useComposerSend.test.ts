import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from '../app/appConfig';
import { invoke } from '../tauriBridge';
import useComposerSend from './useComposerSend';
import type { Message } from '../app/types';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function setup(getAttachmentSendBlockReason = () => null as string | null) {
  const options = {
    getDraftSnapshot: () => ({ draft: { ...emptyDraft, to: 'test@example.com', body: '正文不能丢失' }, revision: 1 }),
    clearSubmittedDraft: vi.fn(() => true),
    getQuickReplySnapshot: vi.fn(), clearSubmittedQuickReply: vi.fn(),
    submissionInFlight: { current: false }, getAttachmentSendBlockReason,
    account: null, pendingSendUndo: null, sendUndoDelaySeconds: 0 as const,
    setOutbox: vi.fn(), setPendingSendUndo: vi.fn(), setStatus: vi.fn(), showToast: vi.fn(),
    draftInputForCurrentAccount: (draft: typeof emptyDraft) => draft,
    threadingForDraft: () => null,
    focusMailboxRole: vi.fn().mockResolvedValue(undefined), refreshAll: vi.fn().mockResolvedValue(undefined),
    loadMeta: vi.fn().mockResolvedValue(undefined),
    setSendProgress: vi.fn(), setSendProgressMessage: vi.fn(), setAttachmentProgress: vi.fn(),
  };
  return { ...renderHook(() => useComposerSend(options)), options };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (command) => {
    if (command === 'enqueue_background_task' || command === 'mark_background_task_running') return { id: 42, progress: 0 };
    if (command === 'send_message') return 100;
    if (command === 'list_outbox') return [];
    return {};
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('attachment-safe composer submission', () => {
  it.each([false, true])('clears a transferred inline snapshot only after confirmed direct-send success (failure: %s)', async (fail) => {
    const send = deferred<number>();
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'send_message') return send.promise;
      if (command === 'enqueue_background_task') return { id: 42, progress: 0 };
      if (command === 'list_outbox') return [];
      return {};
    });
    const { result, options, rerender } = setup();
    const source = { key: '1:10', body: '转交的版本', revision: 'source-version', mode: 'reply' as const };
    options.getDraftSnapshot = () => ({ draft: { ...emptyDraft, to: 'a@example.com', body: '完整正文', quick_reply_source: source }, revision: 9 });
    rerender();
    let pending!: Promise<unknown>;
    await act(async () => { pending = result.current.sendDraft(); });
    expect(options.clearSubmittedQuickReply).not.toHaveBeenCalled();
    options.getDraftSnapshot = () => ({ draft: { ...emptyDraft, to: 'b@example.com', body: '新草稿' }, revision: 10 });
    await act(async () => {
      if (fail) send.reject(new Error('[SEND_OUTCOME_UNKNOWN] 等待核实'));
      else send.resolve(100);
      await pending;
    });
    if (fail) {
      expect(options.clearSubmittedQuickReply).not.toHaveBeenCalled();
      expect(options.clearSubmittedDraft).not.toHaveBeenCalled();
      expect(result.current.sendIssue?.kind).toBe('uncertain');
    } else {
      expect(options.clearSubmittedQuickReply).toHaveBeenCalledExactlyOnceWith(source);
      expect(options.clearSubmittedDraft).toHaveBeenCalledWith(9);
    }
  });

  it.each(['sendDraft', 'queueDraft', 'saveDraft'] as const)('blocks %s synchronously while imports are pending or failed', async (action) => {
    let reason: string | null = '附件仍在准备';
    const { result, options } = setup(() => reason);
    await act(async () => {
      const outcome = await result.current[action]();
      if (action === 'saveDraft') expect(outcome).toEqual({ status: 'blocked', message: reason });
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(options.setStatus).toHaveBeenLastCalledWith(reason);
    reason = '有附件失败，请先重试或移除';
    await act(async () => {
      const outcome = await result.current[action]();
      if (action === 'saveDraft') expect(outcome).toEqual({ status: 'blocked', message: reason });
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(options.clearSubmittedDraft).not.toHaveBeenCalled();
  });

  it('distinguishes an empty draft from a successfully saved draft', async () => {
    const { result, options, rerender } = setup();
    options.getDraftSnapshot = () => ({ draft: { ...emptyDraft }, revision: 1 });
    rerender();
    await act(async () => {
      expect(await result.current.saveDraft()).toEqual({ status: 'empty', message: '草稿为空，未保存' });
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(options.clearSubmittedDraft).not.toHaveBeenCalled();
  });

  it('reports an overlapping save as blocked while preserving the first successful save', async () => {
    const saving = deferred<{ message: string }>();
    mockInvoke.mockImplementation(async () => saving.promise);
    const { result, options } = setup();
    let pending!: ReturnType<typeof result.current.saveDraft>;
    await act(async () => { pending = result.current.saveDraft(); });
    await act(async () => {
      expect(await result.current.saveDraft()).toEqual({ status: 'blocked', message: '正在提交邮件，请等待完成后再操作。' });
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      saving.resolve({ message: '草稿已保存' });
      expect(await pending).toEqual({ status: 'saved' });
    });
    expect(options.clearSubmittedDraft).toHaveBeenCalledTimes(1);
  });

  it('still reports saved after persistence succeeds but refreshing the list fails', async () => {
    mockInvoke.mockResolvedValue({ message: '草稿已保存' });
    const { result, options } = setup();
    options.refreshAll.mockRejectedValue(new Error('列表暂时不可用'));
    await act(async () => {
      expect(await result.current.saveDraft()).toEqual({ status: 'saved' });
    });
    expect(options.clearSubmittedDraft).toHaveBeenCalledTimes(1);
    expect(options.setStatus).toHaveBeenLastCalledWith('草稿已保存，但刷新邮件列表失败：列表暂时不可用');
  });

  it('binds the native progress task through the camelCase command argument and clears progress after success', async () => {
    const { result, options } = setup();
    await act(async () => { await result.current.sendDraft(); });
    expect(mockInvoke).toHaveBeenCalledWith('send_message', expect.objectContaining({ taskId: 42 }));
    const args = mockInvoke.mock.calls.find(([command]) => command === 'send_message')?.[1];
    expect(args).not.toHaveProperty('task_id');
    expect(options.clearSubmittedDraft).toHaveBeenCalledOnce();
    expect(options.setSendProgress).toHaveBeenLastCalledWith(null);
  });

  it('keeps an active send locked and resumes progress polling after a temporary query failure', async () => {
    vi.useFakeTimers();
    const sending = deferred<number>();
    let polls = 0;
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'enqueue_background_task' || command === 'mark_background_task_running') return { id: 42, progress: 0 };
      if (command === 'send_message') return sending.promise;
      if (command === 'get_background_task') {
        if (++polls === 1) throw new Error('busy database');
        return { status: 'running', progress: 60, message: '正在向发送服务器提交邮件' };
      }
      return {};
    });
    const { result, options } = setup();
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.sendDraft(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.isSubmitting).toBe(true);
    expect(options.setSendProgress).not.toHaveBeenLastCalledWith(null);
    expect(options.setSendProgressMessage).toHaveBeenLastCalledWith(expect.stringContaining('暂时中断'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(polls).toBe(2);
    expect(options.setSendProgress).toHaveBeenLastCalledWith(60);
    expect(options.setSendProgressMessage).toHaveBeenLastCalledWith('正在向发送服务器提交邮件');
    await act(async () => { sending.resolve(100); await pending; });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(polls).toBe(2);
  });

  it('retains a persistent failure until retry succeeds', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'enqueue_background_task' || command === 'mark_background_task_running') return { id: 42 };
      if (command === 'send_message') throw new Error('附件校验失败');
      if (command === 'list_outbox') return [];
      return {};
    });
    const { result, options } = setup();
    await act(async () => { await result.current.sendDraft(); });
    expect(result.current.sendIssue).toMatchObject({ kind: 'failed', message: expect.stringContaining('正文和附件已保留') });
    expect(result.current.sendIssue?.message).not.toContain('Error:');
    expect(options.setStatus.mock.calls.flat().filter(value => String(value).includes('附件校验失败'))).toEqual([result.current.sendIssue?.message]);
    expect(options.clearSubmittedDraft).not.toHaveBeenCalled();
    mockInvoke.mockImplementation(async (command) => command === 'send_message' ? 101 : { id: 43 });
    await act(async () => { await result.current.sendDraft(); });
    expect(result.current.sendIssue).toBe(null);
    expect(options.clearSubmittedDraft).toHaveBeenCalledOnce();
  });

  it('blocks repeated send and queue after an uncertain delivery instead of inviting a duplicate', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'enqueue_background_task' || command === 'mark_background_task_running') return { id: 42 };
      if (command === 'send_message') throw new Error('[SEND_OUTCOME_UNKNOWN] connection closed');
      if (command === 'save_draft') throw new Error('磁盘空间不足');
      if (command === 'list_outbox') return [];
      return {};
    });
    const { result, options } = setup();
    await act(async () => { await result.current.sendDraft(); });
    expect(result.current.sendIssue?.kind).toBe('uncertain');
    await act(async () => { await expect(result.current.saveDraft()).rejects.toThrow('磁盘空间不足'); });
    expect(result.current.sendIssue?.kind).toBe('uncertain');
    await act(async () => { await result.current.sendDraft(); await result.current.queueDraft(); });
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'send_message')).toHaveLength(1);
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'queue_outbox_message')).toHaveLength(0);
    expect(options.clearSubmittedDraft).not.toHaveBeenCalled();
  });

  it('blocks an uncertain quick reply for its original message while allowing another message reply', async () => {
    mockInvoke.mockImplementation(async (command) => {
      if (command === 'enqueue_background_task' || command === 'mark_background_task_running') return { id: 42 };
      if (command === 'send_message') throw new Error('[SEND_OUTCOME_UNKNOWN] connection closed');
      if (command === 'list_outbox') return [];
      return {};
    });
    const { result, options } = setup();
    const message = { id: 7, account_id: 1, sender_name: 'Sender', sender_email: 'a@example.com', recipients: 'me@example.com', received_at: '2026-10-30T00:00:00Z', subject: 'First', body: '', snippet: '' } as Message;
    options.getQuickReplySnapshot.mockReturnValue({ key: '1:7', body: '保留回复', revision: 1 });
    await act(async () => { await result.current.sendQuickReply(message); });
    await act(async () => { await result.current.sendQuickReply(message); });
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'send_message')).toHaveLength(1);
    options.getQuickReplySnapshot.mockReturnValue({ key: '1:8', body: '另一封回复', revision: 1 });
    await act(async () => { await result.current.sendQuickReply({ ...message, id: 8 }); });
    expect(mockInvoke.mock.calls.filter(([command]) => command === 'send_message')).toHaveLength(2);
    expect(options.clearSubmittedQuickReply).not.toHaveBeenCalled();
  });
});

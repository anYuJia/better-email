import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useComposerController from './useComposerController';
import type { OutboxItem } from '../app/types';

vi.mock('../tauriBridge', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: async () => () => undefined,
  }),
  invoke: vi.fn(),
}));

import { invoke } from '../tauriBridge';

const mockInvoke = vi.mocked(invoke);

function renderComposer() {
  const setOutbox = vi.fn();
  const setPendingSendUndo = vi.fn();
  const setSelectedId = vi.fn();
  const setStatus = vi.fn();
  const refreshAll = vi.fn().mockResolvedValue(undefined);
  const loadMeta = vi.fn().mockResolvedValue({ folderId: 101, folders: [] });
  const focusMailboxRole = vi.fn().mockResolvedValue(undefined);

  const hook = renderHook(() => useComposerController({
    account: null,
    accounts: [],
    identities: [],
    selectedId: null,
    pendingSendUndo: null,
    sendUndoDelaySeconds: 5,
    setOutbox,
    setPendingSendUndo,
    setSelectedId,
    setStatus,
    loadMeta,
    refreshAll,
    focusMailboxRole,
  }));

  return { ...hook, mocks: { setOutbox, setPendingSendUndo, setSelectedId, setStatus, refreshAll, loadMeta, focusMailboxRole } };
}

describe('useComposerController close lifecycle', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    localStorage.clear();
  });

  it('saving a draft closes the composer without the unsaved-changes confirmation', async () => {
    const { result, mocks } = renderComposer();
    mockInvoke.mockResolvedValueOnce({ message: '草稿已保存', draft_id: 7 });

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
    expect(mocks.setStatus).toHaveBeenCalledWith('草稿已保存');
  });

  it('queuing a draft closes the composer without the unsaved-changes confirmation', async () => {
    const { result } = renderComposer();
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
  });

  it('sending with the undo delay closes the composer without the unsaved-changes confirmation', async () => {
    const { result } = renderComposer();
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
});

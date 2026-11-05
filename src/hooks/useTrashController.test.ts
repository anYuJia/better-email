import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '../tauriBridge';
import useTrashController from './useTrashController';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('empty trash failure recovery', () => {
  it('refreshes completed deletions but rejects partial failure so confirmation remains retryable', async () => {
    const setStatus = vi.fn(), refreshAll = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockResolvedValue({ local_deleted_count: 2, remote_failed_count: 1, remote_skipped_count: 0, message: '已删除 2 封；1 封尚未删除' });
    const view = renderHook(() => useTrashController({ accounts: [], accountScope: 'all', setStatus, refreshAll }));
    act(() => view.result.current.emptyCurrentTrash());
    await act(async () => { await expect(view.result.current.emptyCurrentTrashConfirmed(0)).rejects.toThrow('1 封尚未删除'); });
    expect(refreshAll).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenCalledWith('已删除 2 封；1 封尚未删除');
    expect(view.result.current.confirmEmptyTrashState).not.toBeNull();
  });

  it('does not report an authentication skip as successful emptying', async () => {
    vi.mocked(invoke).mockResolvedValue({ local_deleted_count: 0, remote_failed_count: 0, remote_skipped_count: 1, message: '请修复账号登录' });
    const view = renderHook(() => useTrashController({ accounts: [], accountScope: 'all', setStatus: vi.fn(), refreshAll: vi.fn().mockResolvedValue(undefined) }));
    await expect(view.result.current.emptyCurrentTrashConfirmed(0)).rejects.toThrow('修复账号登录');
  });
});

import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useMailFeedback from './useMailFeedback';
import type { AccountScope } from '../app/types';

it('keeps a recoverable refresh failure with its mailbox and clears it after retry', async () => {
  let rejectSync!: (reason: Error) => void;
  const enqueueManualSyncAndWait = vi.fn<() => Promise<void>>()
    .mockImplementationOnce(() => new Promise((_, reject) => { rejectSync = reject; }))
    .mockResolvedValue(undefined);
  const setStatus = vi.fn();
  const options = { enqueueManualSyncAndWait, refreshAll: vi.fn(), setOutbox: vi.fn(), setStatus };
  const { result, rerender } = renderHook(({ scope }: { scope: AccountScope }) =>
    useMailFeedback({ ...options, accountScope: scope }), { initialProps: { scope: 1 } });

  const syncing = result.current.handleRefresh();
  rerender({ scope: 2 });
  await act(async () => {
    rejectSync(new Error('Error: 邮箱服务暂时不可用'));
    await syncing;
  });
  expect(result.current.refreshError).toBeUndefined();
  rerender({ scope: 1 });
  expect(result.current.refreshError).toBe('邮箱服务暂时不可用');
  expect(setStatus).not.toHaveBeenCalled();
  await act(() => result.current.handleRefresh());
  expect(result.current.refreshError).toBeUndefined();
});

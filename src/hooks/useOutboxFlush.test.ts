import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useOutboxFlush from './useOutboxFlush';
import { IPC } from '../ipc/commands';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('../tauriBridge', () => ({ invoke: invokeMock }));

describe('scheduled outbox task', () => {
  it('releases scheduled messages and attaches the task id to SMTP processing', async () => {
    invokeMock.mockReset().mockResolvedValue([]);
    const { result } = renderHook(() => useOutboxFlush({
      setOutbox: vi.fn(), setStatus: vi.fn(), refreshMailboxContext: vi.fn().mockResolvedValue(undefined),
    }));
    await act(async () => { await result.current.sendDueOutboxItems(123); });
    expect(invokeMock.mock.calls).toEqual([
      [IPC.ReleaseDueOutboxItems],
      [IPC.FlushOutboxSmtp, { taskId: 123 }],
    ]);
  });

  it('preserves the SMTP result when refreshing the mailbox fails', async () => {
    invokeMock.mockReset().mockResolvedValue([]);
    const setStatus = vi.fn();
    const { result } = renderHook(() => useOutboxFlush({
      setOutbox: vi.fn(), setStatus, refreshMailboxContext: vi.fn().mockRejectedValue(new Error('offline')),
    }));
    await act(async () => {
      await expect(result.current.sendDueOutboxItems(123)).resolves.toMatchObject({ items: [] });
    });
    expect(setStatus).toHaveBeenCalledWith(expect.stringContaining('邮件列表刷新失败'));
  });
});

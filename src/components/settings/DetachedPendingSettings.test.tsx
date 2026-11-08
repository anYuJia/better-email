import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as bridge from '../../tauriBridge';
import { IPC } from '../../ipc/commands';
import DetachedPendingSettings from './DetachedPendingSettings';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('detached pending sync operations', () => {
  it('requires confirmation and keeps local changes when a detached operation is discarded', async () => {
    const pending = { message_id: 9, kind: 'seen', value: '1', created_at: '2026-01-01', subject: '项目进展' };
    const invoke = vi.spyOn(bridge, 'invoke').mockImplementation(async (command) => {
      if (command === IPC.ListDetachedPendingWrites) return [pending] as never;
      if (command === IPC.DiscardDetachedPendingWrite) return true as never;
      throw new Error('unexpected call');
    });
    render(<DetachedPendingSettings accountId={42} />);
    expect(await screen.findByText('项目进展')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '停止同步' }));
    expect(screen.getByText(/本地修改会保留，服务器不会更新/)).not.toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '确认停止同步' }));
    await waitFor(() => expect(screen.queryByText('项目进展')).toBeNull());
    expect(invoke).toHaveBeenCalledWith(IPC.DiscardDetachedPendingWrite, {
      accountId: 42, pending: { message_id: 9, kind: 'seen', value: '1', created_at: '2026-01-01' },
    });
  });

  it('does not hide a write that changed before confirmation', async () => {
    vi.spyOn(bridge, 'invoke').mockImplementation(async (command) => (
      command === IPC.ListDetachedPendingWrites
        ? [{ message_id: 9, kind: 'move', value: 'trash', created_at: 't', subject: '待处理' }] as never
        : false as never
    ));
    render(<DetachedPendingSettings accountId={42} />);
    fireEvent.click(await screen.findByRole('button', { name: '停止同步' }));
    fireEvent.click(screen.getByRole('button', { name: '确认停止同步' }));
    expect(await screen.findByText(/操作状态已变化/)).not.toBeNull();
    expect(screen.getByText('待处理')).not.toBeNull();
  });
});

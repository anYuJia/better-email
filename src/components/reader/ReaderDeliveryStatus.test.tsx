import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReaderDeliveryStatus from './ReaderDeliveryStatus';
import type { OutboxItem } from '../../app/types';

const item: OutboxItem = { id: 7, message_id: 9, recipients: 'a@example.com', subject: '核对发送', status: 'send_unknown', attempts: 1, last_error: '连接中断', queued_at: '', next_attempt_at: '' };
afterEach(cleanup);

describe('uncertain delivery reconciliation', () => {
  it.each([true, false])('requires confirmation before resolving delivery as %s', async (delivered) => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(<ReaderDeliveryStatus item={item} onResolve={onResolve} />);
    fireEvent.click(screen.getByRole('button', { name: delivered ? '我已核对，邮件已发出' : '我已核对，退回草稿' }));
    expect(onResolve).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').textContent).toContain('核对');
    fireEvent.click(screen.getByRole('button', { name: delivered ? '已核对，仅补存副本' : '已核对，退回草稿' }));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(7, delivered));
  });

  it('keeps a failed reconciliation open with an actionable error', async () => {
    render(<ReaderDeliveryStatus item={item} onResolve={vi.fn().mockRejectedValue(new Error('状态已变化'))} />);
    fireEvent.click(screen.getByRole('button', { name: '我已核对，退回草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '已核对，退回草稿' }));
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('状态已变化'));
  });
});

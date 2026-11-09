import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReaderDeliveryStatus from './ReaderDeliveryStatus';
import type { OutboxItem } from '../../app/types';

const item: OutboxItem = { id: 7, message_id: 9, recipients: 'a@example.com', subject: '核对发送', status: 'send_unknown', attempts: 1, last_error: '连接中断', queued_at: '', next_attempt_at: '' };
afterEach(cleanup);

describe('uncertain delivery reconciliation', () => {
  it('explains an authentication rejection and allows returning the message to drafts', async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(<ReaderDeliveryStatus item={{ ...item, status: 'failed', last_error: 'SMTP 认证失败：permanent error (535): Login fail' }} onCancel={onCancel} />);
    expect(screen.getByText(/发送服务器拒绝了账号认证/)).toBeTruthy();
    expect(screen.getByText('查看服务器详情')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '退回草稿' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });

  it('shows a live countdown and reports a failed withdrawal', async () => {
    const onCancel = vi.fn().mockRejectedValue(new Error('邮件已经开始发送'));
    render(<ReaderDeliveryStatus item={{ ...item, status: 'scheduled', last_error: '', next_attempt_at: new Date(Date.now() + 10_000).toISOString() }} onCancel={onCancel} />);
    expect(screen.getByText(/秒后发送，可在发送前撤回/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '退回草稿' }));
    await waitFor(() => expect(screen.getByText(/无法退回草稿：邮件已经开始发送/)).toBeTruthy());
  });

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

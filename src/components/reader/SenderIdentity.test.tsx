import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MessageSummary } from '../../app/types';
import SenderIdentity from './SenderIdentity';

afterEach(cleanup);

function message(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: 1,
    account_id: 1,
    account_email: 'me@example.com',
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: 'Gitee',
    sender_email: 'no-reply@example.com',
    recipients: 'recipient@example.com',
    cc: '',
    bcc: '',
    subject: '通知',
    snippet: '正文',
    security_warnings: [],
    received_at: '2026-08-20T09:00:00+08:00',
    is_read: true,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: 1,
    message_id_header: '',
    in_reply_to_header: '',
    references_header: '',
    ...overrides,
  };
}

describe('SenderIdentity recipient summary', () => {
  it.each(['', 'no-reply@example.com', 'NO-REPLY@EXAMPLE.COM'])('shows an address-only sender once and preserves its compose action (%s)', (sender_name) => {
    const onComposeNew = vi.fn();
    render(<SenderIdentity message={message({ sender_name })} onComposeNew={onComposeNew} />);
    expect(screen.getAllByText('no-reply@example.com')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'no-reply@example.com' }));
    expect(onComposeNew).toHaveBeenCalledWith({ to: 'no-reply@example.com' });
    expect(screen.getByText('发给 recipient@example.com')).toBeDefined();
  });
  it('uses a quiet personal label when the recipient is the current account', () => {
    render(<SenderIdentity message={message({ recipients: 'me@example.com' })} />);
    expect(screen.getByText('发给 我')).toBeDefined();
    expect(screen.queryByText('发给 me@example.com')).toBeNull();
  });

  it('shows cc in the compact sender line', () => {
    render(<SenderIdentity message={message({ cc: 'copy@example.com' })} />);
    expect(screen.getByText('发给 recipient@example.com，抄送 copy@example.com')).toBeDefined();
  });

  it('opens all recipients in an accessible dialog when the compact line overflows', () => {
    render(
      <SenderIdentity
        message={message({
          recipients: 'one@example.com, two@example.com, three@example.com',
          cc: 'copy@example.com',
        })}
        onComposeNew={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByRole('dialog', { name: '收件人详情' })).toBeDefined();
    expect(screen.getByText('three@example.com')).toBeDefined();
    expect(screen.getByText('copy@example.com')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '关闭收件人详情' }));
    expect(screen.queryByRole('dialog', { name: '收件人详情' })).toBeNull();
  });
});

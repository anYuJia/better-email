import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Message } from '../../app/types';
import QuickReplySection from './QuickReplySection';

const selected = {
  id: 7,
  sender_name: 'Ada',
  sender_email: 'ada@example.com',
} as Message;

afterEach(cleanup);

describe('QuickReplySection focus and draft handoff', () => {
  it('returns focus to the editor before clearing disables the action', () => {
    const onQuickReplyChange = vi.fn();
    render(
      <QuickReplySection
        selected={selected}
        quickReplyBody="测试回复"
        onQuickReplyChange={onQuickReplyChange}
        onComposeFromMessage={vi.fn()}
        onSendQuickReply={vi.fn()}
      />,
    );

    const clear = screen.getByRole('button', { name: '清空' });
    clear.focus();
    fireEvent.click(clear);

    expect(onQuickReplyChange).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '输入回复' }));
  });

  it('passes the current reply into the full composer without clearing the background draft', () => {
    const onComposeFromMessage = vi.fn();
    const onQuickReplyChange = vi.fn();
    render(
      <QuickReplySection
        selected={selected}
        quickReplyBody="转到写信窗口"
        onQuickReplyChange={onQuickReplyChange}
        onComposeFromMessage={onComposeFromMessage}
        onSendQuickReply={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '写信窗口' }));

    expect(onComposeFromMessage).toHaveBeenCalledWith(selected, 'reply', '转到写信窗口');
    expect(onQuickReplyChange).not.toHaveBeenCalled();
  });

  it('returns focus to the editor before a successful send disables the action', () => {
    const onSendQuickReply = vi.fn();
    render(
      <QuickReplySection
        selected={selected}
        quickReplyBody="准备发送"
        onQuickReplyChange={vi.fn()}
        onComposeFromMessage={vi.fn()}
        onSendQuickReply={onSendQuickReply}
      />,
    );

    const send = screen.getByRole('button', { name: '发送回复' });
    send.focus();
    fireEvent.click(send);

    expect(onSendQuickReply).toHaveBeenCalledWith(selected);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '输入回复' }));
  });
});

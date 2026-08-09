import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { MessageSummary } from '../app/types';
import MessageListView from './MessageListView';

const message: MessageSummary = {
  id: 1,
  account_id: 1,
  account_email: 'test@example.com',
  folder_id: 1,
  folder_role: 'inbox',
  sender_name: 'Sender',
  sender_email: 'sender@example.com',
  recipients: 'test@example.com',
  cc: '',
  bcc: '',
  subject: 'Subject',
  snippet: 'Preview',
  security_warnings: [],
  received_at: '2026-08-09T08:00:00.000Z',
  is_read: true,
  is_starred: false,
  has_attachments: false,
  snoozed_until: '',
  labels: [],
  attachment_count: 0,
  remote_mailbox: 'INBOX',
  remote_uid: 1,
};

afterEach(cleanup);

describe('MessageListView theme-safe separators', () => {
  it('uses CSS classes rather than inline light colors for group and footer separators', () => {
    const messages = [message, { ...message, id: 2, remote_uid: 2 }];
    const { container } = render(
      <MessageListView
        groups={[
          { id: 'today', label: '今天', messages: [messages[0]] },
          { id: 'earlier', label: '更早', messages: [messages[1]] },
        ]}
        messages={messages}
        query=""
        filter="all"
        selectedId={null}
        hasMoreMessages={false}
        listStateKey="test"
        initialScrollTop={0}
        selectedMessageIds={[]}
        draggingMessageIds={[]}
        onScrollTopChange={vi.fn()}
        onSelectMessage={vi.fn()}
        onToggleMessageSelection={vi.fn()}
        onToggleAllVisible={vi.fn()}
        onOpenMessageMenu={vi.fn()}
        onCloseMessageMenu={vi.fn()}
        onSetDraggingMessageIds={vi.fn()}
        onClearSearchAndFilter={vi.fn()}
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    const separatedHeader = container.querySelector('.message-date-header--separated') as HTMLElement;
    const footer = container.querySelector('.message-list-footer') as HTMLElement;

    expect(separatedHeader).not.toBeNull();
    expect(separatedHeader.style.borderTop).toBe('');
    expect(footer.style.color).toBe('');
    expect(footer.style.borderTop).toBe('');
    expect(footer.style.background).toBe('');
  });

  it('keeps the current reader row checkbox available for bulk selection', () => {
    const onToggleMessageSelection = vi.fn();
    const { container } = render(
      <MessageListView
        groups={[{ id: 'today', label: '今天', messages: [message] }]}
        messages={[message]}
        query=""
        filter="all"
        selectedId={message.id}
        hasMoreMessages={false}
        listStateKey="current-row"
        initialScrollTop={0}
        selectedMessageIds={[]}
        draggingMessageIds={[]}
        onScrollTopChange={vi.fn()}
        onSelectMessage={vi.fn()}
        onToggleMessageSelection={onToggleMessageSelection}
        onToggleAllVisible={vi.fn()}
        onOpenMessageMenu={vi.fn()}
        onCloseMessageMenu={vi.fn()}
        onSetDraggingMessageIds={vi.fn()}
        onClearSearchAndFilter={vi.fn()}
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    const checkbox = container.querySelector('.message-select input') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onToggleMessageSelection).toHaveBeenCalledWith(message.id, true);
  });
});

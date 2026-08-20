import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { MessageSummary } from '../app/types';
import MessageListView from './MessageListView';
import {
  GROUP_HEADER_HEIGHT,
  LIST_FOOTER_HEIGHT,
  MESSAGE_ROW_HEIGHT,
} from './messageListLayout';

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
    const list = container.querySelector('[role="list"]');
    const listItem = container.querySelector('[role="listitem"]');
    expect(list?.getAttribute('aria-label')).toBe('邮件列表');
    expect(listItem?.getAttribute('aria-current')).toBe('true');
    expect(listItem?.getAttribute('aria-posinset')).toBe('1');
    expect(listItem?.getAttribute('aria-setsize')).toBe('1');
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(onToggleMessageSelection).toHaveBeenCalledWith(message.id, true);
  });

  it('虚拟布局行高与单一事实来源常量完全一致', () => {
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
        listStateKey="layout-consistency"
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

    const wrapper = container.querySelector('.message-list-viewport-wrapper') as HTMLElement;
    const headers = container.querySelectorAll<HTMLElement>('.message-date-header');
    const rows = container.querySelectorAll<HTMLElement>('.message-list-item');

    // 外层总高度 = 所有 header/行高度之和 + 底部 footer 高度。
    const expectedTotal = 2 * (GROUP_HEADER_HEIGHT + MESSAGE_ROW_HEIGHT) + LIST_FOOTER_HEIGHT;
    expect(wrapper.style.height).toBe(`${expectedTotal}px`);

    // header 0 顶部 y=0，行 0 紧跟其后；header 1 在“header0 + 行0”之后。
    expect(headers[0].style.transform).toBe('translateY(0px)');
    expect(headers[0].style.height).toBe(`${GROUP_HEADER_HEIGHT}px`);
    expect(rows[0].style.transform).toBe(`translateY(${GROUP_HEADER_HEIGHT}px)`);
    expect(rows[0].style.height).toBe(`${MESSAGE_ROW_HEIGHT}px`);
    expect(headers[1].style.transform).toBe(
      `translateY(${GROUP_HEADER_HEIGHT + MESSAGE_ROW_HEIGHT}px)`,
    );
    expect(rows[1].style.transform).toBe(
      `translateY(${2 * GROUP_HEADER_HEIGHT + MESSAGE_ROW_HEIGHT}px)`,
    );
    expect(rows[1].style.height).toBe(`${MESSAGE_ROW_HEIGHT}px`);
  });
});

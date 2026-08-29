import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
    expect(footer.style.fontSize).toBe('12px');
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

  it('keeps the same list top and scrollTop when selection mode is toggled', () => {
    const renderList = (selectedMessageIds: number[]) => (
      <MessageListView
        groups={[{ id: 'today', label: '今天', messages: [message] }]}
        messages={[message]}
        query=""
        filter="all"
        selectedId={null}
        hasMoreMessages={false}
        listStateKey="selection-stability"
        initialScrollTop={0}
        selectedMessageIds={selectedMessageIds}
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
      />
    );

    const view = render(renderList([]));
    const list = view.container.querySelector('[role="list"]') as HTMLDivElement;
    list.scrollTop = 136;
    view.rerender(renderList([message.id]));

    expect(view.container.querySelector('[role="list"]')).toBe(list);
    expect(list.scrollTop).toBe(136);
  });

  it('exposes list and date-group selection controls with mixed states', () => {
    const second = { ...message, id: 2, remote_uid: 2 };
    const third = { ...message, id: 3, remote_uid: 3 };
    const onToggleAllVisible = vi.fn();
    const onToggleMessageGroup = vi.fn();
    const onSelectMessageDateRange = vi.fn();
    const { rerender } = render(
      <MessageListView
        groups={[
          { id: 'today', label: '今天', messages: [message, second] },
          { id: 'yesterday', label: '昨天', messages: [third] },
        ]}
        messages={[message, second, third]}
        query=""
        filter="all"
        selectedId={null}
        hasMoreMessages={false}
        listStateKey="selection-controls"
        initialScrollTop={0}
        selectedMessageIds={[]}
        draggingMessageIds={[]}
        onScrollTopChange={vi.fn()}
        onSelectMessage={vi.fn()}
        onToggleMessageSelection={vi.fn()}
        onToggleAllVisible={onToggleAllVisible}
        onToggleMessageGroup={onToggleMessageGroup}
        onSelectMessageDateRange={onSelectMessageDateRange}
        onOpenMessageMenu={vi.fn()}
        onCloseMessageMenu={vi.fn()}
        onSetDraggingMessageIds={vi.fn()}
        onClearSearchAndFilter={vi.fn()}
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前列表中的全部可见邮件' }));
    expect(onToggleAllVisible).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择今天邮件' }));
    expect(onToggleMessageGroup).toHaveBeenCalledWith('today', [1, 2], true);
    fireEvent.click(screen.getByRole('button', { name: '按日期范围筛选邮件' }));
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-08-09' } });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '00:00:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '24:00:00' } });
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(onSelectMessageDateRange).toHaveBeenCalledWith({
      startDate: '2026-08-01',
      startTime: '00:00:00',
      endDate: '2026-08-09',
      endTime: '24:00:00',
    });

    rerender(
      <MessageListView
        groups={[
          { id: 'today', label: '今天', messages: [message, second] },
          { id: 'yesterday', label: '昨天', messages: [third] },
        ]}
        messages={[message, second, third]}
        query="" filter="all" selectedId={null} hasMoreMessages={false}
        listStateKey="selection-controls" initialScrollTop={0} selectedMessageIds={[1]}
        draggingMessageIds={[]} onScrollTopChange={vi.fn()} onSelectMessage={vi.fn()}
        onToggleMessageSelection={vi.fn()} onToggleAllVisible={onToggleAllVisible}
        onToggleMessageGroup={onToggleMessageGroup} onSelectMessageDateRange={onSelectMessageDateRange}
        onOpenMessageMenu={vi.fn()} onCloseMessageMenu={vi.fn()}
        onSetDraggingMessageIds={vi.fn()} onClearSearchAndFilter={vi.fn()}
        onRefresh={vi.fn()} onLoadMore={vi.fn()}
      />,
    );
    expect(screen.getByRole('checkbox', { name: '选择今天邮件' }).getAttribute('aria-checked')).toBe('mixed');
    expect(screen.getByRole('checkbox', { name: '选择当前列表中的全部可见邮件' }).getAttribute('aria-checked')).toBe('mixed');
  });

  it('shows the overlay thumb during list scrolling without adding a track column', () => {
    vi.useFakeTimers();
    const messages = Array.from({ length: 8 }, (_, index) => ({
      ...message,
      id: index + 1,
      remote_uid: index + 1,
    }));
    const { container } = render(
      <MessageListView
        groups={[{ id: 'today', label: '今天', messages }]}
        messages={messages}
        query=""
        filter="all"
        selectedId={null}
        hasMoreMessages={false}
        listStateKey="scrollbar-overlay"
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
    const list = container.querySelector('[role="list"]') as HTMLDivElement;
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 736 },
    });
    list.scrollTop = 120;
    fireEvent.scroll(list);

    const thumb = container.querySelector('.message-list-scrollbar-thumb') as HTMLElement;
    expect(thumb.classList.contains('is-visible')).toBe(true);
    expect(thumb.style.width).toBe('6px');
    expect(thumb.style.height).not.toBe('0px');
    expect(container.querySelector('.message-list-scrollbar-track')).toBeNull();

    act(() => vi.advanceTimersByTime(1200));
    expect(thumb.classList.contains('is-visible')).toBe(false);
  });

  it('drags the local thumb without disabling normal scrolling', () => {
    const messages = Array.from({ length: 8 }, (_, index) => ({
      ...message,
      id: index + 1,
      remote_uid: index + 1,
    }));
    const { container } = render(
      <MessageListView
        groups={[{ id: 'today', label: '今天', messages }]}
        messages={messages}
        query=""
        filter="all"
        selectedId={null}
        hasMoreMessages={false}
        listStateKey="local-scrollbar-drag"
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
    const list = container.querySelector('[role="list"]') as HTMLDivElement;
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 736 },
    });
    fireEvent.scroll(list);
    const thumb = container.querySelector('.message-list-scrollbar-thumb') as HTMLElement;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    act(() => {
      fireEvent.pointerDown(thumb, { button: 0, pointerId: 3, clientY: 8 });
      expect(thumb.classList.contains('is-dragging')).toBe(true);
      fireEvent.pointerMove(document, { pointerId: 3, clientY: 40 });
    });
    expect(list.scrollTop).toBeGreaterThan(0);
    expect(thumb.classList.contains('is-dragging')).toBe(true);
    act(() => fireEvent.pointerUp(document, { pointerId: 3, clientY: 40 }));
    expect(thumb.classList.contains('is-dragging')).toBe(false);

    list.scrollTop = 12;
    fireEvent.scroll(list);
    expect(list.scrollTop).toBe(12);
    raf.mockRestore();
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

  it('opens the row context menu beside the focused message with Shift+F10', () => {
    const onOpenMessageMenu = vi.fn();
    const onSelectMessage = vi.fn();
    const { container } = render(
      <MessageListView
        groups={[{ id: 'today', label: '今天', messages: [message] }]}
        messages={[message]}
        query=""
        filter="all"
        selectedId={message.id}
        hasMoreMessages={false}
        listStateKey="keyboard-menu"
        initialScrollTop={0}
        selectedMessageIds={[]}
        draggingMessageIds={[]}
        onScrollTopChange={vi.fn()}
        onSelectMessage={onSelectMessage}
        onToggleMessageSelection={vi.fn()}
        onToggleAllVisible={vi.fn()}
        onOpenMessageMenu={onOpenMessageMenu}
        onCloseMessageMenu={vi.fn()}
        onSetDraggingMessageIds={vi.fn()}
        onClearSearchAndFilter={vi.fn()}
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    const trigger = container.querySelector<HTMLButtonElement>('.message-card-main')!;
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 200,
      width: 320,
      height: 80,
      right: 420,
      bottom: 280,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'F10', shiftKey: true });

    expect(onSelectMessage).toHaveBeenCalledWith(message.id);
    expect(onOpenMessageMenu).toHaveBeenCalledWith(message, 260, 240, false);
  });

  it('moves focus from the removed load-more button to the first appended message', async () => {
    const nextMessage = { ...message, id: 2, remote_uid: 2, subject: 'Newly appended' };
    const onLoadMore = vi.fn(async () => [message, nextMessage]);
    const sharedProps = {
      query: '',
      filter: 'all' as const,
      selectedId: message.id,
      listStateKey: 'load-more-focus',
      initialScrollTop: 0,
      selectedMessageIds: [] as number[],
      draggingMessageIds: [] as number[],
      onScrollTopChange: vi.fn(),
      onSelectMessage: vi.fn(),
      onToggleMessageSelection: vi.fn(),
      onToggleAllVisible: vi.fn(),
      onOpenMessageMenu: vi.fn(),
      onCloseMessageMenu: vi.fn(),
      onSetDraggingMessageIds: vi.fn(),
      onClearSearchAndFilter: vi.fn(),
      onRefresh: vi.fn(),
      onLoadMore,
    };
    const { rerender } = render(
      <MessageListView
        {...sharedProps}
        groups={[{ id: 'today', label: '今天', messages: [message] }]}
        messages={[message]}
        hasMoreMessages
        loadMoreStatus={null}
      />,
    );

    const loadMoreButton = screen.getByRole('button', { name: '加载更多' });
    loadMoreButton.focus();
    fireEvent.click(loadMoreButton);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <MessageListView
        {...sharedProps}
        groups={[{ id: 'today', label: '今天', messages: [message, nextMessage] }]}
        messages={[message, nextMessage]}
        hasMoreMessages={false}
        loadMoreStatus={null}
      />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /Newly appended/ }),
      );
    });
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('mounts and focuses the first appended row when virtualization had it offscreen', async () => {
    const initialMessages = Array.from({ length: 40 }, (_, index) => ({
      ...message,
      id: index + 1,
      remote_uid: index + 1,
      subject: `Message ${index + 1}`,
    }));
    const allMessages = Array.from({ length: 50 }, (_, index) => ({
      ...message,
      id: index + 1,
      remote_uid: index + 1,
      subject: `Message ${index + 1}`,
    }));
    const onLoadMore = vi.fn(async () => allMessages);
    const sharedProps = {
      query: '',
      filter: 'all' as const,
      selectedId: message.id,
      listStateKey: 'virtual-load-more-focus',
      initialScrollTop: 0,
      selectedMessageIds: [] as number[],
      draggingMessageIds: [] as number[],
      onScrollTopChange: vi.fn(),
      onSelectMessage: vi.fn(),
      onToggleMessageSelection: vi.fn(),
      onToggleAllVisible: vi.fn(),
      onOpenMessageMenu: vi.fn(),
      onCloseMessageMenu: vi.fn(),
      onSetDraggingMessageIds: vi.fn(),
      onClearSearchAndFilter: vi.fn(),
      onRefresh: vi.fn(),
      onLoadMore,
    };
    const { rerender } = render(
      <MessageListView
        {...sharedProps}
        groups={[{ id: 'earlier', label: '更早', messages: initialMessages }]}
        messages={initialMessages}
        hasMoreMessages
        loadMoreStatus={null}
      />,
    );

    const list = screen.getByRole('list', { name: '邮件列表' });
    fireEvent.scroll(list, { target: { scrollTop: 1800 } });
    expect(onLoadMore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    // The async loader can clear its busy status one render before the
    // transitioned 50-row list commits. That intermediate render must not
    // consume the pending focus request as a false "no rows appended" case.
    rerender(
      <MessageListView
        {...sharedProps}
        groups={[{ id: 'earlier', label: '更早', messages: initialMessages }]}
        messages={initialMessages}
        hasMoreMessages
        loadMoreStatus="正在加载"
      />,
    );
    rerender(
      <MessageListView
        {...sharedProps}
        groups={[{ id: 'earlier', label: '更早', messages: initialMessages }]}
        messages={initialMessages}
        hasMoreMessages={false}
        loadMoreStatus={null}
      />,
    );
    rerender(
      <MessageListView
        {...sharedProps}
        groups={[{ id: 'earlier', label: '更早', messages: allMessages }]}
        messages={allMessages}
        hasMoreMessages={false}
        loadMoreStatus={null}
      />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: /Message 41/ }),
      );
    });
  });

  it('clears the pending focus request and focuses the footer when no row is appended', async () => {
    const futureMessage = { ...message, id: 2, remote_uid: 2, subject: 'Later arrival' };
    const sharedProps = {
      groups: [{ id: 'today', label: '今天', messages: [message] }],
      messages: [message],
      query: '',
      filter: 'all' as const,
      selectedId: message.id,
      hasMoreMessages: true,
      listStateKey: 'load-more-no-new',
      initialScrollTop: 0,
      selectedMessageIds: [] as number[],
      draggingMessageIds: [] as number[],
      onScrollTopChange: vi.fn(),
      onSelectMessage: vi.fn(),
      onToggleMessageSelection: vi.fn(),
      onToggleAllVisible: vi.fn(),
      onOpenMessageMenu: vi.fn(),
      onCloseMessageMenu: vi.fn(),
      onSetDraggingMessageIds: vi.fn(),
      onClearSearchAndFilter: vi.fn(),
      onRefresh: vi.fn(),
      onLoadMore: vi.fn(async () => [message]),
      loadMoreStatus: null,
    };
    const { container, rerender } = render(<MessageListView {...sharedProps} />);

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    const footer = container.querySelector<HTMLElement>('.message-list-footer')!;
    await waitFor(() => expect(document.activeElement).toBe(footer));

    rerender(
      <MessageListView
        {...sharedProps}
        groups={[{ id: 'today', label: '今天', messages: [message, futureMessage] }]}
        messages={[message, futureMessage]}
        hasMoreMessages={false}
      />,
    );
    expect(document.activeElement).toBe(footer);
  });

  it('clears the pending focus request and focuses the footer after a load error', async () => {
    const { container } = render(
      <MessageListView
        groups={[{ id: 'today', label: '今天', messages: [message] }]}
        messages={[message]}
        query=""
        filter="all"
        selectedId={message.id}
        hasMoreMessages
        listStateKey="load-more-error"
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
        onLoadMore={vi.fn(async (): Promise<MessageSummary[]> => {
          throw new Error('offline');
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        container.querySelector('.message-list-footer'),
      );
    });
  });
});

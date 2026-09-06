import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');

type ListProps = ComponentProps<typeof MessageListView>;

function makeProps(overrides: Partial<ListProps> = {}): ListProps {
  return {
    groups: [{ id: 'today', label: '今天', messages: [message] }],
    messages: [message],
    query: '',
    filter: 'all',
    selectedId: null,
    hasMoreMessages: false,
    listStateKey: 'account-1-inbox',
    initialScrollTop: 0,
    selectedMessageIds: [],
    draggingMessageIds: [],
    onScrollTopChange: vi.fn(),
    onSelectMessage: vi.fn(),
    onToggleMessageSelection: vi.fn(),
    onToggleAllVisible: vi.fn(),
    onOpenMessageMenu: vi.fn(),
    onCloseMessageMenu: vi.fn(),
    onSetDraggingMessageIds: vi.fn(),
    onClearSearchAndFilter: vi.fn(),
    onRefresh: vi.fn(),
    onLoadMore: vi.fn(async () => []),
    ...overrides,
  };
}

function resizeTo(width: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  });
}

function touch(clientY: number, identifier = 1) {
  return { identifier, clientX: 20, clientY };
}

function armPull(list: HTMLElement) {
  fireEvent.touchStart(list, { touches: [touch(10)] });
  fireEvent.touchMove(list, { touches: [touch(160)] });
  expect(screen.queryByText('释放立即刷新')).not.toBeNull();
}

function releasePull(list: HTMLElement) {
  fireEvent.touchEnd(list, { touches: [], changedTouches: [touch(160)] });
}

beforeEach(() => {
  vi.useFakeTimers();
  resizeTo(430);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
});

describe('MessageListView mobile viewport policy', () => {
  it('preserves the explicit mobile mode after resizing to landscape', () => {
    const props = makeProps({ mobile: true });
    render(<MessageListView {...props} />);
    resizeTo(932);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).toBeNull();
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    releasePull(list);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the inclusive 720px responsive breakpoint without a mobile override', () => {
    render(<MessageListView {...makeProps()} />);
    resizeTo(720);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).toBeNull();
    resizeTo(721);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).not.toBeNull();
    resizeTo(390);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).toBeNull();
  });

  it('uses the latest mobile prop before and after resize events', () => {
    resizeTo(1024);
    const props = makeProps();
    const view = render(<MessageListView {...props} mobile={false} />);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).not.toBeNull();
    view.rerender(<MessageListView {...props} mobile />);
    resizeTo(1280);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).toBeNull();
    view.rerender(<MessageListView {...props} mobile={false} />);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).not.toBeNull();
    resizeTo(430);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).toBeNull();
  });

  it('still exposes bulk selection in mobile mode when messages are selected', () => {
    render(<MessageListView {...makeProps({ mobile: true, selectedMessageIds: [message.id] })} />);
    resizeTo(932);
    expect(screen.queryByRole('checkbox', { name: '选择当前筛选结果中的全部邮件' })).not.toBeNull();
  });
});

describe('MessageListView pull gesture cancellation', () => {
  it('does not refresh when the browser cancels a pull above the threshold', () => {
    const props = makeProps();
    render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    fireEvent.touchCancel(list, { touches: [], changedTouches: [touch(160)] });
    expect(screen.queryByText('释放立即刷新')).toBeNull();
    expect(screen.queryByText('正在同步…')).toBeNull();
    releasePull(list);
    expect(props.onRefresh).not.toHaveBeenCalled();
    armPull(list);
    releasePull(list);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes once for a completed single-finger pull', () => {
    const props = makeProps();
    render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    releasePull(list);
    releasePull(list);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('正在同步…')).not.toBeNull();
  });

  it('does not refresh when a pull is released below the threshold', () => {
    const props = makeProps();
    render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    fireEvent.touchStart(list, { touches: [touch(10)] });
    fireEvent.touchMove(list, { touches: [touch(25)] });
    releasePull(list);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText('下拉刷新')).toBeNull();
  });

  it.each(['touchStart', 'touchMove'] as const)('cancels an armed pull on multi-touch %s', (phase) => {
    const props = makeProps();
    render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    fireEvent[phase](list, { touches: [touch(160), touch(180, 2)] });
    fireEvent.touchMove(list, { touches: [touch(200)] });
    releasePull(list);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText('释放立即刷新')).toBeNull();
  });

  it.each(['touchStart', 'touchMove'] as const)('handles an empty touch list during %s', (phase) => {
    const props = makeProps();
    render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    fireEvent[phase](list, { touches: [] });
    releasePull(list);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText('释放立即刷新')).toBeNull();
  });

  it('discards a pending pull when the mailbox context changes', () => {
    const props = makeProps();
    const onNextRefresh = vi.fn();
    const view = render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    view.rerender(<MessageListView {...props} listStateKey="account-2-inbox" onRefresh={onNextRefresh} />);
    releasePull(list);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(onNextRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText('释放立即刷新')).toBeNull();
  });

  it('does not resurrect a pending pull after leaving and reentering the mobile layout', () => {
    const props = makeProps();
    render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    resizeTo(1024);
    resizeTo(430);
    releasePull(list);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText('释放立即刷新')).toBeNull();
  });

  it('rechecks that the list is at the top before refreshing', () => {
    const props = makeProps();
    render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    list.scrollTop = 50;
    releasePull(list);
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(screen.queryByText('释放立即刷新')).toBeNull();
  });

  it('does not cancel the feedback for an already submitted refresh', () => {
    const props = makeProps();
    render(<MessageListView {...props} />);
    const list = screen.getByRole('list', { name: '邮件列表' });
    armPull(list);
    releasePull(list);
    fireEvent.touchCancel(list, { touches: [] });
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('正在同步…')).not.toBeNull();
  });
});

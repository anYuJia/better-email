import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import MessageListPane, { type MessageListPaneProps } from './MessageListPane';
import type { MessageSummary } from '../app/types';

afterEach(cleanup);

const message: MessageSummary = {
  id: 1, account_id: 1, account_email: 'demo@example.com', folder_id: 1, folder_role: 'inbox',
  sender_name: 'Team', sender_email: 'team@example.com', recipients: 'demo@example.com', cc: '', bcc: '',
  subject: 'Budget', snippet: 'Planning', security_warnings: [], received_at: '2026-08-20T08:00:00Z',
  is_read: false, is_starred: false, has_attachments: false, snoozed_until: '', labels: [],
  attachment_count: 0, remote_mailbox: 'INBOX', remote_uid: 1,
};

function props(): MessageListPaneProps {
  return {
    mobile: true, appliedQuery: '季度预算', filter: 'unread', listMode: 'messages', listSort: 'newest',
    selectedMessageIds: [], selectedMessages: [], folders: [], labels: [], threads: [], activeThread: null,
    messages: [], selectedId: null, hasMoreMessages: false, currentViewLabel: '收件箱',
    visibleListSummary: '0 封', messageListSummary: '0 封', listStateKey: 'folder-search', initialScrollTop: 0,
    onScrollTopChange: vi.fn(), onClearSearchAndFilter: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined),
    onShowMessages: vi.fn(), onShowThreads: vi.fn(), onFilterChange: vi.fn(), onSortChange: vi.fn(),
    onToggleAllVisible: vi.fn(), onRunBulkAction: vi.fn(), onRequestSnooze: vi.fn(), onMoveBulkToFolder: vi.fn(),
    onToggleBulkLabel: vi.fn(), onRunMessageAction: vi.fn(), onMoveMessageToFolder: vi.fn(),
    onToggleMessageLabel: vi.fn(), onComposeFromMessage: vi.fn(), onOpenThread: vi.fn().mockResolvedValue([]),
    onRunThreadAction: vi.fn(), onMoveThreadToFolder: vi.fn(), onToggleThreadLabel: vi.fn(),
    onToggleThreadMute: vi.fn(), onSelectMessage: vi.fn(), onToggleMessageSelection: vi.fn(),
    onLoadMore: vi.fn().mockResolvedValue([]), onExpandSearch: vi.fn(),
  };
}

describe('empty search recovery', () => {
  it.each([false, true])('offers an explicit expansion while preserving other recovery actions (mobile=%s)', mobile => {
    const input = { ...props(), mobile };
    render(<MessageListPane {...input} />);
    expect(screen.getByText('当前搜索范围内没有匹配邮件，可以扩大范围继续查找。')).toBeDefined();
    const expand = screen.getByRole('button', { name: '在全部账号中搜索' });
    expand.focus();
    fireEvent.click(expand);
    expect(input.onExpandSearch).toHaveBeenCalledTimes(1);
    expect(input.onClearSearchAndFilter).not.toHaveBeenCalled();
    expect(input.onFilterChange).not.toHaveBeenCalled();
    expect(input.onRefresh).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('region', { name: '邮件列表区域' }));
    fireEvent.click(screen.getByRole('button', { name: '清空搜索和筛选' }));
    expect(input.onClearSearchAndFilter).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '刷新邮箱' }));
    expect(input.onRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('keeps focus in the persistent pane across loading and new results (mobile=%s)', mobile => {
    const input = { ...props(), mobile };
    const view = render(<MessageListPane {...input} />);
    screen.getByRole('button', { name: '在全部账号中搜索' }).focus();
    fireEvent.click(document.activeElement!);
    const pane = screen.getByRole('region', { name: '邮件列表区域' });
    view.rerender(<MessageListPane {...input} onExpandSearch={undefined} mailboxUnavailable mailboxPending />);
    expect(screen.queryByRole('button', { name: '在全部账号中搜索' })).toBeNull();
    expect(document.activeElement).toBe(pane);
    view.rerender(<MessageListPane {...input} onExpandSearch={undefined} listStateKey="all-search" messages={[message]} selectedId={message.id} />);
    expect(document.activeElement).toBe(pane);
    expect(screen.getByRole('button', { name: /查看邮件：Team/ }).tabIndex).toBe(0);
    expect(pane.tabIndex).toBe(-1);
  });

  it('does not offer expansion for an empty query, already widest scope, or nonempty results', () => {
    const input = props();
    const view = render(<MessageListPane {...input} appliedQuery="  " />);
    expect(screen.queryByRole('button', { name: '在全部账号中搜索' })).toBeNull();
    view.rerender(<MessageListPane {...input} onExpandSearch={undefined} />);
    expect(screen.queryByRole('button', { name: '在全部账号中搜索' })).toBeNull();
    expect(screen.getByRole('button', { name: '清空搜索和筛选' })).toBeDefined();
    view.rerender(<MessageListPane {...input} messages={[message]} />);
    expect(screen.queryByRole('button', { name: '在全部账号中搜索' })).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MessageSummary } from '../app/types';
import GlobalSearch from './GlobalSearch';
import MessageListToolbar from './MessageListToolbar';

afterEach(cleanup);

const message: MessageSummary = {
  id: 1,
  account_id: 1,
  account_email: 'demo@example.com',
  folder_id: 1,
  folder_role: 'inbox',
  sender_name: 'Security Team',
  sender_email: 'security@example.com',
  recipients: 'demo@example.com',
  cc: '',
  bcc: '',
  subject: 'Security checklist',
  snippet: 'Review the checklist',
  security_warnings: [],
  received_at: '2026-08-20T08:00:00.000Z',
  is_read: false,
  is_starred: false,
  has_attachments: false,
  snoozed_until: '',
  labels: [],
  attachment_count: 0,
  remote_mailbox: 'INBOX',
  remote_uid: 1,
};

function renderSearch() {
  const onQueryChange = vi.fn();
  const onApplySearchShortcut = vi.fn();
  const view = render(
    <GlobalSearch
      searchInputRef={{ current: null }}
      query="Security"
      appliedQuery=""
      searchScope="folder"
      filter="all"
      messages={[message]}
      shortcutLabel="⌘K"
      onSearchSubmit={vi.fn()}
      onQueryChange={onQueryChange}
      onSearchScopeChange={vi.fn()}
      onClearSearchAndFilter={vi.fn()}
      onApplySearchShortcut={onApplySearchShortcut}
    />,
  );
  return { ...view, onQueryChange, onApplySearchShortcut };
}

function renderToolbar(selectedMessageIds: number[] = []) {
  return render(
    <MessageListToolbar
      filter="all"
      listMode="messages"
      listSort="newest"
      currentViewLabel="收件箱"
      visibleListSummary="40 封"
      messageListSummary="40 封 · 8 未读"
      onShowMessages={vi.fn()}
      onShowThreads={vi.fn()}
      onFilterChange={vi.fn()}
      onSortChange={vi.fn()}
      visibleMessageCount={40}
      selectedMessageIds={selectedMessageIds}
      selectedMessages={selectedMessageIds.length > 0 ? [message] : []}
      folders={[]}
      labels={[]}
      onToggleAllVisible={vi.fn()}
      onRunBulkAction={vi.fn()}
      onRequestSnooze={vi.fn()}
      onMoveBulkToFolder={vi.fn()}
      onToggleBulkLabel={vi.fn()}
    />,
  );
}

describe('GlobalSearch search combobox', () => {
  it('owns its suggestion list and accepts the active option with the keyboard', () => {
    const { onApplySearchShortcut } = renderSearch();
    const input = screen.getByRole('combobox', { name: '搜索主题、发件人、正文' });

    expect(input.getAttribute('aria-expanded')).toBe('false');
    act(() => input.focus());
    const listbox = screen.getByRole('listbox', { name: '搜索建议' });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(`${listbox.id}-all`);
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onApplySearchShortcut).toHaveBeenCalledWith('Security');
  });

  it('closes suggestions with Escape without moving focus', () => {
    renderSearch();
    const input = screen.getByRole('combobox', { name: '搜索主题、发件人、正文' });
    act(() => input.focus());
    expect(screen.getByRole('listbox')).toBeDefined();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('keeps the list header free of the legacy view menu', () => {
    renderSearch();
    expect(document.querySelector('.view-menu')).toBeNull();
  });
});

describe('Inbox toolbar selection mode', () => {
  it('keeps tabs separate from the labeled filter and sort triggers', () => {
    const onFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const view = render(
      <MessageListToolbar
        filter="all"
        listMode="messages"
        listSort="newest"
        currentViewLabel="收件箱"
        visibleListSummary="40 封"
        messageListSummary="40 封 · 8 未读"
        onShowMessages={vi.fn()}
        onShowThreads={vi.fn()}
        onFilterChange={onFilterChange}
        onSortChange={onSortChange}
        visibleMessageCount={40}
        selectedMessageIds={[]}
        selectedMessages={[]}
        folders={[]}
        labels={[]}
        onToggleAllVisible={vi.fn()}
        onRunBulkAction={vi.fn()}
        onRequestSnooze={vi.fn()}
        onMoveBulkToFolder={vi.fn()}
        onToggleBulkLabel={vi.fn()}
      />,
    );

    expect(view.container.querySelector('.list-control-tabs')).not.toBeNull();
    expect(view.container.querySelector('.list-control-menus')).not.toBeNull();
    expect(view.getByRole('button', { name: '筛选邮件，当前：全部' })).toBeDefined();
    expect(view.getByRole('button', { name: '邮件排序，当前：时间' })).toBeDefined();

    fireEvent.click(view.getByRole('button', { name: '筛选邮件，当前：全部' }));
    fireEvent.click(view.getByRole('menuitemradio', { name: '未读' }));
    expect(onFilterChange).toHaveBeenCalledWith('unread');

    fireEvent.click(view.getByRole('button', { name: '邮件排序，当前：时间' }));
    fireEvent.click(view.getByRole('menuitemradio', { name: '最早优先' }));
    expect(onSortChange).toHaveBeenCalledWith('oldest');
  });

  it('replaces the second control row in place without adding a toolbar row', () => {
    const view = renderToolbar();
    const strip = view.container.querySelector('.list-control-strip');
    const row = view.container.querySelector('.list-control-row');

    expect(strip?.getAttribute('data-toolbar-mode')).toBe('normal');
    expect(strip?.getAttribute('data-toolbar-height')).toBe('96');
    expect(row?.querySelector('.list-control-actions')).not.toBeNull();
    expect(row?.querySelector('.bulk-toolbar')).toBeNull();

    view.rerender(
      <MessageListToolbar
        filter="all"
        listMode="messages"
        listSort="newest"
        currentViewLabel="收件箱"
        visibleListSummary="40 封"
        messageListSummary="40 封 · 8 未读"
        onShowMessages={vi.fn()}
        onShowThreads={vi.fn()}
        onFilterChange={vi.fn()}
        onSortChange={vi.fn()}
        visibleMessageCount={40}
        selectedMessageIds={[message.id]}
        selectedMessages={[message]}
        folders={[]}
        labels={[]}
        onToggleAllVisible={vi.fn()}
        onRunBulkAction={vi.fn()}
        onRequestSnooze={vi.fn()}
        onMoveBulkToFolder={vi.fn()}
        onToggleBulkLabel={vi.fn()}
      />,
    );

    const selectedStrip = view.container.querySelector('.list-control-strip');
    expect(selectedStrip).toBe(strip);
    expect(selectedStrip?.getAttribute('data-toolbar-mode')).toBe('selection');
    expect(selectedStrip?.getAttribute('data-toolbar-height')).toBe('96');
    expect(view.container.querySelector('.list-control-row')?.querySelector('.bulk-toolbar')).not.toBeNull();
    expect(view.container.querySelector('.list-control-row')?.querySelector('.list-control-actions')).toBeNull();
    expect(screen.getByRole('button', { name: '归档选中的邮件' })).toBeDefined();
    expect(screen.getByRole('button', { name: '删除选中的邮件' })).toBeDefined();
    expect(screen.getByRole('button', { name: '更多批量操作，已选 1 封' })).toBeDefined();
  });

  it('keeps the bulk selection affordance keyboard and Escape friendly', () => {
    const onToggleAllVisible = vi.fn();
    const view = render(
      <MessageListToolbar
        filter="all"
        listMode="messages"
        listSort="newest"
        currentViewLabel="收件箱"
        visibleListSummary="40 封"
        messageListSummary="40 封 · 8 未读"
        onShowMessages={vi.fn()}
        onShowThreads={vi.fn()}
        onFilterChange={vi.fn()}
        onSortChange={vi.fn()}
        visibleMessageCount={40}
        selectedMessageIds={[message.id]}
        selectedMessages={[message]}
        folders={[]}
        labels={[]}
        onToggleAllVisible={onToggleAllVisible}
        onRunBulkAction={vi.fn()}
        onRequestSnooze={vi.fn()}
        onMoveBulkToFolder={vi.fn()}
        onToggleBulkLabel={vi.fn()}
      />,
    );
    const checkbox = view.getByRole('checkbox', { name: '选择当前列表中的全部邮件' });
    fireEvent.click(checkbox);
    expect(onToggleAllVisible).toHaveBeenCalledWith(true);

    const summary = view.getByRole('button', { name: '更多批量操作，已选 1 封' });
    fireEvent.click(summary);
    expect(summary.closest('details')?.hasAttribute('open')).toBe(true);
    fireEvent.keyDown(summary, { key: 'Escape' });
    expect(summary.closest('details')?.hasAttribute('open')).toBe(false);
  });
});

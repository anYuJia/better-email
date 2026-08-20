import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MessageSummary } from '../app/types';
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

function renderToolbar() {
  const onQueryChange = vi.fn();
  const onApplySearchShortcut = vi.fn();
  const view = render(
    <MessageListToolbar
      searchInputRef={{ current: null }}
      query="Security"
      appliedQuery=""
      searchScope="folder"
      filter="all"
      listMode="messages"
      listSort="newest"
      currentViewLabel="收件箱"
      visibleListSummary="1 封"
      messageListSummary="1 封"
      messages={[message]}
      onSearchSubmit={vi.fn()}
      onQueryChange={onQueryChange}
      onSearchScopeChange={vi.fn()}
      onClearSearchAndFilter={vi.fn()}
      onApplySearchShortcut={onApplySearchShortcut}
      onRefresh={vi.fn()}
      onShowMessages={vi.fn()}
      onShowThreads={vi.fn()}
      onFilterChange={vi.fn()}
      onSortChange={vi.fn()}
    />,
  );
  return { ...view, onQueryChange, onApplySearchShortcut };
}

describe('MessageListToolbar search combobox', () => {
  it('owns its suggestion list and accepts the active option with the keyboard', () => {
    const { onApplySearchShortcut } = renderToolbar();
    const input = screen.getByRole('combobox', { name: '搜索主题、发件人、正文' });

    expect(input.getAttribute('aria-expanded')).toBe('false');
    act(() => input.focus());
    const listbox = screen.getByRole('listbox', { name: '搜索范围选项' });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(`${listbox.id}-all`);
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onApplySearchShortcut).toHaveBeenCalledWith('Security');
  });

  it('closes suggestions with Escape without moving focus', () => {
    renderToolbar();
    const input = screen.getByRole('combobox', { name: '搜索主题、发件人、正文' });
    act(() => input.focus());
    expect(screen.getByRole('listbox')).toBeDefined();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(input);
  });
});

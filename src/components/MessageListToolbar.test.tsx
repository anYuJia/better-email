import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MessageSummary } from '../app/types';
import GlobalSearch from './GlobalSearch';

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

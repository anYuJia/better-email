import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import MobileInboxHeader from './MobileInboxHeader';

afterEach(cleanup);

const baseProps: ComponentProps<typeof MobileInboxHeader> = {
  currentViewLabel: '收件箱',
  visibleListSummary: '12 封',
  query: '',
  filter: 'attachments',
  listMode: 'messages',
  isRefreshing: false,
  onOpenMailbox: vi.fn(),
  onOpenSearch: vi.fn(),
  onCloseSearch: vi.fn(),
  onRefresh: vi.fn(),
  onSearchSubmit: vi.fn(),
  onQueryChange: vi.fn(),
  onClearSearchAndFilter: vi.fn(),
  onFilterChange: vi.fn(),
  onShowMessages: vi.fn(),
  onShowThreads: vi.fn(),
  searchOpen: false,
};

describe('MobileInboxHeader filter menu', () => {
  it('keeps filters behind one compact menu instead of a persistent tab row', () => {
    render(<MobileInboxHeader {...baseProps} />);

    expect(document.querySelector('.mobile-inbox-filter-row')).toBeNull();
    expect(screen.getByText('12 封 · 附件')).toBeTruthy();

    const trigger = screen.getByRole('button', { name: '筛选和列表，当前：附件' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: '全部' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '未读' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '星标' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: '附件' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitemradio', { name: '附件' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
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
  it('offers manual refresh before any sync error occurs and blocks duplicate refresh', () => {
    const onRefresh = vi.fn();
    const view = render(<MobileInboxHeader {...baseProps} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: '筛选和列表，当前：附件' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '刷新邮件' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    view.rerender(<MobileInboxHeader {...baseProps} isRefreshing onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: '筛选和列表，当前：附件' }));
    expect((screen.getByRole('menuitem', { name: '正在刷新邮件…' }) as HTMLButtonElement).disabled).toBe(true);
  });
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

function MobileSearchHarness() {
  const [query, setQuery] = useState('项目资料');
  const [searchOpen, setSearchOpen] = useState(false);
  return <MobileInboxHeader {...baseProps} query={query} searchOpen={searchOpen}
    onOpenSearch={() => setSearchOpen(true)} onCloseSearch={() => setSearchOpen(false)}
    onQueryChange={setQuery} onClearSearchAndFilter={() => setQuery('')}
  />;
}

describe('MobileInboxHeader search focus', () => {
  it('keeps typing focus after clear and returns to the search action after closing', () => {
    render(<MobileSearchHarness />);
    fireEvent.click(screen.getByRole('button', { name: '搜索邮件' }));
    const input = screen.getByRole('searchbox');
    expect(document.activeElement).toBe(input);
    const clear = screen.getByRole('button', { name: '清空搜索' });
    clear.focus();
    fireEvent.click(clear);
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '关闭搜索' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '搜索邮件' }));
  });

  it('closes on Escape without letting an IME cancellation close search', () => {
    render(<MobileSearchHarness />);
    fireEvent.click(screen.getByRole('button', { name: '搜索邮件' }));
    const input = screen.getByRole('searchbox');
    expect(fireEvent.keyDown(input, { key: 'Escape', isComposing: true })).toBe(true);
    expect(screen.getByRole('searchbox')).toBe(input);
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '搜索邮件' }));
  });
});

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
  onClearSearch: vi.fn(),
  onFilterChange: vi.fn(),
  onShowMessages: vi.fn(),
  onShowThreads: vi.fn(),
  searchOpen: false,
};

describe('MobileInboxHeader filter menu', () => {
  it('announces the thread mode only once when the count already names conversations', () => {
    const view = render(<MobileInboxHeader {...baseProps} filter="all" accountScopeLabel="统一邮箱"
      listMode="threads" visibleListSummary="49 个会话" />);
    expect(screen.getByText('统一邮箱 · 49 个会话')).toBeDefined();
    expect(screen.queryByText('统一邮箱 · 49 个会话 · 会话')).toBeNull();
    expect(screen.getByRole('button', { name: '筛选和列表，当前：全部，会话列表' })).toBeDefined();
    view.rerender(<MobileInboxHeader {...baseProps} filter="all" accountScopeLabel="统一邮箱"
      listMode="threads" visibleListSummary="49 个会话" mailboxUnavailable mailboxPending />);
    expect(screen.getByText('统一邮箱 · 正在加载… · 会话')).toBeDefined();
    expect(screen.queryByText(/49 个会话/)).toBeNull();
  });

  it('offers touch selection before any message is selected and keeps an explicit exit', () => {
    const enter = vi.fn(), exit = vi.fn();
    const view = render(<MobileInboxHeader {...baseProps} onEnterSelection={enter} onExitSelection={exit} />);
    fireEvent.click(screen.getByRole('button', { name: '筛选和列表，当前：附件' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '选择邮件' }));
    expect(enter).toHaveBeenCalledOnce();
    view.rerender(<MobileInboxHeader {...baseProps} selectionMode selectedCount={0} onExitSelection={exit} />);
    expect(screen.getByText('已选 0 封')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '退出选择' }));
    expect(exit).toHaveBeenCalledOnce();
  });

  it('shows only the applied search after closing, with a reachable clear action', () => {
    const clear = vi.fn();
    render(<MobileInboxHeader {...baseProps} query="unsent draft" appliedQuery="Security"
      onClearSearch={clear} />);
    expect(screen.getByRole('button', { name: '搜索：Security' })).toBeDefined();
    expect(screen.queryByText('unsent draft')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清除当前搜索' }));
    expect(clear).toHaveBeenCalledOnce();
  });

  it('clears the filter without clearing the active search', () => {
    const clearSearch = vi.fn();
    const changeFilter = vi.fn();
    render(<MobileInboxHeader {...baseProps} appliedQuery="Security"
      onClearSearch={clearSearch} onFilterChange={changeFilter} />);
    fireEvent.click(screen.getByRole('button', { name: '清除筛选：附件' }));
    expect(changeFilter).toHaveBeenCalledWith('all');
    expect(clearSearch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '筛选和列表，当前：附件，搜索：Security' }));
  });

  it('does not associate an old count with the destination while loading or failed', () => {
    const view = render(<MobileInboxHeader {...baseProps} accountScopeLabel="新邮箱" currentViewLabel="废纸篓"
      mailboxUnavailable mailboxPending />);
    expect(screen.getByText('新邮箱 · 正在加载…')).toBeDefined();
    expect(screen.queryByText(/12 封/)).toBeNull();
    view.rerender(<MobileInboxHeader {...baseProps} mailboxUnavailable />);
    expect(screen.getByText('加载未完成')).toBeDefined();
  });
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
    expect(screen.getByText('12 封')).toBeTruthy();
    expect(screen.getByRole('button', { name: '清除筛选：附件' })).toBeDefined();

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
    onQueryChange={setQuery} onClearSearch={() => setQuery('')}
  />;
}

describe('MobileInboxHeader search focus', () => {
  it('returns focus to an existing search input after leaving touch selection', () => {
    const view = render(<MobileInboxHeader {...baseProps} searchOpen selectionMode />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '退出选择' }));
    view.rerender(<MobileInboxHeader {...baseProps} searchOpen selectionMode={false} />);
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });
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

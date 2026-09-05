import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Menu,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { filters } from '../../app/appConfig';
import type { FilterMode, ListMode } from '../../app/types';
import ContextMenu, { type ContextMenuItem } from '../ContextMenu';

type MobileInboxHeaderProps = {
  accountScopeLabel?: string;
  currentViewLabel: string;
  visibleListSummary: string;
  query: string;
  filter: FilterMode;
  listMode: ListMode;
  isRefreshing: boolean;
  refreshNotice?: string | null;
  onOpenMailbox: () => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onRefresh: () => void;
  onSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onQueryChange: (value: string) => void;
  onClearSearchAndFilter: () => void;
  onFilterChange: (filter: FilterMode) => void;
  onShowMessages: () => void;
  onShowThreads: () => void;
  searchOpen: boolean;
};

export default function MobileInboxHeader({
  accountScopeLabel,
  currentViewLabel,
  visibleListSummary,
  query,
  filter,
  listMode,
  isRefreshing,
  refreshNotice,
  onOpenMailbox,
  onOpenSearch,
  onCloseSearch,
  onRefresh,
  onSearchSubmit,
  onQueryChange,
  onClearSearchAndFilter,
  onFilterChange,
  onShowMessages,
  onShowThreads,
  searchOpen,
}: MobileInboxHeaderProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const filterMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus({ preventScroll: true });
  }, [searchOpen]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    onSearchSubmit(event);
    searchInputRef.current?.blur();
  }

  const activeFilter = filters.find((item) => item.id === filter) ?? filters[0];
  const hasNonDefaultView = filter !== 'all' || listMode !== 'messages';
  const secondarySummary = [
    accountScopeLabel,
    visibleListSummary,
    filter !== 'all' ? activeFilter.label : '',
    listMode === 'threads' ? '会话' : '',
  ].filter(Boolean).join(' · ');
  const filterMenuItems: ContextMenuItem[] = [
    ...filters.map((item) => ({
      id: `mobile-filter-${item.id}`,
      label: item.label,
      checked: filter === item.id,
      selectionRole: 'radio' as const,
      onSelect: () => onFilterChange(item.id),
    })),
    {
      id: 'mobile-list-mode-messages',
      label: '邮件列表',
      checked: listMode === 'messages',
      selectionRole: 'radio',
      separatorBefore: true,
      onSelect: onShowMessages,
    },
    {
      id: 'mobile-list-mode-threads',
      label: '会话列表',
      checked: listMode === 'threads',
      selectionRole: 'radio',
      onSelect: onShowThreads,
    },
  ];

  if (searchOpen) {
    return (
      <header className="mobile-inbox-header mobile-inbox-header--search" aria-label="搜索邮件">
        <button
          type="button"
          className="mobile-header-icon"
          aria-label="关闭搜索"
          onClick={onCloseSearch}
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </button>
        <form className="mobile-search-form" role="search" onSubmit={submitSearch}>
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            placeholder="搜索邮件"
            aria-label="搜索邮件"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
          />
          {query && (
            <button
              type="button"
              className="mobile-search-clear"
              aria-label="清空搜索"
              onClick={() => {
                onQueryChange('');
                onClearSearchAndFilter();
              }}
            >
              <X size={17} aria-hidden="true" />
            </button>
          )}
        </form>
      </header>
    );
  }

  return (
    <header className="mobile-inbox-header" aria-label="邮箱">
      <div className="mobile-inbox-title-row">
        <button
          type="button"
          className="mobile-header-icon"
          aria-label="打开邮箱导航"
          onClick={onOpenMailbox}
        >
          <Menu size={22} aria-hidden="true" />
        </button>
        <div className="mobile-inbox-title">
          <span className="mobile-inbox-title-copy">
            <strong>{currentViewLabel}</strong>
            <small>{secondarySummary}</small>
          </span>
        </div>
        <div className="mobile-inbox-actions">
          <button
            ref={filterMenuTriggerRef}
            type="button"
            className={`mobile-header-icon mobile-filter-trigger${hasNonDefaultView ? ' active' : ''}`}
            aria-label={`筛选和列表，当前：${activeFilter.label}${listMode === 'threads' ? '，会话列表' : ''}`}
            aria-haspopup="menu"
            aria-expanded={Boolean(filterMenu)}
            onClick={(event) => {
              if (filterMenu) {
                setFilterMenu(null);
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              setFilterMenu({ x: Math.max(8, bounds.right - 208), y: bounds.bottom + 4 });
            }}
          >
            <SlidersHorizontal size={19} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobile-header-icon"
            aria-label="搜索邮件"
            onClick={onOpenSearch}
          >
            <Search size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      {(isRefreshing || refreshNotice) && (
        <div className={`mobile-inbox-sync-bar${refreshNotice && !isRefreshing ? ' is-notice' : ''}`} role="status" aria-live="polite">
          {isRefreshing ? (
            <>
              <RefreshCw size={13} className="animate-spin" aria-hidden="true" />
              <span>{refreshNotice || '正在同步邮件…'}</span>
            </>
          ) : (
            <>
              <span>{refreshNotice}</span>
              <button type="button" className="mobile-sync-retry-btn" onClick={onRefresh}>
                重试
              </button>
            </>
          )}
        </div>
      )}
      {filterMenu && (
        <ContextMenu
          x={filterMenu.x}
          y={filterMenu.y}
          items={filterMenuItems}
          onClose={() => setFilterMenu(null)}
          closeIgnoreRef={filterMenuTriggerRef}
          className="mobile-inbox-filter-menu-surface"
          ariaLabel="邮件筛选和列表模式"
        />
      )}
    </header>
  );
}

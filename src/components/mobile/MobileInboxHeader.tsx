import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Menu,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { filters } from '../../app/appConfig';
import type { FilterMode, ListMode } from '../../app/types';

type MobileInboxHeaderProps = {
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
  const [showListModeMenu, setShowListModeMenu] = useState(false);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus({ preventScroll: true });
  }, [searchOpen]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    onSearchSubmit(event);
    searchInputRef.current?.blur();
  }

  const activeFilter = filters.find((item) => item.id === filter) ?? filters[0];

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
        <button type="button" className="mobile-inbox-title" onClick={onOpenMailbox}>
          <strong>{currentViewLabel}</strong>
          <span>{visibleListSummary}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        <div className="mobile-inbox-actions">
          <button
            type="button"
            className="mobile-header-icon"
            aria-label="搜索邮件"
            onClick={onOpenSearch}
          >
            <Search size={21} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobile-header-icon"
            aria-label={isRefreshing ? (refreshNotice || '正在同步邮件') : '刷新邮件'}
            aria-busy={isRefreshing}
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshCw size={19} aria-hidden="true" className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="mobile-inbox-filter-row" role="tablist" aria-label="邮件筛选">
        {filters.slice(0, 3).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? 'active' : ''}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
        <div className="mobile-inbox-filter-menu">
          <button
            type="button"
            className={filter === 'attachments' ? 'active' : ''}
            aria-label={`更多筛选，当前：${activeFilter.label}`}
            aria-expanded={showListModeMenu}
            onClick={() => setShowListModeMenu((current) => !current)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>{filter === 'attachments' ? '附件' : listMode === 'threads' ? '会话' : '更多'}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {showListModeMenu && (
            <div className="mobile-inbox-filter-popover" role="menu">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={filter === 'attachments'}
                onClick={() => {
                  onFilterChange('attachments');
                  setShowListModeMenu(false);
                }}
              >
                附件
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={listMode === 'messages'}
                onClick={() => {
                  onShowMessages();
                  setShowListModeMenu(false);
                }}
              >
                邮件列表
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={listMode === 'threads'}
                onClick={() => {
                  onShowThreads();
                  setShowListModeMenu(false);
                }}
              >
                会话列表
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

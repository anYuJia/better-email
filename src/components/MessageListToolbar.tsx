import React from 'react';
import {
  ChevronDown,
  Menu,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  filters,
  listSortOptions,
  searchScopeOptions,
} from '../app/appConfig';
import type {
  FilterMode,
  ListMode,
  ListSort,
  MessageSummary,
  SearchScope,
} from '../app/types';
import {
  buildMessageSearchEntries,
  buildMessageSearchSuggestions,
} from './messageListSearchSuggestions';
import { useDetailsMenu } from '../hooks/useDetailsMenu';

type MessageListToolbarProps = {
  searchInputRef: React.Ref<HTMLInputElement>;
  query: string;
  appliedQuery: string;
  searchScope: SearchScope;
  filter: FilterMode;
  listMode: ListMode;
  listSort: ListSort;
  currentViewLabel: string;
  visibleListSummary: string;
  messageListSummary: string;
  messages: MessageSummary[];
  isRefreshing?: boolean;
  refreshNotice?: string | null;
  onSearchSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onQueryChange: (value: string) => void;
  onSearchScopeChange: (scope: SearchScope) => void;
  onClearSearchAndFilter: () => void;
  onApplySearchShortcut: (query: string) => void;
  onRefresh: () => void;
  onShowMessages: () => void;
  onShowThreads: () => void;
  onFilterChange: (filter: FilterMode) => void;
  onSortChange: (sort: ListSort) => void;
  onOpenNavigation?: () => void;
};

export default function MessageListToolbar({
  searchInputRef,
  query,
  appliedQuery,
  searchScope,
  filter,
  listMode,
  listSort,
  currentViewLabel,
  visibleListSummary,
  messageListSummary,
  messages,
  isRefreshing = false,
  refreshNotice = null,
  onSearchSubmit,
  onQueryChange,
  onSearchScopeChange,
  onClearSearchAndFilter,
  onApplySearchShortcut,
  onRefresh,
  onShowMessages,
  onShowThreads,
  onFilterChange,
  onSortChange,
  onOpenNavigation,
}: MessageListToolbarProps) {
  const [searchFocused, setSearchFocused] = React.useState(false);
  const [activeSearchSuggestionIndex, setActiveSearchSuggestionIndex] = React.useState(-1);
  const searchBlurTimerRef = React.useRef<number | null>(null);
  const searchSuggestionListId = React.useId();
  const deferredQuery = React.useDeferredValue(query);
  const activeSearchScope = searchScopeOptions.find((item) => item.id === searchScope)
    ?? searchScopeOptions[0];
  const activeFilterLabel = filters.find((item) => item.id === filter)?.label ?? '全部';
  const activeSortLabel = listSortOptions.find((item) => item.id === listSort)?.label ?? '最新优先';
  const trimmedQuery = deferredQuery.trim();
  const searchEntries = React.useMemo(
    () => buildMessageSearchEntries(messages),
    [messages],
  );
  const searchSuggestions = React.useMemo(
    () => buildMessageSearchSuggestions(searchEntries, trimmedQuery),
    [searchEntries, trimmedQuery],
  );
  const searchScopeMenuRef = React.useRef<HTMLDetailsElement>(null);
  const viewMenuRef = React.useRef<HTMLDetailsElement>(null);
  const searchScopeMenu = useDetailsMenu(searchScopeMenuRef);
  const viewMenu = useDetailsMenu(viewMenuRef);
  const viewIsActive = filter !== 'all' || listSort !== 'newest';
  const viewLabel = filter !== 'all' ? activeFilterLabel : listSort !== 'newest' ? activeSortLabel : '视图';
  const showSearchSuggestions = searchFocused && trimmedQuery.length >= 1 && searchSuggestions.length > 0;
  const activeSearchSuggestion = activeSearchSuggestionIndex >= 0
    ? searchSuggestions[activeSearchSuggestionIndex]
    : null;

  function clearSearchBlurTimer() {
    if (searchBlurTimerRef.current === null) return;
    window.clearTimeout(searchBlurTimerRef.current);
    searchBlurTimerRef.current = null;
  }

  React.useEffect(() => () => {
    clearSearchBlurTimer();
  }, []);

  function applySuggestedSearch(nextQuery: string) {
    clearSearchBlurTimer();
    onApplySearchShortcut(nextQuery);
    setSearchFocused(false);
    setActiveSearchSuggestionIndex(-1);
  }

  return (
    <>
      <header className="toolbar">
        {onOpenNavigation && (
          <button
            type="button"
            className="narrow-navigation-button list-narrow-navigation"
            data-narrow-sidebar-open
            aria-label="打开邮箱和文件夹导航"
            onClick={onOpenNavigation}
          >
            <Menu size={18} aria-hidden="true" />
          </button>
        )}
        <div className="search-cluster">
          <form
            onSubmit={(event) => {
              setSearchFocused(false);
              onSearchSubmit(event);
            }}
            className="search-box"
          >
            <Search size={17} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => {
                setSearchFocused(true);
                setActiveSearchSuggestionIndex(-1);
                onQueryChange(event.target.value);
              }}
              onFocus={() => {
                clearSearchBlurTimer();
                setSearchFocused(true);
                setActiveSearchSuggestionIndex(-1);
              }}
              onBlur={() => {
                clearSearchBlurTimer();
                searchBlurTimerRef.current = window.setTimeout(() => {
                  searchBlurTimerRef.current = null;
                  setSearchFocused(false);
                }, 120);
              }}
              onKeyDown={(event) => {
                if (!showSearchSuggestions) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const direction = event.key === 'ArrowDown' ? 1 : -1;
                  setActiveSearchSuggestionIndex((current) => {
                    if (current < 0) return direction > 0 ? 0 : searchSuggestions.length - 1;
                    return (current + direction + searchSuggestions.length) % searchSuggestions.length;
                  });
                  return;
                }
                if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                  setActiveSearchSuggestionIndex(event.key === 'Home' ? 0 : searchSuggestions.length - 1);
                  return;
                }
                if (event.key === 'Enter' && activeSearchSuggestion) {
                  event.preventDefault();
                  applySuggestedSearch(activeSearchSuggestion.query);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setSearchFocused(false);
                  setActiveSearchSuggestionIndex(-1);
                }
              }}
              role="combobox"
              aria-label="搜索主题、发件人、正文"
              aria-haspopup="listbox"
              aria-autocomplete="list"
              aria-expanded={showSearchSuggestions}
              aria-controls={showSearchSuggestions ? searchSuggestionListId : undefined}
              aria-activedescendant={activeSearchSuggestion
                ? `${searchSuggestionListId}-${activeSearchSuggestion.id}`
                : undefined}
              placeholder="搜索主题、发件人、正文"
            />
            {(query.trim() || appliedQuery.trim() || filter !== 'all') && (
              <button type="button" className="search-clear-button" title="清空搜索和筛选" aria-label="清空搜索和筛选" onClick={onClearSearchAndFilter}>
                <X size={14} />
              </button>
            )}
            {showSearchSuggestions && (
              <div
                className="search-suggestion-panel"
                id={searchSuggestionListId}
                role="listbox"
                aria-label="搜索范围选项"
              >
                <span className="search-suggestion-title" aria-hidden="true">搜索范围</span>
                {searchSuggestions.map((item, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`${searchSuggestionListId}-${item.id}`}
                    key={item.id}
                    className={item.active || index === activeSearchSuggestionIndex ? 'active' : ''}
                    aria-selected={index === activeSearchSuggestionIndex}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSearchSuggestionIndex(index)}
                    onClick={() => applySuggestedSearch(item.query)}
                  >
                    <span>
                      <strong>{item.label}</strong>
                    </span>
                    <em>{item.count} 封</em>
                  </button>
                ))}
              </div>
            )}
          </form>
          <details className="compact-menu search-scope-menu" ref={searchScopeMenuRef}>
            <summary
              title={`搜索范围：${activeSearchScope.label}`}
              aria-label={`搜索范围：${activeSearchScope.label}`}
            >
              <span>{activeSearchScope.shortLabel}</span>
              <ChevronDown size={13} />
            </summary>
            <div>
              <span className="menu-section-title">搜索范围</span>
              {searchScopeOptions.map((item) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={item.id === searchScope}
                  className={item.id === searchScope ? 'active' : ''}
                  key={item.id}
                  onClick={(event) => {
                    onSearchScopeChange(item.id);
                    event.preventDefault();
                    searchScopeMenu.closeMenu();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </details>
        </div>
        <button
          className={isRefreshing ? 'refresh-text-button refreshing' : 'refresh-text-button'}
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} style={{ flexShrink: 0 }} />
          <span>
            {isRefreshing ? (refreshNotice || '正在获取...') : (refreshNotice || '获取新邮件')}
          </span>
        </button>
      </header>
      <div className="list-control-strip">
        <div className="list-summary">
          <strong>{currentViewLabel}</strong>
          <span>{listMode === 'messages' ? visibleListSummary : messageListSummary}</span>
          {searchScope !== 'folder' && <em className="search-scope-indicator">{activeSearchScope.label}</em>}
          {filter !== 'all' && <em>{activeFilterLabel}</em>}
        </div>
        <div className="list-control-actions">
          <button
            type="button"
            className={listMode === 'messages' ? 'active' : ''}
            aria-pressed={listMode === 'messages'}
            onClick={onShowMessages}
          >
            邮件
          </button>
          <button
            type="button"
            className={listMode === 'threads' ? 'active' : ''}
            aria-pressed={listMode === 'threads'}
            onClick={onShowThreads}
          >
            会话
          </button>
          <details className="compact-menu view-menu" ref={viewMenuRef}>
            <summary
              className={viewIsActive ? 'active' : ''}
              title={`筛选：${activeFilterLabel}；排序：${activeSortLabel}`}
              aria-label={`视图设置，当前筛选${activeFilterLabel}，排序${activeSortLabel}`}
            >
              <SlidersHorizontal size={15} />
              <span>{viewLabel}</span>
            </summary>
            <div>
              <span className="menu-section-title">筛选</span>
              {filters.map((item) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter === item.id}
                  key={item.id}
                  className={filter === item.id ? 'active' : ''}
                  onClick={() => {
                    onFilterChange(item.id);
                    viewMenu.closeMenu();
                  }}
                >
                  {item.label}
                </button>
              ))}
              <span className="menu-section-title">排序方式</span>
              {listSortOptions.map((item) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={listSort === item.id}
                  key={item.id}
                  className={listSort === item.id ? 'active' : ''}
                  onClick={() => {
                    onSortChange(item.id);
                    viewMenu.closeMenu();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
    </>
  );
}

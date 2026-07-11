import React from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  filters,
  listSortOptions,
  searchShortcuts,
  searchScopeOptions,
} from '../app/appConfig';
import type {
  FilterMode,
  ListMode,
  ListSort,
  Message,
  SearchScope,
} from '../app/types';

type SearchSuggestion = {
  id: 'to' | 'from' | 'attachment' | 'body';
  label: string;
  hint: string;
  count: number;
  query: string;
};

type MessageListToolbarProps = {
  searchInputRef: React.Ref<HTMLInputElement>;
  query: string;
  searchScope: SearchScope;
  filter: FilterMode;
  listMode: ListMode;
  listSort: ListSort;
  currentViewLabel: string;
  visibleListSummary: string;
  messageListSummary: string;
  messages: Message[];
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
};

export default function MessageListToolbar({
  searchInputRef,
  query,
  searchScope,
  filter,
  listMode,
  listSort,
  currentViewLabel,
  visibleListSummary,
  messageListSummary,
  messages,
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
}: MessageListToolbarProps) {
  const [searchFocused, setSearchFocused] = React.useState(false);
  const activeSearchScope = searchScopeOptions.find((item) => item.id === searchScope)
    ?? searchScopeOptions[0];
  const activeFilterLabel = filters.find((item) => item.id === filter)?.label ?? '全部';
  const activeSortLabel = listSortOptions.find((item) => item.id === listSort)?.label ?? '最新优先';
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const searchSuggestions = React.useMemo<SearchSuggestion[]>(() => {
    if (!normalizedQuery || normalizedQuery.includes(':')) return [];

    const includes = (value: string) => value.toLowerCase().includes(normalizedQuery);
    const countMatches = (predicate: (message: Message) => boolean) =>
      messages.reduce((count, message) => count + (predicate(message) ? 1 : 0), 0);

    return [
      {
        id: 'to',
        label: '收件人',
        hint: '收件人、抄送、密送',
        count: countMatches((message) => (
          includes(message.recipients) || includes(message.cc) || includes(message.bcc)
        )),
        query: `to:${trimmedQuery}`,
      },
      {
        id: 'from',
        label: '发件人',
        hint: '姓名或邮箱',
        count: countMatches((message) => includes(message.sender_name) || includes(message.sender_email)),
        query: `from:${trimmedQuery}`,
      },
      {
        id: 'attachment',
        label: '附件',
        hint: '附件名',
        count: countMatches((message) => message.has_attachments),
        query: `filename:${trimmedQuery}`,
      },
      {
        id: 'body',
        label: '内容',
        hint: '正文',
        count: countMatches((message) => includes(message.body) || includes(message.snippet)),
        query: `body:${trimmedQuery}`,
      },
    ];
  }, [messages, normalizedQuery, trimmedQuery]);
  const showSearchSuggestions = searchFocused && searchSuggestions.length > 0;

  function applySuggestedSearch(nextQuery: string) {
    onApplySearchShortcut(nextQuery);
    setSearchFocused(false);
  }

  return (
    <>
      <header className="toolbar">
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
              onChange={(event) => onQueryChange(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                window.setTimeout(() => setSearchFocused(false), 120);
              }}
              placeholder="搜索主题、发件人、正文"
            />
            {(query.trim() || filter !== 'all') && (
              <button type="button" className="search-clear-button" title="清空搜索和筛选" onClick={onClearSearchAndFilter}>
                <X size={14} />
              </button>
            )}
            {showSearchSuggestions && (
              <div className="search-suggestion-panel" role="listbox" aria-label="搜索建议">
                {searchSuggestions.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applySuggestedSearch(item.query)}
                  >
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.hint}</small>
                    </span>
                    <em>{item.count} 封</em>
                  </button>
                ))}
              </div>
            )}
          </form>
          <details className="compact-menu search-scope-menu">
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
                  className={item.id === searchScope ? 'active' : ''}
                  key={item.id}
                  onClick={(event) => {
                    onSearchScopeChange(item.id);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </details>
        </div>
        <details className="compact-menu search-options-menu">
          <summary title="搜索条件" aria-label="搜索条件">
            <SlidersHorizontal size={16} />
          </summary>
          <div>
            <span className="menu-section-title">快捷搜索</span>
            {searchShortcuts.map((item) => (
              <button type="button" key={item.label} onClick={() => onApplySearchShortcut(item.query)}>
                {item.label}
              </button>
            ))}
          </div>
        </details>
        <button className="icon-button" title="刷新" onClick={onRefresh}>
          <RefreshCw size={17} />
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
            onClick={onShowMessages}
          >
            邮件
          </button>
          <button
            type="button"
            className={listMode === 'threads' ? 'active' : ''}
            onClick={onShowThreads}
          >
            会话
          </button>
          <details className="compact-menu filter-menu">
            <summary className={filter !== 'all' ? 'active' : ''}>
              <SlidersHorizontal size={15} />
              {filter === 'all' ? '筛选' : activeFilterLabel}
            </summary>
            <div>
              {filters.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={filter === item.id ? 'active' : ''}
                  onClick={() => onFilterChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </details>
          <details className="compact-menu sort-menu">
            <summary className={listSort !== 'newest' ? 'active' : ''}>
              <ArrowDownUp size={15} />
              {activeSortLabel}
            </summary>
            <div>
              <span className="menu-section-title">排序方式</span>
              {listSortOptions.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={listSort === item.id ? 'active' : ''}
                  onClick={() => onSortChange(item.id)}
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

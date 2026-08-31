import React from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { searchScopeOptions } from '../app/appConfig';
import type { FilterMode, MessageSummary, SearchScope } from '../app/types';
import {
  buildMessageSearchEntries,
  buildMessageSearchSuggestions,
} from './messageListSearchSuggestions';
import { useDetailsMenu } from '../hooks/useDetailsMenu';
import { useWheelContainment } from '../hooks/useWheelContainment';

export type GlobalSearchProps = {
  searchInputRef: React.Ref<HTMLInputElement>;
  query: string;
  appliedQuery: string;
  searchScope: SearchScope;
  filter: FilterMode;
  messages: MessageSummary[];
  shortcutLabel: string;
  onSearchSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onQueryChange: (value: string) => void;
  onSearchScopeChange: (scope: SearchScope) => void;
  onClearSearchAndFilter: () => void;
  onApplySearchShortcut: (query: string) => void;
};

export default function GlobalSearch({
  searchInputRef,
  query,
  appliedQuery,
  searchScope,
  filter,
  messages,
  shortcutLabel,
  onSearchSubmit,
  onQueryChange,
  onSearchScopeChange,
  onClearSearchAndFilter,
  onApplySearchShortcut,
}: GlobalSearchProps) {
  const [searchFocused, setSearchFocused] = React.useState(false);
  const [activeSearchSuggestionIndex, setActiveSearchSuggestionIndex] = React.useState(-1);
  const searchBlurTimerRef = React.useRef<number | null>(null);
  const searchSuggestionListId = React.useId();
  const searchScopeMenuRef = React.useRef<HTMLDetailsElement>(null);
  const searchSuggestionPanelRef = React.useRef<HTMLDivElement>(null);
  const searchScopeMenu = useDetailsMenu(searchScopeMenuRef, { floating: true });
  const deferredQuery = React.useDeferredValue(query);
  const activeSearchScope = searchScopeOptions.find((item) => item.id === searchScope)
    ?? searchScopeOptions[0];
  const trimmedQuery = deferredQuery.trim();
  const searchEntries = React.useMemo(
    () => buildMessageSearchEntries(messages),
    [messages],
  );
  const searchSuggestions = React.useMemo(
    () => buildMessageSearchSuggestions(searchEntries, trimmedQuery),
    [searchEntries, trimmedQuery],
  );
  const showSearchSuggestions = searchFocused && trimmedQuery.length >= 1 && searchSuggestions.length > 0;
  useWheelContainment(searchSuggestionPanelRef, showSearchSuggestions);
  const activeSearchSuggestion = activeSearchSuggestionIndex >= 0
    ? searchSuggestions[activeSearchSuggestionIndex]
    : null;

  const clearSearchBlurTimer = React.useCallback(() => {
    if (searchBlurTimerRef.current === null) return;
    window.clearTimeout(searchBlurTimerRef.current);
    searchBlurTimerRef.current = null;
  }, []);

  React.useEffect(() => () => {
    clearSearchBlurTimer();
  }, [clearSearchBlurTimer]);

  function applySuggestedSearch(nextQuery: string) {
    clearSearchBlurTimer();
    onApplySearchShortcut(nextQuery);
    setSearchFocused(false);
    setActiveSearchSuggestionIndex(-1);
  }

  return (
    <form
      className="global-search-box search-box"
      onSubmit={(event) => {
        setSearchFocused(false);
        onSearchSubmit(event);
      }}
      role="search"
    >
      <Search size={16} aria-hidden="true" />
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
        <button
          type="button"
          className="search-clear-button"
          title="清空搜索和筛选"
          aria-label="清空搜索和筛选"
          onClick={onClearSearchAndFilter}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
      <details
        className="compact-menu search-scope-menu"
        ref={searchScopeMenuRef}
        data-floating-menu="true"
      >
        <summary
          title={`搜索范围：${activeSearchScope.label}`}
          aria-label={`搜索范围：${activeSearchScope.label}`}
        >
          <span>{activeSearchScope.shortLabel}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <div data-floating-menu-panel="true">
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
      <span className="global-search-shortcut" aria-hidden="true">{shortcutLabel}</span>
      {showSearchSuggestions && (
        <div
          ref={searchSuggestionPanelRef}
          className="search-suggestion-panel"
          id={searchSuggestionListId}
          role="listbox"
          aria-label="搜索建议"
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
  );
}

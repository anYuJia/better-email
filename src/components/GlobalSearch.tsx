import React from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { searchScopeOptions } from '../app/appConfig';
import type { MessageSummary, SearchScope } from '../app/types';
import {
  buildMessageSearchEntries,
  buildMessageSearchSuggestions,
} from './messageListSearchSuggestions';
import { useDetailsMenu } from '../hooks/useDetailsMenu';
import { useWheelContainment } from '../hooks/useWheelContainment';
import useCompositionGuard from '../hooks/useCompositionGuard';

export type GlobalSearchProps = {
  searchInputRef: React.Ref<HTMLInputElement>;
  query: string;
  appliedQuery: string;
  searchScope: SearchScope;
  messages: MessageSummary[];
  shortcutLabel: string;
  onSearchSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onQueryChange: (value: string) => void;
  onSearchScopeChange: (scope: SearchScope) => void;
  onClearSearch: () => void;
  onApplySearchShortcut: (query: string) => void;
};

export default function GlobalSearch({
  searchInputRef,
  query,
  appliedQuery,
  searchScope,
  messages,
  shortcutLabel,
  onSearchSubmit,
  onQueryChange,
  onSearchScopeChange,
  onClearSearch,
  onApplySearchShortcut,
}: GlobalSearchProps) {
  const ime = useCompositionGuard();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const setInputRef = React.useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    if (typeof searchInputRef === 'function') searchInputRef(input);
    else if (searchInputRef) (searchInputRef as React.MutableRefObject<HTMLInputElement | null>).current = input;
  }, [searchInputRef]);
  const scopeHintId = React.useId();
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
  const activeSearchSuggestion = showSearchSuggestions && activeSearchSuggestionIndex >= 0
    ? searchSuggestions[activeSearchSuggestionIndex]
    : null;

  React.useLayoutEffect(() => {
    if (!activeSearchSuggestion) return;
    const panel = searchSuggestionPanelRef.current;
    const option = panel?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!panel || !option) return;
    const bounds = panel.getBoundingClientRect();
    const item = option.getBoundingClientRect();
    if (item.bottom > bounds.bottom) panel.scrollTop += item.bottom - bounds.bottom + 4;
    else if (item.top < bounds.top) panel.scrollTop -= bounds.top - item.top + 4;
  }, [activeSearchSuggestion]);

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
        if (ime.isComposing()) { event.preventDefault(); return; }
        setSearchFocused(false);
        setActiveSearchSuggestionIndex(-1);
        onSearchSubmit(event);
      }}
      role="search"
    >
      <Search size={16} aria-hidden="true" />
      <input
        ref={setInputRef}
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
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        aria-describedby={scopeHintId}
        onKeyDown={(event) => {
          if (ime.isComposing(event)) return;
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
          if ((event.key === 'Home' || event.key === 'End') && activeSearchSuggestion) {
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
        placeholder="搜索邮件"
      />
      {(query.trim() || appliedQuery.trim()) && (
        <button
          type="button"
          className="search-clear-button"
          title="清空搜索"
          aria-label="清空搜索"
          onClick={() => {
            onClearSearch();
            inputRef.current?.focus({ preventScroll: true });
          }}
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
          <p className="search-local-scope-hint">仅搜索已同步到本机的邮件；缺少邮件时请先刷新。</p>
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
      <span className="sr-only" id={scopeHintId}>{activeSearchScope.label}，仅搜索已同步到本机的邮件。</span>
      <span className="global-search-shortcut" aria-hidden="true">{shortcutLabel}</span>
      {showSearchSuggestions && (
        <div
          ref={searchSuggestionPanelRef}
          className="search-suggestion-panel"
          id={searchSuggestionListId}
          role="listbox"
          aria-label="搜索建议"
        >
          <span className="search-suggestion-title" aria-hidden="true">搜索方式</span>
          {searchSuggestions.map((item, index) => (
            <button
              type="button"
              role="option"
              id={`${searchSuggestionListId}-${item.id}`}
              key={item.id}
              className={index === activeSearchSuggestionIndex ? 'active' : ''}
              aria-selected={index === activeSearchSuggestionIndex}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySuggestedSearch(item.query)}
            >
              <span>
                <strong>{item.label}</strong>
              </span>
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

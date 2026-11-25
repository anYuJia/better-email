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

const QUICK_FILTER_CHIPS = [
  { id: 'has-attachment', label: '含附件', syntax: 'has:attachment' },
  { id: 'is-unread', label: '未读邮件', syntax: 'is:unread' },
  { id: 'is-starred', label: '星标邮件', syntax: 'is:starred' },
  { id: 'from', label: '发件人', syntax: 'from:' },
].map((chip) => ({
  ...chip,
  query: chip.syntax.endsWith(':') ? chip.syntax : `${chip.syntax} `,
}));

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
  const showQuickChips = searchFocused && trimmedQuery.length === 0;
  const showSearchSuggestions = searchFocused && trimmedQuery.length >= 1 && searchSuggestions.length > 0;
  const showSearchPanel = showSearchSuggestions || showQuickChips;
  useWheelContainment(searchSuggestionPanelRef, showSearchPanel);
  const options = trimmedQuery.length === 0 ? QUICK_FILTER_CHIPS : searchSuggestions;
  const activeSearchSuggestion = showSearchPanel ? options[activeSearchSuggestionIndex] : null;

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

  function applySuggestedSearch(nextQuery: string) {
    inputRef.current?.focus({ preventScroll: true });
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
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setSearchFocused(false);
        setActiveSearchSuggestionIndex(-1);
      }}
      onKeyDown={(event) => {
        if (ime.isComposing(event) || searchScopeMenuRef.current?.open) return;
        if (event.key === 'Escape' && showSearchPanel) {
          event.preventDefault();
          event.stopPropagation();
          inputRef.current?.focus({ preventScroll: true });
          setSearchFocused(false);
          setActiveSearchSuggestionIndex(-1);
          return;
        }
        const fromInput = event.target === inputRef.current;
        if (!fromInput && !searchSuggestionPanelRef.current?.contains(event.target as Node)) return;
        const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
        if (!showSearchPanel) {
          if (arrow && options.length > 0) {
            event.preventDefault();
            setSearchFocused(true);
            setActiveSearchSuggestionIndex(event.key === 'ArrowDown' ? 0 : options.length - 1);
          }
          return;
        }
        if (arrow || (activeSearchSuggestion && (event.key === 'Home' || event.key === 'End'))) {
          event.preventDefault();
          let next = event.key === 'Home' ? 0 : options.length - 1;
          if (arrow) {
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            next = activeSearchSuggestionIndex < 0
              ? (direction > 0 ? 0 : options.length - 1)
              : (activeSearchSuggestionIndex + direction + options.length) % options.length;
          }
          if (!fromInput) inputRef.current?.focus({ preventScroll: true });
          setActiveSearchSuggestionIndex(next);
        } else if (event.key === 'Enter' && fromInput && activeSearchSuggestion) {
          event.preventDefault();
          applySuggestedSearch(activeSearchSuggestion.query);
        }
      }}
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
          setSearchFocused(true);
          setActiveSearchSuggestionIndex(-1);
        }}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        aria-describedby={scopeHintId}
        role="combobox"
        aria-label="搜索主题、发件人、正文"
        aria-haspopup="listbox"
        aria-autocomplete="list"
        aria-expanded={showSearchPanel}
        aria-controls={showSearchPanel ? searchSuggestionListId : undefined}
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
        onToggle={(event) => {
          if (event.currentTarget.open) setSearchFocused(false);
        }}
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
      {showSearchPanel && (
        <div
          ref={searchSuggestionPanelRef}
          className={`search-suggestion-panel${showQuickChips ? ' search-quick-chips-panel' : ''}`}
          id={searchSuggestionListId}
          role="listbox"
          aria-label={showQuickChips ? '快速筛选' : '搜索建议'}
        >
          <span className="search-suggestion-title" aria-hidden="true">{showQuickChips ? '快捷语法过滤' : '搜索方式'}</span>
          <div className={showQuickChips ? 'search-quick-chips' : 'search-suggestion-options'} role="presentation">
            {options.map((item, index) => (
              <button
                type="button"
                role="option"
                id={`${searchSuggestionListId}-${item.id}`}
                key={item.id}
                className={[showQuickChips && 'search-quick-chip', index === activeSearchSuggestionIndex && 'active'].filter(Boolean).join(' ')}
                aria-selected={index === activeSearchSuggestionIndex}
                tabIndex={showQuickChips ? 0 : -1}
                onFocus={() => setActiveSearchSuggestionIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySuggestedSearch(item.query)}
              >
                {showQuickChips ? <>
                  <span className="search-chip-label">{item.label}</span>
                  <code className="search-chip-syntax">{QUICK_FILTER_CHIPS[index].syntax}</code>
                </> : <span><strong>{item.label}</strong></span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}

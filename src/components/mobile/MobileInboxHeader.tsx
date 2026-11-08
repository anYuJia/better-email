import useCompositionGuard from '../../hooks/useCompositionGuard';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ListChecks,
  Menu,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { filters } from '../../app/appConfig';
import type { FilterMode, ListMode } from '../../app/types';
import { smtpUploadPercent } from '../../app/smtpUploadProgress';
import ContextMenu, { type ContextMenuItem } from '../ContextMenu';

type MobileInboxHeaderProps = {
  accountScopeLabel?: string;
  currentViewLabel: string;
  visibleListSummary: string;
  query: string;
  appliedQuery?: string;
  mailboxPending?: boolean;
  mailboxUnavailable?: boolean;
  selectionMode?: boolean;
  selectedCount?: number;
  canSelect?: boolean;
  onEnterSelection?: () => void;
  onExitSelection?: () => void;
  filter: FilterMode;
  listMode: ListMode;
  isRefreshing: boolean;
  refreshNotice?: string | null;
  sendStatus?: string | null;
  onOpenMailbox: () => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onRefresh: () => void;
  onSearchSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onQueryChange: (value: string) => void;
  onClearSearch: () => void;
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
  appliedQuery = '',
  mailboxPending = false,
  mailboxUnavailable = false,
  selectionMode = false,
  selectedCount = 0,
  canSelect = true,
  onEnterSelection,
  onExitSelection,
  filter,
  listMode,
  isRefreshing,
  refreshNotice,
  sendStatus,
  onOpenMailbox,
  onOpenSearch,
  onCloseSearch,
  onRefresh,
  onSearchSubmit,
  onQueryChange,
  onClearSearch,
  onFilterChange,
  onShowMessages,
  onShowThreads,
  searchOpen,
}: MobileInboxHeaderProps) {
  const ime = useCompositionGuard();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreSearchFocusRef = useRef(false);
  const selectionExitRef = useRef<HTMLButtonElement | null>(null);
  const restoreSelectionFocusRef = useRef(false);
  const filterMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (selectionMode) {
      restoreSelectionFocusRef.current = true;
      selectionExitRef.current?.focus({ preventScroll: true });
    }
    else if (restoreSelectionFocusRef.current) {
      restoreSelectionFocusRef.current = false;
      (searchOpen ? searchInputRef.current : filterMenuTriggerRef.current)?.focus({ preventScroll: true });
    }
  }, [selectionMode, searchOpen]);

  function exitSelection() {
    restoreSelectionFocusRef.current = true;
    onExitSelection?.();
  }

  useEffect(() => {
    if (searchOpen && !selectionMode) searchInputRef.current?.focus({ preventScroll: true });
    else if (restoreSearchFocusRef.current) {
      restoreSearchFocusRef.current = false;
      searchTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [searchOpen, selectionMode]);

  function closeSearch() {
    restoreSearchFocusRef.current = true;
    onCloseSearch();
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    if (ime.isComposing()) { event.preventDefault(); return; }
    onSearchSubmit(event);
    searchInputRef.current?.blur();
  }

  const activeFilter = filters.find((item) => item.id === filter) ?? filters[0];
  const hasFilter = filter !== 'all';
  const resultSummary = mailboxUnavailable ? (mailboxPending ? '正在加载…' : '加载未完成') : visibleListSummary;
  const secondarySummary = [
    accountScopeLabel,
    resultSummary,
    listMode === 'threads' && !resultSummary?.includes('会话') ? '会话' : '',
  ].filter(Boolean).join(' · ');
  const filterMenuItems: ContextMenuItem[] = [
    ...(onEnterSelection && listMode === 'messages' ? [{
      id: 'mobile-select', label: '选择邮件',
      icon: <ListChecks size={18} strokeWidth={1.75} aria-hidden="true" />,
      disabled: !canSelect || mailboxUnavailable,
      onSelect: onEnterSelection,
    }] : []),
    ...filters.map((item) => ({
      id: `mobile-filter-${item.id}`,
      label: item.label,
      checked: filter === item.id,
      selectionRole: 'radio' as const,
      separatorBefore: item === filters[0] && Boolean(onEnterSelection) && listMode === 'messages',
      onSelect: () => { if (item.id !== filter) onFilterChange(item.id); },
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
    {
      id: 'mobile-refresh',
      label: isRefreshing ? '正在刷新邮件…' : '刷新邮件',
      icon: <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" />,
      disabled: isRefreshing,
      separatorBefore: true,
      onSelect: onRefresh,
    },
  ];

  if (selectionMode) {
    return <header className="mobile-inbox-header" aria-label="选择邮件">
      <div className="mobile-inbox-title-row">
        <button ref={selectionExitRef} type="button" className="mobile-header-icon" aria-label="退出选择" onClick={exitSelection}>
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div className="mobile-inbox-title"><span className="mobile-inbox-title-copy">
          <strong aria-live="polite">已选 {selectedCount} 封</strong>
          <small>{currentViewLabel}</small>
        </span></div>
      </div>
    </header>;
  }

  if (searchOpen) {
    return (
      <header className="mobile-inbox-header mobile-inbox-header--search" aria-label="搜索邮件">
        <button
          type="button"
          className="mobile-header-icon"
          aria-label="关闭搜索"
          onClick={closeSearch}
        >
          <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <form className="mobile-search-form" role="search" onSubmit={submitSearch}>
          <Search size={20} strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            placeholder="搜索已同步邮件"
            aria-label="搜索邮件"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || ime.isComposing(event)) return;
              event.preventDefault();
              closeSearch();
            }}
          />
          {query && (
            <button
              type="button"
              className="mobile-search-clear"
              aria-label="清空搜索"
              onClick={() => {
                onQueryChange('');
                onClearSearch();
                searchInputRef.current?.focus({ preventScroll: true });
              }}
            >
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
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
          <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
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
            className={`mobile-header-icon mobile-filter-trigger${hasFilter ? ' active' : ''}`}
            aria-label={`筛选和列表，当前：${activeFilter.label}${listMode === 'threads' ? '，会话列表' : ''}${appliedQuery ? `，搜索：${appliedQuery}` : ''}`}
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
            <SlidersHorizontal size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            ref={searchTriggerRef}
            type="button"
            className={`mobile-header-icon${appliedQuery ? ' active' : ''}`}
            aria-label="搜索邮件"
            onClick={onOpenSearch}
          >
            <Search size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
      {(appliedQuery || hasFilter) && <div className="mobile-inbox-refinements" role="group" aria-label="当前搜索和筛选">
        {appliedQuery && <div className="mobile-active-search">
          <button type="button" className="mobile-active-search-query" onClick={onOpenSearch} title={appliedQuery}>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" /><span>搜索：{appliedQuery}</span>
          </button>
          <button type="button" className="mobile-header-icon" aria-label="清除当前搜索" onClick={() => {
            searchTriggerRef.current?.focus({ preventScroll: true });
            onClearSearch();
          }}>
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>}
        {hasFilter && <button type="button" className="mobile-clear-filter" aria-label={`清除筛选：${activeFilter.label}`} onClick={() => {
          filterMenuTriggerRef.current?.focus({ preventScroll: true });
          onFilterChange('all');
        }}>
          {activeFilter.label}<X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>}
      </div>}
      {(isRefreshing || refreshNotice) && (
        <div className={`mobile-inbox-sync-bar${refreshNotice && !isRefreshing ? ' is-notice' : ''}`} role="status" aria-live="polite">
          {isRefreshing ? (
            <>
              <RefreshCw size={16} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
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
      {sendStatus && (
        <div className="mobile-inbox-send-status" role="status" aria-live="polite">
          <span>{sendStatus}</span>
          {smtpUploadPercent(sendStatus) !== null && (
            <progress max={100} value={smtpUploadPercent(sendStatus) ?? undefined} aria-label="邮件上传进度" />
          )}
        </div>
      )}
      <ContextMenu menu={filterMenu ? {
        x: filterMenu.x, y: filterMenu.y, items: filterMenuItems,
        onClose: () => setFilterMenu(null), closeIgnoreRef: filterMenuTriggerRef,
        className: 'mobile-inbox-filter-menu-surface', ariaLabel: '邮件筛选和列表模式',
      } : null} />
    </header>
  );
}

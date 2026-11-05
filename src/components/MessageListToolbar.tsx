import React from 'react';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, ListFilter, Menu, X } from 'lucide-react';
import { filters, listSortOptions } from '../app/appConfig';
import type {
  FilterMode,
  Folder,
  Label,
  ListMode,
  ListSort,
  MessageSummary,
} from '../app/types';
import CompactDropdown from './CompactDropdown';
import MessageBulkToolbar from './MessageBulkToolbar';
import type { BulkMessageAction } from './messageContextMenu';

type MessageListToolbarProps = {
  filter: FilterMode;
  listMode: ListMode;
  listSort: ListSort;
  currentViewLabel: string;
  visibleListSummary: string;
  messageListSummary: string;
  onShowMessages: () => void;
  onShowThreads: () => void;
  onFilterChange: (filter: FilterMode) => void;
  onSortChange: (sort: ListSort) => void;
  selectedMessageIds: number[];
  selectedMessages: MessageSummary[];
  folders: Folder[];
  labels: Label[];
  onRunBulkAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: MessageSummary[]) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onToggleBulkLabel: (label: Label) => void;
  onOpenNavigation?: () => void;
  selectionControls?: React.ReactNode;
  onClearSelection?: () => void;
};

function sortTriggerLabel(sort: ListSort): string {
  if (sort === 'newest') return '最新优先';
  if (sort === 'oldest') return '最早优先';
  if (sort === 'sender') return '发件人';
  if (sort === 'subject') return '主题';
  return '最新优先';
}

function MessageListToolbar({
  filter,
  listMode,
  listSort,
  currentViewLabel,
  visibleListSummary,
  messageListSummary,
  onShowMessages,
  onShowThreads,
  onFilterChange,
  onSortChange,
  selectedMessageIds,
  selectedMessages,
  folders,
  labels,
  onRunBulkAction,
  onRequestSnooze,
  onMoveBulkToFolder,
  onToggleBulkLabel,
  onOpenNavigation,
  selectionControls,
  onClearSelection,
}: MessageListToolbarProps) {
  const controlRowRef = React.useRef<HTMLDivElement>(null);
  const activeFilterLabel = filters.find((item) => item.id === filter)?.label ?? '全部';
  const SortIcon = listSort === 'oldest' ? ArrowUpWideNarrow : ArrowDownWideNarrow;
  const isSelectionMode = listMode === 'messages' && selectedMessageIds.length > 0;
  const clearSelection = () => {
    controlRowRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
    onClearSelection?.();
  };

  return (
    <header
      className="list-control-strip"
      aria-label="邮件列表控制"
      data-toolbar-min-height="84"
      data-toolbar-mode={isSelectionMode ? 'selection' : 'normal'}
    >
      <div className="list-summary-row">
        {onOpenNavigation && (
          <button
            type="button"
            className="narrow-navigation-button list-narrow-navigation"
            data-narrow-sidebar-open
            aria-label="打开邮箱和文件夹导航"
            onClick={onOpenNavigation}
          >
            <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
        <div className="list-summary">
          <h2 className="list-folder-title" title={currentViewLabel}>{currentViewLabel}</h2>
          {filter !== 'all' && (isSelectionMode
            ? <span className="list-active-filter">{activeFilterLabel}</span>
            : <button
                type="button"
                className="list-active-filter list-clear-filter"
                aria-label={`清除筛选：${activeFilterLabel}`}
                title={`清除筛选：${activeFilterLabel}`}
                onClick={() => {
                  controlRowRef.current?.querySelector<HTMLElement>('.filter-menu > summary')?.focus({ preventScroll: true });
                  onFilterChange('all');
                }}
              >
                {activeFilterLabel}<X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>)}
          <span className="list-result-count" aria-live="polite">{isSelectionMode ? `已选 ${selectedMessageIds.length} 封`
            : listMode === 'messages' ? visibleListSummary : messageListSummary}</span>
        </div>
      </div>
      <div className={`list-control-row${isSelectionMode ? ' is-selection-mode' : ''}`} ref={controlRowRef}>
        {listMode === 'messages' && selectionControls}
        {isSelectionMode ? (
          <MessageBulkToolbar
            inline
            selectedMessageIds={selectedMessageIds}
            selectedMessages={selectedMessages}
            folders={folders}
            labels={labels}
            onRunBulkAction={onRunBulkAction}
            onRequestSnooze={onRequestSnooze}
            onMoveBulkToFolder={onMoveBulkToFolder}
            onToggleBulkLabel={onToggleBulkLabel}
            onClearSelection={onClearSelection ? clearSelection : undefined}
          />
        ) : (
          <div className="list-control-actions" aria-label="邮件显示模式">
            <div
              className="list-control-tabs"
              role="group"
              aria-label="邮件列表模式"
              data-active-mode={listMode}
            >
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
              <span className="list-control-tab-indicator" aria-hidden="true" />
            </div>
            <div className="list-control-menus" role="group" aria-label="邮件筛选和排序">
              <CompactDropdown
                className={`filter-menu${filter !== 'all' ? ' is-filtered' : ''}`}
                triggerIcon={<ListFilter size={18} strokeWidth={1.75} />}
                label="筛选"
                currentLabel={activeFilterLabel}
                ariaLabel={`筛选邮件，当前：${activeFilterLabel}`}
                value={filter}
                options={filters}
                onChange={onFilterChange}
              />
              <CompactDropdown
                className={`sort-menu${listSort !== 'newest' ? ' is-custom-sort' : ''}`}
                triggerIcon={<SortIcon size={18} strokeWidth={1.75} />}
                label="排序"
                currentLabel={sortTriggerLabel(listSort)}
                ariaLabel={`邮件排序，当前：${sortTriggerLabel(listSort)}`}
                value={listSort}
                options={listSortOptions}
                onChange={onSortChange}
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export default React.memo(MessageListToolbar);

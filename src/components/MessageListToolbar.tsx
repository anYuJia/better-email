import React from 'react';
import { Menu } from 'lucide-react';
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
  visibleMessageCount: number;
  selectedMessageIds: number[];
  selectedMessages: MessageSummary[];
  folders: Folder[];
  labels: Label[];
  onToggleAllVisible: (checked: boolean) => void;
  onRunBulkAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: MessageSummary[]) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onToggleBulkLabel: (label: Label) => void;
  onOpenNavigation?: () => void;
};

function sortTriggerLabel(sort: ListSort): string {
  if (sort === 'sender') return '发件人';
  if (sort === 'subject') return '主题';
  return '时间';
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
  visibleMessageCount,
  selectedMessageIds,
  selectedMessages,
  folders,
  labels,
  onToggleAllVisible,
  onRunBulkAction,
  onRequestSnooze,
  onMoveBulkToFolder,
  onToggleBulkLabel,
  onOpenNavigation,
}: MessageListToolbarProps) {
  const activeFilterLabel = filters.find((item) => item.id === filter)?.label ?? '全部';
  const isSelectionMode = listMode === 'messages' && selectedMessageIds.length > 0;

  return (
    <header
      className="list-control-strip"
      aria-label="邮件列表控制"
      data-toolbar-height="52"
      data-toolbar-mode={isSelectionMode ? 'selection' : 'normal'}
    >
      <div className="list-summary-row">
        <div className="list-summary">
          <strong>{currentViewLabel}</strong>
          <span>{listMode === 'messages' ? visibleListSummary : messageListSummary}</span>
        </div>
      </div>
      <div className={`list-control-row${isSelectionMode ? ' is-selection-mode' : ''}`}>
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
        {isSelectionMode ? (
          <MessageBulkToolbar
            inline
            visibleMessageCount={visibleMessageCount}
            selectedMessageIds={selectedMessageIds}
            selectedMessages={selectedMessages}
            folders={folders}
            labels={labels}
            onToggleAllVisible={onToggleAllVisible}
            onRunBulkAction={onRunBulkAction}
            onRequestSnooze={onRequestSnooze}
            onMoveBulkToFolder={onMoveBulkToFolder}
            onToggleBulkLabel={onToggleBulkLabel}
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
            </div>
            <div className="list-control-menus" role="group" aria-label="邮件筛选和排序">
              <CompactDropdown
                className="filter-menu"
                label="筛选"
                currentLabel={activeFilterLabel}
                ariaLabel={`筛选邮件，当前：${activeFilterLabel}`}
                value={filter}
                options={filters}
                onChange={onFilterChange}
              />
              <CompactDropdown
                className="sort-menu"
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

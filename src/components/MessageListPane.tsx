import React from 'react';
import {
  MoreHorizontal,
  Paperclip,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { filters, movableFoldersForBulk, searchShortcuts } from '../app/appConfig';
import type {
  AccountScope,
  FilterMode,
  Folder,
  Label,
  ListMode,
  Message,
  ThreadSummary,
} from '../app/types';
import { formatDate } from '../mailUtils';

type BulkAction = 'archive' | 'star' | 'trash' | 'read' | 'unread';

export type MessageListPaneProps = {
  searchInputRef: React.Ref<HTMLInputElement>;
  query: string;
  filter: FilterMode;
  listMode: ListMode;
  selectedMessageIds: number[];
  folders: Folder[];
  labels: Label[];
  threads: ThreadSummary[];
  activeThread: ThreadSummary | null;
  messages: Message[];
  selectedId: number | null;
  accountScope: AccountScope;
  hasMoreMessages: boolean;
  currentViewLabel: string;
  visibleListSummary: string;
  messageListSummary: string;
  onSearchSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onQueryChange: (value: string) => void;
  onClearSearchAndFilter: () => void;
  onApplySearchShortcut: (query: string) => void;
  onRefresh: () => void;
  onShowMessages: () => void;
  onShowThreads: () => void;
  onFilterChange: (filter: FilterMode) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onRunBulkAction: (action: BulkAction) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onApplyBulkLabel: (label: Label) => void;
  onOpenThread: (thread: ThreadSummary) => void;
  onSelectMessage: (messageId: number) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onLoadMore: () => void;
};

export default function MessageListPane({
  searchInputRef,
  query,
  filter,
  listMode,
  selectedMessageIds,
  folders,
  labels,
  threads,
  activeThread,
  messages,
  selectedId,
  accountScope,
  hasMoreMessages,
  currentViewLabel,
  visibleListSummary,
  messageListSummary,
  onSearchSubmit,
  onQueryChange,
  onClearSearchAndFilter,
  onApplySearchShortcut,
  onRefresh,
  onShowMessages,
  onShowThreads,
  onFilterChange,
  onToggleAllVisible,
  onRunBulkAction,
  onMoveBulkToFolder,
  onApplyBulkLabel,
  onOpenThread,
  onSelectMessage,
  onToggleMessageSelection,
  onLoadMore,
}: MessageListPaneProps) {
  const selectedMessageSet = new Set(selectedMessageIds);
  const selectedMessages = messages.filter((message) => selectedMessageSet.has(message.id));
  const allVisibleSelected = messages.length > 0 && selectedMessageIds.length === messages.length;
  const activeFilterLabel = filters.find((item) => item.id === filter)?.label ?? '全部';

  return (
    <section className="message-list-panel">
      <header className="toolbar">
        <div className="search-cluster">
          <form onSubmit={onSearchSubmit} className="search-box">
            <Search size={17} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索主题、发件人、正文"
            />
            {(query.trim() || filter !== 'all') && (
              <button type="button" className="search-clear-button" title="清空搜索和筛选" onClick={onClearSearchAndFilter}>
                <X size={14} />
              </button>
            )}
          </form>
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
            线程
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
        </div>
      </div>
      {listMode === 'messages' && selectedMessageIds.length > 0 && (
        <div className="bulk-toolbar active">
          <label className="bulk-selection">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => onToggleAllVisible(event.target.checked)}
            />
            <span>已选 {selectedMessageIds.length}</span>
          </label>
          <button type="button" className="bulk-primary-action" onClick={() => onRunBulkAction('archive')}>归档</button>
          <details className="compact-menu bulk-more-menu">
            <summary>
              <MoreHorizontal size={15} />
              操作
            </summary>
            <div>
              <button type="button" onClick={() => onRunBulkAction('star')}>星标</button>
              <button type="button" onClick={() => onRunBulkAction('trash')}>删除</button>
              <button type="button" onClick={() => onRunBulkAction('read')}>标为已读</button>
              <button type="button" onClick={() => onRunBulkAction('unread')}>标为未读</button>
              <span className="menu-section-title">移动到</span>
              {movableFoldersForBulk(folders, selectedMessages).map((folder) => (
                <button
                  type="button"
                  key={folder.id}
                  disabled={selectedMessages.length === 0}
                  onClick={() => onMoveBulkToFolder(folder)}
                >
                  {folder.name}
                </button>
              ))}
              <span className="menu-section-title">打标签</span>
              {labels.map((label) => (
                <button type="button" key={label.id} onClick={() => onApplyBulkLabel(label)}>
                  <span className="label-dot" style={{ background: label.color }} />
                  {label.name}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}
      {listMode === 'threads' ? (
        <div className="thread-list">
          {threads.map((thread) => (
            <button
              key={thread.thread_key}
              className={activeThread?.thread_key === thread.thread_key ? 'thread-card selected' : 'thread-card'}
              onClick={() => onOpenThread(thread)}
            >
              <div>
                <strong>{thread.subject || '(无主题)'}</strong>
                <time>{formatDate(thread.latest_at)}</time>
              </div>
              <p>{thread.participants}</p>
              <span>{thread.message_count} 封 · 未读 {thread.unread_count}</span>
            </button>
          ))}
          {threads.length === 0 && <div className="empty-state">没有会话线程</div>}
        </div>
      ) : (
        <div className="message-list">
          {messages.map((message) => (
            <button
              key={message.id}
              className={message.id === selectedId ? 'message-card selected' : 'message-card'}
              onClick={() => onSelectMessage(message.id)}
            >
              <span
                className={`message-avatar avatar-tone-${Math.abs(message.id) % 6}`}
                aria-hidden="true"
              >
                {(message.sender_name || message.sender_email || '?').trim().slice(0, 1).toUpperCase()}
              </span>
              <span className="message-select" onClick={(event) => event.stopPropagation()}>
                <input
                  aria-label={`选择 ${message.subject || '无主题'}`}
                  checked={selectedMessageSet.has(message.id)}
                  type="checkbox"
                  onChange={(event) => onToggleMessageSelection(message.id, event.target.checked)}
                />
              </span>
              <div className="message-topline">
                <span className={message.is_read ? 'sender' : 'sender unread'}>{message.sender_name}</span>
                <time>{formatDate(message.received_at)}</time>
              </div>
              <div className={message.is_read ? 'subject' : 'subject unread'}>
                {message.is_starred ? '★ ' : ''}{message.subject || '(无主题)'}
              </div>
              <p>{message.snippet}</p>
              <div className="message-chips">
                {accountScope === 'all' && <span>{message.account_email}</span>}
                {message.labels.map((label) => <span key={label}>{label}</span>)}
                {message.attachment_count > 0 && <span><Paperclip size={12} /> {message.attachment_count}</span>}
              </div>
            </button>
          ))}
          {messages.length === 0 && (
            <div className="empty-state mailbox-empty-state">
              <div className="empty-state-mark">
                <Search size={22} />
              </div>
              <strong>
                {query.trim() || filter !== 'all' ? '没有匹配邮件' : '当前邮箱暂无可显示邮件'}
              </strong>
              <span>
                {query.trim() || filter !== 'all'
                  ? '可以清空搜索/筛选，或切回“全部”查看当前邮箱。'
                  : '当前账号或统一邮箱范围里，这个文件夹暂时没有邮件。'}
              </span>
              <div className="empty-state-actions">
                {(query.trim() || filter !== 'all') && (
                  <button type="button" onClick={onClearSearchAndFilter}>
                    清空搜索和筛选
                  </button>
                )}
                <button type="button" onClick={onRefresh}>
                  刷新邮箱
                </button>
              </div>
            </div>
          )}
          {messages.length > 0 && (
            <div className="message-list-footer">
              <span>已显示 {messages.length} 封{hasMoreMessages ? ' · 还有更多' : ' · 已到底'}</span>
              {hasMoreMessages && (
                <button type="button" onClick={onLoadMore}>
                  加载更多
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

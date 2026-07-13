import React from 'react';
import {
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  listSortOptions,
} from '../app/appConfig';
import type {
  FilterMode,
  Folder,
  Label,
  ListMode,
  ListSort,
  Message,
  SearchScope,
  ThreadSummary,
} from '../app/types';
import { messageDateGroup } from '../mailUtils';
import ContextMenu from './ContextMenu';
import MessageBulkToolbar from './MessageBulkToolbar';
import MessageListToolbar from './MessageListToolbar';
import MessageListView from './MessageListView';
import ThreadListView from './ThreadListView';
import {
  buildBulkMessageContextItems,
  buildSingleMessageContextItems,
  type BulkMessageAction,
  type ComposeMode,
  type MessageContextAction,
} from './messageContextMenu';

export type { BulkMessageAction, MessageContextAction } from './messageContextMenu';

export type MessageListPaneProps = {
  searchInputRef: React.Ref<HTMLInputElement>;
  query: string;
  searchScope: SearchScope;
  filter: FilterMode;
  listMode: ListMode;
  listSort: ListSort;
  selectedMessageIds: number[];
  folders: Folder[];
  labels: Label[];
  threads: ThreadSummary[];
  activeThread: ThreadSummary | null;
  messages: Message[];
  selectedId: number | null;
  hasMoreMessages: boolean;
  currentViewLabel: string;
  visibleListSummary: string;
  messageListSummary: string;
  listStateKey: string;
  initialScrollTop: number;
  onScrollTopChange: (scrollTop: number) => void;
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
  onToggleAllVisible: (checked: boolean) => void;
  onRunBulkAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: Message[]) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onToggleBulkLabel: (label: Label) => void;
  onRunMessageAction: (message: Message, action: MessageContextAction) => void;
  onMoveMessageToFolder: (message: Message, folder: Folder) => void;
  onToggleMessageLabel: (message: Message, label: Label) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode) => void;
  onOpenThread: (thread: ThreadSummary) => Promise<Message[]>;
  onRunThreadAction: (thread: ThreadSummary, messages: Message[], action: BulkMessageAction) => void;
  onMoveThreadToFolder: (thread: ThreadSummary, messages: Message[], folder: Folder) => void;
  onToggleThreadLabel: (thread: ThreadSummary, messages: Message[], label: Label) => void;
  onToggleThreadMute: (thread: ThreadSummary, messages: Message[]) => void;
  onSelectMessage: (messageId: number) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onLoadMore: () => void;
  loadMoreStatus?: string | null;
};

function MessageListPane({
  searchInputRef,
  query,
  searchScope,
  filter,
  listMode,
  listSort,
  selectedMessageIds,
  folders,
  labels,
  threads,
  activeThread,
  messages,
  selectedId,
  hasMoreMessages,
  currentViewLabel,
  visibleListSummary,
  messageListSummary,
  listStateKey,
  initialScrollTop,
  onScrollTopChange,
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
  onToggleAllVisible,
  onRunBulkAction,
  onRequestSnooze,
  onMoveBulkToFolder,
  onToggleBulkLabel,
  onRunMessageAction,
  onMoveMessageToFolder,
  onToggleMessageLabel,
  onComposeFromMessage,
  onOpenThread,
  onRunThreadAction,
  onMoveThreadToFolder,
  onToggleThreadLabel,
  onToggleThreadMute,
  onSelectMessage,
  onToggleMessageSelection,
  onLoadMore,
  loadMoreStatus,
}: MessageListPaneProps) {
  const [messageMenu, setMessageMenu] = React.useState<{
    x: number;
    y: number;
    message: Message;
    bulk: boolean;
  } | null>(null);
  const [draggingMessageIds, setDraggingMessageIds] = React.useState<number[]>([]);
  const [threadMenu, setThreadMenu] = React.useState<{
    x: number;
    y: number;
    thread: ThreadSummary;
    messages: Message[];
  } | null>(null);

  const handleOpenThread = React.useCallback((thread: ThreadSummary) => {
    setThreadMenu(null);
    void onOpenThread(thread);
  }, [onOpenThread]);

  const handleOpenThreadMenu = React.useCallback((thread: ThreadSummary, x: number, y: number) => {
    setThreadMenu(null);
    void onOpenThread(thread).then((nextMessages) => {
      setThreadMenu({ x, y, thread, messages: nextMessages });
    });
  }, [onOpenThread]);

  const handleOpenMessageMenu = React.useCallback((message: Message, x: number, y: number, bulk: boolean) => {
    setMessageMenu({ x, y, message, bulk });
  }, []);

  const handleCloseMessageMenu = React.useCallback(() => {
    setMessageMenu(null);
  }, []);

  const selectedMessageSet = React.useMemo(
    () => new Set(selectedMessageIds),
    [selectedMessageIds],
  );
  const selectedMessages = React.useMemo(
    () => messages.filter((message) => selectedMessageSet.has(message.id)),
    [messages, selectedMessageSet],
  );
  const activeSortLabel = React.useMemo(
    () => listSortOptions.find((item) => item.id === listSort)?.label ?? '最新优先',
    [listSort],
  );
  const contextMessage = messageMenu?.message;
  const isBulkContext = Boolean(messageMenu?.bulk && selectedMessages.length > 1);

  const messageContextItems = React.useMemo(() => {
    return isBulkContext
      ? buildBulkMessageContextItems({
          selectedMessages,
          folders,
          labels,
          onRunBulkAction,
          onRequestSnooze,
          onMoveBulkToFolder,
          onToggleBulkLabel,
        })
      : contextMessage
        ? buildSingleMessageContextItems({
            message: contextMessage,
            folders,
            labels,
            onSelectMessage,
            onComposeFromMessage,
            onRunMessageAction,
            onMoveMessageToFolder,
            onToggleMessageLabel,
          })
        : [];
  }, [
    isBulkContext,
    selectedMessages,
    folders,
    labels,
    onRunBulkAction,
    onRequestSnooze,
    onMoveBulkToFolder,
    onToggleBulkLabel,
    contextMessage,
    onSelectMessage,
    onComposeFromMessage,
    onRunMessageAction,
    onMoveMessageToFolder,
    onToggleMessageLabel,
  ]);

  const threadContextMessages = React.useMemo(
    () => threadMenu?.messages ?? [],
    [threadMenu?.messages],
  );
  const threadMovableMessages = React.useMemo(
    () => threadContextMessages.filter(
      (message) => message.folder_role !== 'drafts' && message.folder_role !== 'sent',
    ),
    [threadContextMessages],
  );

  const threadContextItems = React.useMemo(() => {
    if (!threadMenu) return [];
    const items = buildBulkMessageContextItems({
      selectedMessages: threadContextMessages,
      movableMessages: threadMovableMessages,
      folders,
      labels,
      onRunBulkAction: (action) => onRunThreadAction(threadMenu.thread, threadContextMessages, action),
      onRequestSnooze,
      onMoveBulkToFolder: (folder) => onMoveThreadToFolder(threadMenu.thread, threadContextMessages, folder),
      onToggleBulkLabel: (label) => onToggleThreadLabel(threadMenu.thread, threadContextMessages, label),
    });
    items.splice(2, 0, {
      id: 'thread-mute',
      label: threadMenu.thread.is_muted ? '取消静音会话' : '静音会话',
      icon: threadMenu.thread.is_muted ? <Volume2 size={15} /> : <VolumeX size={15} />,
      separatorBefore: true,
      onSelect: () => onToggleThreadMute(threadMenu.thread, threadContextMessages),
    });
    return items;
  }, [
    threadMenu,
    threadContextMessages,
    threadMovableMessages,
    folders,
    labels,
    onRunThreadAction,
    onRequestSnooze,
    onMoveThreadToFolder,
    onToggleThreadLabel,
    onToggleThreadMute,
  ]);

  const groupedMessages = React.useMemo(() => {
    const groups: Array<{ id: string; label: string; messages: Message[] }> = [];
    const includeDateGroups = listSort === 'newest' || listSort === 'oldest';
    for (const message of messages) {
      const group = includeDateGroups
        ? messageDateGroup(message.received_at)
        : { id: 'all', label: activeSortLabel };
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.id === group.id) {
        lastGroup.messages.push(message);
      } else {
        groups.push({ ...group, messages: [message] });
      }
    }
    return groups;
  }, [activeSortLabel, listSort, messages]);

  return (
    <section className="message-list-panel">
      <MessageListToolbar
        searchInputRef={searchInputRef}
        query={query}
        searchScope={searchScope}
        filter={filter}
        listMode={listMode}
        listSort={listSort}
        currentViewLabel={currentViewLabel}
        visibleListSummary={visibleListSummary}
        messageListSummary={messageListSummary}
        messages={messages}
        onSearchSubmit={onSearchSubmit}
        onQueryChange={onQueryChange}
        onSearchScopeChange={onSearchScopeChange}
        onClearSearchAndFilter={onClearSearchAndFilter}
        onApplySearchShortcut={onApplySearchShortcut}
        onRefresh={onRefresh}
        onShowMessages={onShowMessages}
        onShowThreads={onShowThreads}
        onFilterChange={onFilterChange}
        onSortChange={onSortChange}
      />
      {listMode === 'messages' && (
        <MessageBulkToolbar
          visibleMessageCount={messages.length}
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
      )}
      {listMode === 'threads' ? (
        <ThreadListView
          threads={threads}
          activeThread={activeThread}
          onOpenThread={handleOpenThread}
          onOpenThreadMenu={handleOpenThreadMenu}
        />
      ) : (
        <MessageListView
          groups={groupedMessages}
          messages={messages}
          query={query}
          filter={filter}
          selectedId={selectedId}
          hasMoreMessages={hasMoreMessages}
          listStateKey={listStateKey}
          initialScrollTop={initialScrollTop}
          selectedMessageIds={selectedMessageIds}
          draggingMessageIds={draggingMessageIds}
          onScrollTopChange={onScrollTopChange}
          onSelectMessage={onSelectMessage}
          onToggleMessageSelection={onToggleMessageSelection}
          onToggleAllVisible={onToggleAllVisible}
          onOpenMessageMenu={handleOpenMessageMenu}
          onCloseMessageMenu={handleCloseMessageMenu}
          onSetDraggingMessageIds={setDraggingMessageIds}
          onClearSearchAndFilter={onClearSearchAndFilter}
          onRefresh={onRefresh}
          onLoadMore={onLoadMore}
          loadMoreStatus={loadMoreStatus}
        />
      )}
      {threadMenu && (
        <ContextMenu
          x={threadMenu.x}
          y={threadMenu.y}
          items={threadContextItems}
          title={threadMenu.thread.subject || '(无主题)'}
          detail={`${threadMenu.messages.length} 封邮件 · 会话操作`}
          ariaLabel={`${threadMenu.thread.subject || '会话'}操作`}
          onClose={() => setThreadMenu(null)}
        />
      )}
      {messageMenu && (
        <ContextMenu
          x={messageMenu.x}
          y={messageMenu.y}
          items={messageContextItems}
          title={isBulkContext ? `已选择 ${selectedMessages.length} 封邮件` : messageMenu.message.subject || '(无主题)'}
          detail={isBulkContext ? '操作将应用到当前选择' : messageMenu.message.sender_name || messageMenu.message.sender_email}
          ariaLabel={isBulkContext ? '批量邮件操作' : `${messageMenu.message.subject || '邮件'}操作`}
          onClose={() => setMessageMenu(null)}
        />
      )}
    </section>
  );
}

export default React.memo(MessageListPane);

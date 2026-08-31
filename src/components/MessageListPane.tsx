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
  MessageSummary,
  ThreadSummary,
} from '../app/types';
import { messageDateGroup, type LocalDateTimeRange } from '../mailUtils';
import ContextMenu from './ContextMenu';
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
  mobile?: boolean;
  showAccountSource?: boolean;
  appliedQuery: string;
  filter: FilterMode;
  listMode: ListMode;
  listSort: ListSort;
  selectedMessageIds: number[];
  selectedMessages: MessageSummary[];
  folders: Folder[];
  labels: Label[];
  threads: ThreadSummary[];
  activeThread: ThreadSummary | null;
  messages: MessageSummary[];
  selectedId: number | null;
  hasMoreMessages: boolean;
  currentViewLabel: string;
  visibleListSummary: string;
  messageListSummary: string;
  listStateKey: string;
  initialScrollTop: number;
  onScrollTopChange: (scrollTop: number) => void;
  onClearSearchAndFilter: () => void;
  onRefresh: () => void;
  onShowMessages: () => void;
  onShowThreads: () => void;
  onFilterChange: (filter: FilterMode) => void;
  onSortChange: (sort: ListSort) => void;
  onToggleAllVisible: (checked: boolean) => void;
  isSelectingAll?: boolean;
  isAllMessagesSelected?: boolean;
  onRunBulkAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: MessageSummary[]) => void;
  onMoveBulkToFolder: (folder: Folder) => void;
  onToggleBulkLabel: (label: Label) => void;
  onRunMessageAction: (message: MessageSummary, action: MessageContextAction) => void;
  onMoveMessageToFolder: (message: MessageSummary, folder: Folder) => void;
  onToggleMessageLabel: (message: MessageSummary, label: Label) => void;
  onComposeFromMessage: (message: MessageSummary, mode: ComposeMode) => void;
  onOpenThread: (thread: ThreadSummary) => Promise<MessageSummary[]>;
  onLoadThreadMessages?: (thread: ThreadSummary) => Promise<MessageSummary[]>;
  onRunThreadAction: (thread: ThreadSummary, messages: MessageSummary[], action: BulkMessageAction) => void;
  onMoveThreadToFolder: (thread: ThreadSummary, messages: MessageSummary[], folder: Folder) => void;
  onToggleThreadLabel: (thread: ThreadSummary, messages: MessageSummary[], label: Label) => void;
  onToggleThreadMute: (thread: ThreadSummary, messages: MessageSummary[]) => void;
  onSelectMessage: (messageId: number) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onToggleMessageGroup?: (groupId: string, messageIds: number[], checked: boolean) => void | Promise<void>;
  isSelectingMessageGroup?: boolean;
  onSelectMessageDateRange?: (range: LocalDateTimeRange) => void;
  onLoadMore: () => Promise<MessageSummary[]>;
  loadMoreStatus?: string | null;
  onOpenNavigation?: () => void;
};

function MessageListPane({
  mobile = false,
  showAccountSource = false,
  appliedQuery,
  filter,
  listMode,
  listSort,
  selectedMessageIds,
  selectedMessages,
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
  onClearSearchAndFilter,
  onRefresh,
  onShowMessages,
  onShowThreads,
  onFilterChange,
  onSortChange,
  onToggleAllVisible,
  isSelectingAll,
  isAllMessagesSelected,
  onRunBulkAction,
  onRequestSnooze,
  onMoveBulkToFolder,
  onToggleBulkLabel,
  onRunMessageAction,
  onMoveMessageToFolder,
  onToggleMessageLabel,
  onComposeFromMessage,
  onOpenThread,
  onLoadThreadMessages,
  onRunThreadAction,
  onMoveThreadToFolder,
  onToggleThreadLabel,
  onToggleThreadMute,
  onSelectMessage,
  onToggleMessageSelection,
  onToggleMessageGroup,
  isSelectingMessageGroup,
  onSelectMessageDateRange,
  onLoadMore,
  loadMoreStatus,
  onOpenNavigation,
}: MessageListPaneProps) {
  const [messageMenu, setMessageMenu] = React.useState<{
    x: number;
    y: number;
    message: MessageSummary;
    bulk: boolean;
  } | null>(null);
  const [draggingMessageIds, setDraggingMessageIds] = React.useState<number[]>([]);
  const [threadMenu, setThreadMenu] = React.useState<{
    x: number;
    y: number;
    thread: ThreadSummary;
    messages: MessageSummary[];
  } | null>(null);

  const handleOpenThread = React.useCallback((thread: ThreadSummary) => {
    setThreadMenu(null);
    void onOpenThread(thread);
  }, [onOpenThread]);

  const handleOpenThreadMenu = React.useCallback((thread: ThreadSummary, x: number, y: number) => {
    setThreadMenu(null);
    const loadMessages = mobile && onLoadThreadMessages
      ? onLoadThreadMessages(thread)
      : onOpenThread(thread);
    void loadMessages.then((nextMessages) => {
      setThreadMenu({ x, y, thread, messages: nextMessages });
    });
  }, [mobile, onLoadThreadMessages, onOpenThread]);

  const handleOpenMessageMenu = React.useCallback((message: MessageSummary, x: number, y: number, bulk: boolean) => {
    setMessageMenu({ x, y, message, bulk });
  }, []);

  const handleCloseMessageMenu = React.useCallback(() => {
    setMessageMenu(null);
  }, []);

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
    const groups: Array<{ id: string; label: string; messages: MessageSummary[] }> = [];
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
    <section className={`message-list-panel${mobile ? ' mobile-message-list-panel' : ''}`}>
      {!mobile && (
        <MessageListToolbar
          onOpenNavigation={onOpenNavigation}
          filter={filter}
          listMode={listMode}
          listSort={listSort}
          currentViewLabel={currentViewLabel}
          visibleListSummary={visibleListSummary}
          messageListSummary={messageListSummary}
          onShowMessages={onShowMessages}
          onShowThreads={onShowThreads}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          selectedMessageIds={selectedMessageIds}
          selectedMessages={selectedMessages}
          folders={folders}
          labels={labels}
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
          mobile={mobile}
          showAccountSource={showAccountSource}
          groups={groupedMessages}
          messages={messages}
          query={appliedQuery}
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
          isSelectingAll={isSelectingAll}
          isAllMessagesSelected={isAllMessagesSelected}
          onToggleMessageGroup={onToggleMessageGroup}
          isSelectingMessageGroup={isSelectingMessageGroup}
          onSelectMessageDateRange={onSelectMessageDateRange}
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

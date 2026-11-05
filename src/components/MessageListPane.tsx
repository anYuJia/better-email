import React from 'react';
import './mailbox-loading.css';
import {
  Volume2,
  VolumeX,
  ListChecks,
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
import MailboxLoadingPlaceholder from './MailboxLoadingPlaceholder';
import MessageSelectionControls from './MessageSelectionControls';
import MessageBulkToolbar from './MessageBulkToolbar';
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
  notice?: React.ReactNode;
  mailboxPending?: boolean;
  mailboxError?: string | null;
  mailboxUnavailable?: boolean;
  onRetryMailbox?: () => void;
  mobile?: boolean;
  selectionMode?: boolean;
  onEnterSelection?: () => void;
  showAccountSource?: boolean;
  accountSourceLabels?: ReadonlyMap<number, string>;
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
  onExpandSearch?: () => void;
  onRefresh: () => Promise<void>;
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
  notice,
  mailboxPending = false,
  mailboxError,
  mailboxUnavailable = false,
  onRetryMailbox,
  mobile = false,
  selectionMode = false,
  onEnterSelection,
  showAccountSource = false,
  accountSourceLabels,
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
  onExpandSearch,
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
  const paneRef = React.useRef<HTMLElement | null>(null);
  const handleExpandSearch = React.useCallback(() => {
    // The empty-state action disappears when the range changes. Keep keyboard
    // focus in the persistent pane while its list is hidden for loading.
    paneRef.current?.focus({ preventScroll: true });
    onExpandSearch?.();
  }, [onExpandSearch]);
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
  const [threadMenuError, setThreadMenuError] = React.useState<string | null>(null);
  const threadMenuGenerationRef = React.useRef(0);
  const pendingThreadMenuRef = React.useRef<number | null>(null);
  const menuViewRef = React.useRef({ listStateKey, listMode, mailboxUnavailable });
  menuViewRef.current = { listStateKey, listMode, mailboxUnavailable };

  const handleCloseThreadMenu = React.useCallback(() => {
    threadMenuGenerationRef.current += 1;
    pendingThreadMenuRef.current = null;
    setThreadMenu(null);
    setThreadMenuError(null);
  }, []);

  React.useLayoutEffect(() => {
    handleCloseThreadMenu();
    setMessageMenu(null);
  }, [handleCloseThreadMenu, listStateKey, listMode, mailboxUnavailable]);

  React.useEffect(() => {
    // While the thread read is pending there is no menu DOM to own dismissal.
    // A later click or Escape still cancels that intent without stealing focus.
    const cancelPending = () => {
      if (pendingThreadMenuRef.current !== null) handleCloseThreadMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (pendingThreadMenuRef.current === null || event.key !== 'Escape'
        || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      cancelPending();
    };
    document.addEventListener('pointerdown', cancelPending, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', cancelPending, true);
      window.removeEventListener('keydown', onKeyDown, true);
      threadMenuGenerationRef.current += 1;
      pendingThreadMenuRef.current = null;
    };
  }, [handleCloseThreadMenu]);

  const handleOpenThread = React.useCallback((thread: ThreadSummary) => {
    handleCloseThreadMenu();
    void onOpenThread(thread);
  }, [handleCloseThreadMenu, onOpenThread]);

  const handleOpenThreadMenu = React.useCallback((thread: ThreadSummary, x: number, y: number) => {
    handleCloseThreadMenu();
    const view = menuViewRef.current;
    if (view.mailboxUnavailable || view.listMode !== 'threads') return;
    const generation = threadMenuGenerationRef.current;
    pendingThreadMenuRef.current = generation;
    const isCurrent = () => generation === threadMenuGenerationRef.current
      && !menuViewRef.current.mailboxUnavailable
      && menuViewRef.current.listMode === 'threads'
      && menuViewRef.current.listStateKey === view.listStateKey;
    void (async () => {
      const nextMessages = await (onLoadThreadMessages
        ? onLoadThreadMessages(thread) : onOpenThread(thread));
      if (!isCurrent()) return;
      if (nextMessages.length === 0) {
        setThreadMenuError('会话中没有可操作的邮件，请刷新列表。');
        return;
      }
      setThreadMenu({ x, y, thread, messages: nextMessages });
    })().catch(() => {
      if (isCurrent()) setThreadMenuError('无法读取会话，请重新打开操作菜单。');
    }).finally(() => {
      if (pendingThreadMenuRef.current === generation) pendingThreadMenuRef.current = null;
    });
  }, [handleCloseThreadMenu, onLoadThreadMessages, onOpenThread]);

  const handleOpenMessageMenu = React.useCallback((message: MessageSummary, x: number, y: number, bulk: boolean) => {
    handleCloseThreadMenu();
    setMessageMenu({ x, y, message, bulk });
  }, [handleCloseThreadMenu]);

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
    const items = isBulkContext
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
    if (mobile && contextMessage && !isBulkContext && onEnterSelection) items.unshift({
      id: 'select-message', label: '选择邮件',
      icon: <ListChecks size={18} strokeWidth={1.75} aria-hidden="true" />,
      onSelect: () => { onEnterSelection(); onToggleMessageSelection(contextMessage.id, true); },
    });
    return items;
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
    mobile, onEnterSelection, onToggleMessageSelection,
  ]);

  const threadContextMessages = React.useMemo(
    () => threadMenu?.messages ?? [],
    [threadMenu?.messages],
  );
  const threadMovableMessages = React.useMemo(
    () => threadContextMessages.filter(
      (message) => !['drafts', 'outbox', 'sent'].includes(message.folder_role),
    ),
    [threadContextMessages],
  );

  const threadContextItems = React.useMemo(() => {
    if (!threadMenu) return [];
    const items = buildBulkMessageContextItems({
      selectedMessages: threadContextMessages,
      movableMessages: threadMovableMessages,
      scope: 'thread',
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
    <section className={`message-list-panel${mobile ? ' mobile-message-list-panel' : ''}`}
      ref={paneRef} tabIndex={-1} aria-label="邮件列表区域">
      {!mobile && (
        <MessageListToolbar
          onOpenNavigation={onOpenNavigation}
          filter={filter}
          listMode={listMode}
          listSort={listSort}
          currentViewLabel={currentViewLabel}
          visibleListSummary={mailboxUnavailable ? '' : visibleListSummary}
          messageListSummary={mailboxUnavailable ? '' : messageListSummary}
          onShowMessages={onShowMessages}
          onShowThreads={onShowThreads}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          selectedMessageIds={mailboxUnavailable ? [] : selectedMessageIds}
          selectedMessages={mailboxUnavailable ? [] : selectedMessages}
          folders={folders}
          labels={labels}
          onRunBulkAction={onRunBulkAction}
          onRequestSnooze={onRequestSnooze}
          onMoveBulkToFolder={onMoveBulkToFolder}
          onToggleBulkLabel={onToggleBulkLabel}
          onClearSelection={() => onToggleAllVisible(false)}
          selectionControls={(
            <MessageSelectionControls
              compact
              messages={mailboxUnavailable ? [] : messages}
              selectedMessageIds={mailboxUnavailable ? [] : selectedMessageIds}
              hasMoreMessages={hasMoreMessages}
              isAllMessagesSelected={isAllMessagesSelected}
              isSelectingAll={isSelectingAll}
              isSelectingMessageGroup={isSelectingMessageGroup}
              loading={Boolean(loadMoreStatus)}
              onToggleAllVisible={onToggleAllVisible}
              onToggleMessageSelection={onToggleMessageSelection}
              onSelectMessageDateRange={onSelectMessageDateRange}
            />
          )}
        />
      )}
      {notice}
      {mobile && selectionMode && !mailboxUnavailable && <div className="mobile-selection-toolbar">
        <MessageSelectionControls compact messages={messages} selectedMessageIds={selectedMessageIds}
          hasMoreMessages={hasMoreMessages} isAllMessagesSelected={isAllMessagesSelected}
          isSelectingAll={isSelectingAll} isSelectingMessageGroup={isSelectingMessageGroup}
          loading={Boolean(loadMoreStatus)} onToggleAllVisible={onToggleAllVisible}
          onToggleMessageSelection={onToggleMessageSelection} onSelectMessageDateRange={onSelectMessageDateRange} />
        {selectedMessageIds.length === 0 ? <span className="mobile-selection-hint">点选邮件，或全选当前结果</span> :
          <MessageBulkToolbar inline selectedMessageIds={selectedMessageIds} selectedMessages={selectedMessages}
            folders={folders} labels={labels} onRunBulkAction={onRunBulkAction} onRequestSnooze={onRequestSnooze}
            onMoveBulkToFolder={onMoveBulkToFolder} onToggleBulkLabel={onToggleBulkLabel} />}
      </div>}
      {mailboxUnavailable && (
        <div className="mailbox-load-state" aria-busy={mailboxPending}>
          {mailboxError ? <div role="alert"><strong>暂时无法显示邮件</strong><p>{mailboxError}</p><button type="button" className="mailbox-state-action" onClick={onRetryMailbox}>重新加载</button></div>
            : <MailboxLoadingPlaceholder listMode={listMode} />}
        </div>
      )}
      {!mailboxUnavailable && mailboxError && <div className="message-list-refresh-error" role="alert"><span>{mailboxError}</span><button type="button" className="mailbox-state-action" onClick={onRetryMailbox}>重试</button></div>}
      {!mailboxUnavailable && threadMenuError && <div className="message-list-refresh-error" role="alert">{threadMenuError}</div>}
      <div className="mailbox-list-content" hidden={mailboxUnavailable}>
      {listMode === 'threads' ? (
        <ThreadListView
          listStateKey={listStateKey}
          threads={threads}
          activeThread={activeThread}
          onOpenThread={handleOpenThread}
          onOpenThreadMenu={handleOpenThreadMenu}
        />
      ) : (
        <MessageListView
          mobile={mobile}
          selectionMode={selectionMode}
          selectionControlsInToolbar={mobile && selectionMode}
          showAccountSource={showAccountSource}
          accountSourceLabels={accountSourceLabels}
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
          onExpandSearch={onExpandSearch ? handleExpandSearch : undefined}
          onRefresh={onRefresh}
          onLoadMore={onLoadMore}
          loadMoreStatus={loadMoreStatus}
        />
      )}
      </div>
      <ContextMenu menu={threadMenu && !mailboxUnavailable ? {
        targetKey: threadMenu.thread.thread_key,
        x: threadMenu.x, y: threadMenu.y, items: threadContextItems,
        title: threadMenu.thread.subject || '(无主题)', detail: `${threadMenu.messages.length} 封邮件`,
        ariaLabel: '会话操作', onClose: handleCloseThreadMenu,
      } : null} />
      <ContextMenu menu={messageMenu && !mailboxUnavailable ? {
        targetKey: `${isBulkContext ? 'bulk' : 'message'}:${messageMenu.message.id}`,
        x: messageMenu.x, y: messageMenu.y, items: messageContextItems,
        title: isBulkContext ? `已选 ${selectedMessages.length} 封邮件` : messageMenu.message.subject || '(无主题)',
        detail: isBulkContext ? '更改将应用到全部已选邮件' : messageMenu.message.sender_name || messageMenu.message.sender_email,
        ariaLabel: isBulkContext ? '批量邮件操作' : '邮件操作', onClose: () => setMessageMenu(null),
      } : null} />
    </section>
  );
}

export default React.memo(MessageListPane);

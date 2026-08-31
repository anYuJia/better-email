import {
  Archive,
  File,
  Forward,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  buildMessageCollectionActionState,
  collectionActionDetail,
  type MessageCollectionActionEntry,
} from '../../app/messageActionState';
import type { Folder, Label, Message, MessageSummary, ThreadSummary } from '../../app/types';
import { formatDate } from '../../mailUtils';
import {
  buildBulkMessageContextItems,
  type BulkMessageAction,
} from '../messageContextMenu';
import { ContextMenuContent, type ContextMenuItem } from '../ContextMenu';
import SenderIdentity from './SenderIdentity';
import { useDetailsMenu } from '../../hooks/useDetailsMenu';
import { memo, useMemo, useRef } from 'react';

export type ComposeMode = 'reply' | 'replyAll' | 'forward';

type ThreadReaderListProps = {
  activeThread: ThreadSummary;
  threadMessages: MessageSummary[];
  activeThreadSelected: Message | null;
  selectedId: number | null;
  folders: Folder[];
  labels: Label[];
  onSelectMessage: (messageId: number) => void;
  onRunThreadAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: MessageSummary[]) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode) => void;
  onMoveThreadToFolder: (folder: Folder) => void;
  onToggleThreadLabel: (label: Label) => void;
  onToggleThreadMute: () => void;
};

function ThreadReaderList({
  activeThread,
  threadMessages,
  activeThreadSelected,
  selectedId,
  folders,
  labels,
  onSelectMessage,
  onRunThreadAction,
  onRequestSnooze,
  onComposeFromMessage,
  onMoveThreadToFolder,
  onToggleThreadLabel,
  onToggleThreadMute,
}: ThreadReaderListProps) {
  const threadStates = useMemo(() => {
    const actionState = buildMessageCollectionActionState(threadMessages, 'thread');
    const threadMovableMessages = threadMessages.filter(
      (message) => !['drafts', 'outbox', 'sent'].includes(message.folder_role),
    );

    return {
      actionState,
      threadMovableMessages,
    };
  }, [threadMessages]);

  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenu = useDetailsMenu(moreMenuRef, { floating: true });
  const entryByAction = new Map(threadStates.actionState.entries.map((item) => [item.action, item]));
  const starEntry = entryByAction.get(threadStates.actionState.allStarred ? 'unstar' : 'star');
  const archiveEntry = entryByAction.get('archive');
  const runEntry = (item: MessageCollectionActionEntry) => {
    if (item.action === 'snooze') onRequestSnooze(item.messages);
    else onRunThreadAction(item.action);
  };
  const contextItems = buildBulkMessageContextItems({
    selectedMessages: threadMessages,
    movableMessages: threadStates.threadMovableMessages,
    scope: 'thread',
    folders,
    labels,
    onRunBulkAction: onRunThreadAction,
    onRequestSnooze,
    onMoveBulkToFolder: onMoveThreadToFolder,
    onToggleBulkLabel: onToggleThreadLabel,
  }).filter((item) => !['thread-star-state', 'thread-archive'].includes(item.id));
  if (contextItems[0]) contextItems[0].separatorBefore = true;
  contextItems.splice(Math.min(2, contextItems.length), 0, {
    id: 'thread-mute',
    label: activeThread.is_muted ? '取消静音会话' : '静音会话',
    icon: activeThread.is_muted ? <Volume2 size={15} /> : <VolumeX size={15} />,
    separatorBefore: true,
    onSelect: onToggleThreadMute,
  });
  const responseItems: ContextMenuItem[] = [
    {
      id: 'thread-reply-all',
      label: '回复全部',
      icon: <ReplyAll size={15} />,
      disabled: !activeThreadSelected,
      onSelect: () => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'replyAll'),
    },
    {
      id: 'thread-forward',
      label: '转发最新邮件',
      icon: <Forward size={15} />,
      disabled: !activeThreadSelected,
      onSelect: () => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'forward'),
    },
  ];
  const threadMenuItems = [...responseItems, ...contextItems];

  return (
    <>
      <header className="reader-header">
        <div className="reader-title-block">
          <h1>{activeThread.subject || '(无主题)'}</h1>
          <p>{activeThread.participants} · {threadMessages.length} 封邮件 · 未读 {activeThread.unread_count}</p>
        </div>
        <div className="reader-actions">
          <div className="reader-action-group reader-response-actions" role="group" aria-label="回复操作">
            <button
              className="primary-action"
              title="回复最新邮件"
              onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'reply')}
            >
              <Reply size={16} />
              <span>回复</span>
            </button>
          </div>
          <div className="reader-action-group reader-message-actions" role="group" aria-label="整理操作">
            <button
              className="icon-only-action"
              title={threadStates.actionState.allStarred ? '取消整个会话星标' : '添加整个会话星标'}
              aria-label={threadStates.actionState.allStarred ? '取消整个会话星标' : '添加整个会话星标'}
              onClick={() => starEntry && runEntry(starEntry)}
            >
              <Star size={17} fill={threadStates.actionState.allStarred ? 'currentColor' : 'none'} />
            </button>
            <button
              className="icon-only-action"
              aria-label="归档会话中的收件邮件"
              disabled={!archiveEntry}
              title={archiveEntry
                ? `归档 · ${collectionActionDetail(archiveEntry.messages.length, threadStates.actionState.totalCount)}`
                : '会话中没有可归档的邮件'}
              onClick={() => archiveEntry && runEntry(archiveEntry)}
            >
              <Archive size={16} />
            </button>
          </div>
          <details
            className="reader-more-menu compact-menu"
            ref={moreMenuRef}
            data-floating-menu="true"
          >
            <summary className="icon-only-summary" title="更多会话操作" aria-label="更多会话操作">
              <MoreHorizontal size={17} />
            </summary>
            <div
              className="context-menu-surface context-menu--anchored reader-more-menu-panel"
              data-floating-menu-panel="true"
            >
              <ContextMenuContent
                items={threadMenuItems}
                onClose={moreMenu.closeMenu}
                ariaLabel="会话操作"
                title={activeThread.subject || '(无主题)'}
                detail={`${threadMessages.length} 封邮件`}
              />
            </div>
          </details>
        </div>
      </header>
      <div className="thread-stack">
        {threadMessages.map((message) => (
          <section
            className={message.id === selectedId ? 'thread-message active' : 'thread-message'}
            key={message.id}
            role="button"
            tabIndex={0}
            aria-current={message.id === selectedId ? 'true' : undefined}
            aria-label={`查看会话中的邮件：${message.sender_name || message.sender_email}，${message.subject || '无主题'}，${formatDate(message.received_at)}`}
            onClick={() => onSelectMessage(message.id)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onSelectMessage(message.id);
            }}
          >
            <header>
              <SenderIdentity message={message} />
              <time>{formatDate(message.received_at)}</time>
            </header>
            <p>{message.snippet}</p>
            <div className="message-chips">
              <span>{message.folder_role}</span>
              {message.labels.map((label) => <span key={label}>{label}</span>)}
              {message.attachment_count > 0 && <span><File size={12} /> {message.attachment_count}</span>}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export default memo(ThreadReaderList);

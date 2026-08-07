import {
  Archive,
  File,
  Forward,
  Mail,
  MailOpen,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Star,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { movableFoldersForBulk } from '../../app/appConfig';
import type { Folder, Label, Message, MessageSummary, ThreadSummary } from '../../app/types';
import { formatDate } from '../../mailUtils';
import type { BulkMessageAction } from '../messageContextMenu';
import SenderIdentity from './SenderIdentity';

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
  onComposeFromMessage: (message: Message, mode: ComposeMode) => void;
  onMoveThreadToFolder: (folder: Folder) => void;
  onToggleThreadLabel: (label: Label) => void;
  onToggleThreadMute: () => void;
};

export default function ThreadReaderList({
  activeThread,
  threadMessages,
  activeThreadSelected,
  selectedId,
  folders,
  labels,
  onSelectMessage,
  onRunThreadAction,
  onComposeFromMessage,
  onMoveThreadToFolder,
  onToggleThreadLabel,
  onToggleThreadMute,
}: ThreadReaderListProps) {
  const allThreadRead = threadMessages.every((message) => message.is_read);
  const allThreadStarred = threadMessages.every((message) => message.is_starred);
  const threadMovableMessages = threadMessages.filter(
    (message) => message.folder_role !== 'drafts' && message.folder_role !== 'sent',
  );
  const threadArchiveCount = threadMessages.filter(
    (message) => !['archive', 'drafts', 'sent', 'trash'].includes(message.folder_role),
  ).length;
  const threadTrashCount = threadMessages.filter(
    (message) => message.folder_role !== 'drafts' && message.folder_role !== 'trash',
  ).length;
  const threadMoveFolders = movableFoldersForBulk(folders, threadMovableMessages);

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
            <button
              className="icon-only-action"
              title="回复全部"
              aria-label="回复全部"
              onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'replyAll')}
            >
              <ReplyAll size={17} />
            </button>
            <button
              className="icon-only-action"
              title="转发最新邮件"
              aria-label="转发最新邮件"
              onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'forward')}
            >
              <Forward size={17} />
            </button>
          </div>
          <div className="reader-action-group reader-message-actions" role="group" aria-label="整理操作">
            <button
              className="icon-only-action"
              title={allThreadStarred ? '取消整个会话星标' : '添加整个会话星标'}
              aria-label={allThreadStarred ? '取消整个会话星标' : '添加整个会话星标'}
              onClick={() => onRunThreadAction(allThreadStarred ? 'unstar' : 'star')}
            >
              <Star size={17} fill={allThreadStarred ? 'currentColor' : 'none'} />
            </button>
            <button
              className="icon-only-action"
              title="归档会话中的收件邮件"
              aria-label="归档会话中的收件邮件"
              disabled={threadArchiveCount === 0}
              onClick={() => onRunThreadAction('archive')}
            >
              <Archive size={16} />
            </button>
            <button
              className="icon-only-action"
              title={allThreadRead ? '整个会话标为未读' : '整个会话标为已读'}
              aria-label={allThreadRead ? '整个会话标为未读' : '整个会话标为已读'}
              onClick={() => onRunThreadAction(allThreadRead ? 'unread' : 'read')}
            >
              {allThreadRead ? <Mail size={16} /> : <MailOpen size={16} />}
            </button>
            <button
              className="icon-only-action danger-action"
              title="将会话移到废纸篓"
              aria-label="将会话移到废纸篓"
              disabled={threadTrashCount === 0}
              onClick={() => onRunThreadAction('trash')}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <details className="reader-more-menu compact-menu">
            <summary className="icon-only-summary" title="更多会话操作" aria-label="更多会话操作">
              <MoreHorizontal size={17} />
            </summary>
            <div>
              <span className="menu-section-title">会话</span>
              <button type="button" onClick={onToggleThreadMute}>
                {activeThread.is_muted ? <Volume2 size={14} /> : <VolumeX size={14} />}
                {activeThread.is_muted ? '取消静音会话' : '静音会话'}
              </button>
              <span className="menu-section-title">标签</span>
              {labels.map((label) => (
                <button
                  type="button"
                  key={label.id}
                  className={threadMessages.every((message) => message.labels.includes(label.name)) ? 'active' : ''}
                  onClick={() => onToggleThreadLabel(label)}
                >
                  <span className="label-dot" style={{ background: label.color }} />
                  {label.name}
                </button>
              ))}
              <span className="menu-section-title">移动到</span>
              {threadMoveFolders.map((folder) => (
                <button type="button" key={folder.id} onClick={() => onMoveThreadToFolder(folder)}>
                  {folder.name}
                </button>
              ))}
              {threadMoveFolders.length === 0 && (
                <span className="menu-empty-note">多账号会话或当前邮件不可移动</span>
              )}
            </div>
          </details>
        </div>
      </header>
      <div className="thread-stack">
        {threadMessages.map((message) => (
          <section
            className={message.id === selectedId ? 'thread-message active' : 'thread-message'}
            key={message.id}
            onClick={() => onSelectMessage(message.id)}
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

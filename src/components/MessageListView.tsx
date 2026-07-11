import {
  Paperclip,
  Search,
} from 'lucide-react';
import type {
  FilterMode,
  Message,
} from '../app/types';
import { formatDate } from '../mailUtils';
import { writeMessageDragPayload } from './messageDrag';

type MessageGroup = {
  id: string;
  label: string;
  messages: Message[];
};

type MessageListViewProps = {
  groups: MessageGroup[];
  messages: Message[];
  query: string;
  filter: FilterMode;
  selectedId: number | null;
  hasMoreMessages: boolean;
  selectedMessageIds: number[];
  draggingMessageIds: number[];
  onSelectMessage: (messageId: number) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onOpenMessageMenu: (message: Message, x: number, y: number, bulk: boolean) => void;
  onCloseMessageMenu: () => void;
  onSetDraggingMessageIds: (messageIds: number[]) => void;
  onClearSearchAndFilter: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
};

const REMOTE_HEADER_ONLY_SNIPPET = '远端邮件头已同步';

function stripHtmlPreview(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function messagePreview(message: Message): string {
  const bodyPreview = stripHtmlPreview(message.body || message.sanitized_html || '');
  if (bodyPreview) return bodyPreview;
  if (!message.snippet.includes(REMOTE_HEADER_ONLY_SNIPPET)) {
    return stripHtmlPreview(message.snippet);
  }
  return '';
}

export default function MessageListView({
  groups,
  messages,
  query,
  filter,
  selectedId,
  hasMoreMessages,
  selectedMessageIds,
  draggingMessageIds,
  onSelectMessage,
  onToggleMessageSelection,
  onToggleAllVisible,
  onOpenMessageMenu,
  onCloseMessageMenu,
  onSetDraggingMessageIds,
  onClearSearchAndFilter,
  onRefresh,
  onLoadMore,
}: MessageListViewProps) {
  const selectedMessageSet = new Set(selectedMessageIds);
  const draggingMessageSet = new Set(draggingMessageIds);

  return (
    <div className="message-list">
      {groups.map((group) => (
        <section className="message-date-section" key={group.id}>
          <header className="message-date-header">
            <span>{group.label}</span>
            <em>{group.messages.length} 封</em>
          </header>
          {group.messages.map((message) => {
            const preview = messagePreview(message);
            return (
              <button
                key={message.id}
                className={[
                  'message-card',
                  message.is_read ? 'is-read' : 'is-unread',
                  message.id === selectedId ? 'selected' : '',
                  draggingMessageSet.has(message.id) ? 'dragging' : '',
                ].filter(Boolean).join(' ')}
                draggable
                onClick={() => onSelectMessage(message.id)}
                onDragStart={(event) => {
                  const messageIds = selectedMessageSet.has(message.id) && selectedMessageIds.length > 0
                    ? selectedMessageIds
                    : [message.id];
                  const writtenIds = writeMessageDragPayload(event.dataTransfer, messageIds);
                  if (writtenIds.length === 0) {
                    event.preventDefault();
                    return;
                  }
                  onCloseMessageMenu();
                  onSetDraggingMessageIds(writtenIds);
                }}
                onDragEnd={() => onSetDraggingMessageIds([])}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const useBulkContext = selectedMessageSet.has(message.id) && selectedMessageIds.length > 1;
                  if (!useBulkContext && selectedMessageIds.length > 0 && !selectedMessageSet.has(message.id)) {
                    onToggleAllVisible(false);
                  }
                  onSelectMessage(message.id);
                  onOpenMessageMenu(message, event.clientX, event.clientY, useBulkContext);
                }}
              >
                <span
                  className={`message-avatar avatar-tone-${Math.abs(message.id) % 6}`}
                  aria-hidden="true"
                >
                  {(message.sender_name || message.sender_email || '?').trim().slice(0, 1).toUpperCase()}
                </span>
                {!message.is_read && <span className="message-unread-dot" aria-label="未读" />}
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
                {preview && <p title={preview}>{preview}</p>}
                <div className="message-chips">
                  {message.labels.map((label) => <span key={label}>{label}</span>)}
                  {message.attachment_count > 0 && <span><Paperclip size={12} /> {message.attachment_count}</span>}
                </div>
              </button>
            );
          })}
        </section>
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
  );
}

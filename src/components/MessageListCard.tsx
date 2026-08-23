import React, { useEffect, useMemo, useRef } from 'react';
import { Paperclip } from 'lucide-react';
import type { MessageSummary } from '../app/types';
import { formatDate, mailboxListPreview } from '../mailUtils';
import { writeMessageDragPayload } from './messageDrag';
import { senderAvatarTone } from '../app/messageDetailUtils';
import Avatar from './Avatar';

type MessageListCardProps = {
  message: MessageSummary;
  isCurrentMessage: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isNew: boolean;
  hasBulkSelection: boolean;
  selectedMessageIdsRef: React.MutableRefObject<number[]>;
  onSelectMessage: (messageId: number) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onOpenMessageMenu: (message: MessageSummary, x: number, y: number, bulk: boolean) => void;
  onCloseMessageMenu: () => void;
  onSetDraggingMessageIds: (messageIds: number[]) => void;
};

export default React.memo(function MessageListCard({
  message,
  isCurrentMessage,
  isSelected,
  isDragging,
  isNew,
  hasBulkSelection,
  selectedMessageIdsRef,
  onSelectMessage,
  onToggleMessageSelection,
  onToggleAllVisible,
  onOpenMessageMenu,
  onCloseMessageMenu,
  onSetDraggingMessageIds,
}: MessageListCardProps) {
  const mainButtonRef = useRef<HTMLButtonElement | null>(null);
  const preview = useMemo(() => mailboxListPreview(message), [message]);
  const cardLabel = [
    `查看邮件：${message.sender_name || '未知发件人'}，${formatDate(message.received_at)}，`,
    message.subject || '无主题',
    message.is_read ? '' : '，未读',
    `。按回车打开，按空格${isSelected ? '取消选择' : '选择'}`,
  ].join('');

  // J/K and Arrow navigation update the current message outside this row.
  // If keyboard focus was already in the list, follow that state change so
  // the visible focus ring and the reader selection never diverge.
  useEffect(() => {
    if (!isCurrentMessage || !mainButtonRef.current) return;
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !activeElement.closest('.message-list')) return;
    if (activeElement === mainButtonRef.current) return;
    mainButtonRef.current.focus({ preventScroll: true });
  }, [isCurrentMessage]);

  return (
    <div
      className={[
        'message-card',
        message.is_read ? 'is-read' : 'is-unread',
        isCurrentMessage ? 'selected is-current' : '',
        isDragging ? 'dragging' : '',
        isNew ? 'is-new' : '',
      ].filter(Boolean).join(' ')}
      data-message-id={message.id}
      style={{ width: '100%', height: '100%', minHeight: '0px', display: 'block' }}
      draggable
      onClick={() => onSelectMessage(message.id)}
      onDragStart={(event) => {
        const selectedMessageIds = selectedMessageIdsRef.current;
        const messageIds = isSelected && selectedMessageIds.length > 0
          ? [...selectedMessageIds]
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
        const selectedMessageIds = selectedMessageIdsRef.current;
        const useBulkContext = isSelected && hasBulkSelection;
        if (!useBulkContext && selectedMessageIds.length > 0 && !isSelected) {
          onToggleAllVisible(false);
        }
        onSelectMessage(message.id);
        onOpenMessageMenu(message, event.clientX, event.clientY, useBulkContext);
      }}
    >
      <button
        ref={mainButtonRef}
        type="button"
        className="message-card-main"
        aria-label={cardLabel}
        aria-current={isCurrentMessage ? 'true' : undefined}
        aria-keyshortcuts="Enter Space"
        tabIndex={isCurrentMessage ? 0 : -1}
        onKeyDown={(event) => {
          if (event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          onToggleMessageSelection(message.id, !isSelected);
        }}
        onClick={(event) => {
          event.stopPropagation();
          onSelectMessage(message.id);
        }}
      />
      {!message.is_read && <span className="message-unread-dot" aria-hidden="true" />}
      <span className="message-leading" aria-hidden="true">
        <Avatar
          email={message.sender_email}
          name={message.sender_name}
          className={`message-avatar avatar-tone-${senderAvatarTone(message.sender_name, message.sender_email)}`}
        />
      </span>
      <label className="message-select" onClick={(event) => event.stopPropagation()}>
        <input
          aria-label={`选择 ${message.subject || '无主题'}`}
          checked={isSelected}
          type="checkbox"
          tabIndex={-1}
          onChange={(event) => onToggleMessageSelection(message.id, event.target.checked)}
        />
      </label>
      <div className="message-topline">
        <span className={message.is_read ? 'sender' : 'sender unread'}>{message.sender_name}</span>
        <time>{formatDate(message.received_at)}</time>
      </div>
      <div className="message-subject-line">
        <span className={message.is_read ? 'subject' : 'subject unread'}>
          {message.is_starred ? '★ ' : ''}{message.subject || '(无主题)'}
        </span>
        {message.attachment_count > 0 && (
          <span className="message-attachment" title={`${message.attachment_count} 个附件`}>
            <Paperclip size={11} aria-hidden="true" />
            {message.attachment_count}
          </span>
        )}
      </div>
      {preview && <p title={preview}>{preview}</p>}
      <div className="message-chips">
        {message.labels.slice(0, 2).map((label) => <span key={label} title={label}>{label}</span>)}
        {message.labels.length > 2 && (
          <span title={message.labels.slice(2).join(', ')}>
            +{message.labels.length - 2}
          </span>
        )}
      </div>
    </div>
  );
});

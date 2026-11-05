import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { MoreHorizontal, Paperclip, Star } from 'lucide-react';
import type { MessageSummary } from '../app/types';
import { formatDate, formatListDate, mailboxListPreview } from '../mailUtils';
import { writeMessageDragPayload } from './messageDrag';
import Avatar from './Avatar';
import useLongPress from '../hooks/useLongPress';
import { MESSAGE_ROW_HEIGHT, MOBILE_MESSAGE_ROW_HEIGHT } from './messageListLayout';

type MessageListCardProps = {
  mobile?: boolean;
  showAccountSource?: boolean;
  showAccountSourceLabel?: boolean;
  accountSourceLabels?: ReadonlyMap<number, string>;
  message: MessageSummary;
  isCurrentMessage: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isNew: boolean;
  claimFocus?: boolean;
  isSelectionMode?: boolean;
  hasBulkSelection: boolean;
  selectedMessageIdsRef: React.MutableRefObject<number[]>;
  onSelectMessage: (messageId: number) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onOpenMessageMenu: (message: MessageSummary, x: number, y: number, bulk: boolean) => void;
  onCloseMessageMenu: () => void;
  onSetDraggingMessageIds: (messageIds: number[]) => void;
  onFocusClaimed?: () => void;
};

export default React.memo(function MessageListCard({
  mobile = false,
  showAccountSource = false,
  showAccountSourceLabel = showAccountSource,
  accountSourceLabels,
  message,
  isCurrentMessage,
  isSelected,
  isDragging,
  isNew,
  claimFocus = false,
  isSelectionMode = false,
  hasBulkSelection,
  selectedMessageIdsRef,
  onSelectMessage,
  onToggleMessageSelection,
  onToggleAllVisible,
  onOpenMessageMenu,
  onCloseMessageMenu,
  onSetDraggingMessageIds,
  onFocusClaimed,
}: MessageListCardProps) {
  const mainButtonRef = useRef<HTMLButtonElement | null>(null);
  const accountSource = showAccountSource ? message.account_email.trim() : '';
  const accountSourceShort = accountSourceLabels?.get(message.account_id)?.trim() || accountSource;
  const preview = useMemo(() => mailboxListPreview(message), [message]);
  const metadataLabelState = useMemo(() => {
    const normalizedIdentity = new Set([
      message.sender_name,
      message.sender_email,
      message.account_email,
      message.subject,
    ].map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
    const labels = message.labels
      .filter((label) => {
        const normalizedLabel = label.trim().toLocaleLowerCase();
        return normalizedLabel.length > 0 && !normalizedIdentity.has(normalizedLabel);
      });
    return {
      labels: labels.slice(0, 2),
      overflow: Math.max(0, labels.length - 2),
    };
  }, [message.account_email, message.labels, message.sender_email, message.sender_name, message.subject]);
  const metadataLabels = metadataLabelState.labels;
  const cardLabel = [
    `${mobile && isSelectionMode ? '选择邮件' : '查看邮件'}：${message.sender_name || '未知发件人'}，${formatDate(message.received_at)}，`,
    message.subject || '无主题',
    accountSource ? `，来源邮箱：${accountSource}` : '',
    message.is_read ? '' : '，未读',
    mobile && isSelectionMode ? `，${isSelected ? '已选择' : '未选择'}` : `。按回车打开，按空格${isSelected ? '取消选择' : '选择'}`,
  ].join('');

  function activateMessage() {
    if (mobile && isSelectionMode) onToggleMessageSelection(message.id, !isSelected);
    else onSelectMessage(message.id);
  }

  function openMessageMenuAt(x: number, y: number) {
    const selectedMessageIds = selectedMessageIdsRef.current;
    const useBulkContext = isSelected && hasBulkSelection;
    if (!useBulkContext && selectedMessageIds.length > 0 && !isSelected) {
      onToggleAllVisible(false);
    }
    // On mobile the row action menu is an in-place action surface. Selecting
    // the row here would immediately push the reader screen and unmount the
    // menu before the user can choose archive, snooze, move, or delete.
    if (!mobile) onSelectMessage(message.id);
    onOpenMessageMenu(message, x, y, useBulkContext);
  }

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

  // A newly virtualized row claims focus only after its real button has been
  // committed. This avoids timing guesses in the parent list while keeping
  // the handoff synchronous with the row becoming interactive.
  useLayoutEffect(() => {
    const trigger = mainButtonRef.current;
    if (!claimFocus || !trigger) return;
    trigger.focus({ preventScroll: true });
    if (typeof trigger.scrollIntoView === 'function') {
      trigger.scrollIntoView({ block: 'nearest' });
    }
    onFocusClaimed?.();
  }, [claimFocus, onFocusClaimed]);

  const longPress = useLongPress(mobile, message.id, openMessageMenuAt);

  return (
    <div
      className={[
        'message-card',
        message.is_read ? 'is-read' : 'is-unread',
        isCurrentMessage && !mobile ? 'selected is-current' : '',
        isSelected ? 'is-selected' : '',
        isSelectionMode ? 'is-selection-mode' : '',
        isDragging ? 'dragging' : '',
        isNew ? 'is-new' : '',
      ].filter(Boolean).join(' ')}
      data-message-id={message.id}
      data-folder-role={message.folder_role}
      style={{ minHeight: mobile ? MOBILE_MESSAGE_ROW_HEIGHT : MESSAGE_ROW_HEIGHT }}
      draggable={!mobile}
      onClick={activateMessage}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
      onClickCapture={longPress.onClickCapture}
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
        longPress.consumeContextGesture();
        event.preventDefault();
        openMessageMenuAt(event.clientX, event.clientY);
      }}
    >
      <button
        ref={mainButtonRef}
        type="button"
        className="message-card-main"
        aria-label={cardLabel}
        aria-current={isCurrentMessage && !mobile ? 'true' : undefined}
        aria-keyshortcuts="Enter Space Shift+F10"
        tabIndex={isCurrentMessage ? 0 : -1}
        onKeyDown={(event) => {
          if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
            event.preventDefault();
            event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            openMessageMenuAt(
              bounds.left + Math.min(bounds.width / 2, 220),
              bounds.top + bounds.height / 2,
            );
            return;
          }
          if (event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          onToggleMessageSelection(message.id, !isSelected);
        }}
        onClick={(event) => {
          event.stopPropagation();
          activateMessage();
        }}
      />
      {mobile && !isSelectionMode && (
        <button
          type="button"
          className="message-mobile-menu-button"
          data-no-long-press="true"
          aria-label={`打开邮件操作：${message.subject || '无主题'}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            openMessageMenuAt(bounds.left, bounds.bottom + 4);
          }}
        >
          <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
      {!message.is_read && <span className="message-unread-dot" aria-hidden="true" />}
      <span className="message-leading" aria-hidden="true">
        <Avatar
          email={message.sender_email}
          name={message.sender_name}
          className="message-avatar"
        />
      </span>
      <label className="message-select" onClick={(event) => event.stopPropagation()}>
        <input
          aria-label={`选择 ${message.subject || '无主题'}`}
          checked={isSelected}
          type="checkbox"
          tabIndex={isSelectionMode ? 0 : -1}
          onChange={(event) => onToggleMessageSelection(message.id, event.target.checked)}
        />
      </label>
      <div className="message-topline">
        <span className={message.is_read ? 'sender' : 'sender unread'}>{message.sender_name}</span>
        <time dateTime={message.received_at} title={formatDate(message.received_at)}>{formatListDate(message.received_at)}</time>
      </div>
      <div className="message-subject-line">
        <span className={message.is_read ? 'subject' : 'subject unread'}>
          {message.is_starred && <span className="message-star-glyph" role="img" aria-label="星标"><Star size={14} strokeWidth={1.75} fill="currentColor" aria-hidden="true" /></span>}{message.subject || '(无主题)'}
        </span>
        {message.attachment_count > 0 && (
          <span className="message-attachment" title={`${message.attachment_count} 个附件`}>
            <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
            {message.attachment_count}
          </span>
        )}
      </div>
      <div className="message-bottomline">
        {preview && <p title={preview}>{preview}</p>}
        {!preview && metadataLabels.length > 0 && (
          <div className="message-chips" aria-label="邮件元数据">
            {metadataLabels.map((label) => <span key={label} title={label}>{label}</span>)}
            {metadataLabelState.overflow > 0 && (
              <span title={message.labels.join(', ')}>
                +{metadataLabelState.overflow}
              </span>
            )}
          </div>
        )}
        {accountSource && showAccountSourceLabel && (
          <span className="message-account-source" title={`来源邮箱：${accountSource}`}>
            {accountSourceShort}
          </span>
        )}
      </div>
    </div>
  );
});

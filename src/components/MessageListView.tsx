import React, { useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Paperclip,
  Search,
} from 'lucide-react';
import type {
  FilterMode,
  Message,
} from '../app/types';
import { formatDate, mailboxListPreview } from '../mailUtils';
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
  listStateKey: string;
  initialScrollTop: number;
  selectedMessageIds: number[];
  draggingMessageIds: number[];
  onScrollTopChange: (scrollTop: number) => void;
  onSelectMessage: (messageId: number) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onOpenMessageMenu: (message: Message, x: number, y: number, bulk: boolean) => void;
  onCloseMessageMenu: () => void;
  onSetDraggingMessageIds: (messageIds: number[]) => void;
  onClearSearchAndFilter: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  loadMoreStatus?: string | null;
};

type MessageListCardProps = {
  message: Message;
  preview: string;
  isCurrentMessage: boolean;
  isSelected: boolean;
  isDragging: boolean;
  isNew: boolean;
  hasBulkSelection: boolean;
  selectedMessageIdsRef: React.MutableRefObject<number[]>;
  onSelectMessage: (messageId: number) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onToggleAllVisible: (checked: boolean) => void;
  onOpenMessageMenu: (message: Message, x: number, y: number, bulk: boolean) => void;
  onCloseMessageMenu: () => void;
  onSetDraggingMessageIds: (messageIds: number[]) => void;
};

const MessageListCard = React.memo(function MessageListCard({
  message,
  preview,
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
  const avatarInitial = (message.sender_name || message.sender_email || '?').trim().slice(0, 1).toUpperCase();

  return (
    <button
      className={[
        'message-card',
        message.is_read ? 'is-read' : 'is-unread',
        isCurrentMessage ? 'selected is-current' : '',
        isDragging ? 'dragging' : '',
        isNew ? 'is-new' : '',
      ].filter(Boolean).join(' ')}
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
      <span className="message-leading" aria-hidden="true">
        <span className={`message-avatar avatar-tone-${Math.abs(message.id) % 6}`}>
          {avatarInitial}
        </span>
        {!message.is_read && <span className="message-unread-dot" aria-label="未读" />}
      </span>
      <span className="message-select" onClick={(event) => event.stopPropagation()}>
        <input
          aria-label={`选择 ${message.subject || '无主题'}`}
          checked={isSelected}
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
});

export default function MessageListView({
  groups,
  messages,
  query,
  filter,
  selectedId,
  hasMoreMessages,
  listStateKey,
  initialScrollTop,
  selectedMessageIds,
  draggingMessageIds,
  onScrollTopChange,
  onSelectMessage,
  onToggleMessageSelection,
  onToggleAllVisible,
  onOpenMessageMenu,
  onCloseMessageMenu,
  onSetDraggingMessageIds,
  onClearSearchAndFilter,
  onRefresh,
  onLoadMore,
  loadMoreStatus,
}: MessageListViewProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevIdsRef = useRef<Set<number>>(new Set());
  const restoredViewKeyRef = useRef<string | null>(null);
  const latestScrollTopRef = useRef(initialScrollTop);
  const lastScrollSaveAtRef = useRef(Number.NEGATIVE_INFINITY);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const prevIds = prevIdsRef.current;

  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const [viewportHeight, setViewportHeight] = useState(600);

  const messagePreviewMap = useMemo(
    () => new Map(messages.map((message) => [message.id, mailboxListPreview(message)])),
    [messages],
  );

  const newIds = useMemo(() => {
    const set = new Set<number>();
    if (prevIds.size > 0) {
      for (const message of messages) {
        if (!prevIds.has(message.id)) {
          set.add(message.id);
        }
      }
    }
    return set;
  }, [messages]);

  useEffect(() => {
    prevIdsRef.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  useEffect(() => () => {
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
    }
    onScrollTopChange(latestScrollTopRef.current);
  }, [listStateKey, onScrollTopChange]);

  useLayoutEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;
    const isNewView = restoredViewKeyRef.current !== listStateKey;
    const requestedScrollTop = isNewView ? initialScrollTop : latestScrollTopRef.current;
    const maxScrollTop = Math.max(0, listElement.scrollHeight - listElement.clientHeight);
    const nextScrollTop = Math.min(Math.max(0, requestedScrollTop), maxScrollTop);
    listElement.scrollTop = nextScrollTop;
    latestScrollTopRef.current = nextScrollTop;
    setScrollTop(nextScrollTop);
    restoredViewKeyRef.current = listStateKey;
  }, [listStateKey, initialScrollTop, messages.length]);

  useLayoutEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;
    setViewportHeight(listElement.clientHeight);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setViewportHeight(entry.target.clientHeight);
        }
      });
      observer.observe(listElement);
      return () => observer.disconnect();
    }
  }, []);

  const flatItems = useMemo(() => {
    const list: (
      | { type: 'header'; id: string; label: string; count: number }
      | { type: 'message'; message: Message }
    )[] = [];
    for (const group of groups) {
      list.push({ type: 'header', id: group.id, label: group.label, count: group.messages.length });
      for (const msg of group.messages) {
        list.push({ type: 'message', message: msg });
      }
    }
    return list;
  }, [groups]);

  const { layout, totalHeight } = useMemo(() => {
    const layout: { top: number; height: number }[] = [];
    let currentTop = 0;
    for (const item of flatItems) {
      let height = 34;
      if (item.type === 'message') {
        const preview = messagePreviewMap.get(item.message.id) ?? '';
        const hasPreview = Boolean(preview.trim());
        const hasChips = item.message.labels.length > 0 || item.message.attachment_count > 0;
        if (hasPreview && hasChips) {
          height = 102;
        } else if (hasPreview || hasChips) {
          height = 83;
        } else {
          height = 68;
        }
      }
      layout.push({ top: currentTop, height });
      currentTop += height;
    }
    return { layout, totalHeight: currentTop };
  }, [flatItems, messagePreviewMap]);

  function handleListScroll(event: React.UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop;
    latestScrollTopRef.current = nextScrollTop;
    setScrollTop(nextScrollTop);

    const now = performance.now();
    if (now - lastScrollSaveAtRef.current < 160) return;
    lastScrollSaveAtRef.current = now;
    onScrollTopChange(nextScrollTop);
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
    }
    scrollSaveTimerRef.current = window.setTimeout(() => {
      scrollSaveTimerRef.current = null;
      onScrollTopChange(latestScrollTopRef.current);
    }, 180);
  }

  useEffect(() => {
    const triggerThreshold = 300;
    if (hasMoreMessages && totalHeight - (scrollTop + viewportHeight) < triggerThreshold) {
      onLoadMore();
    }
  }, [scrollTop, viewportHeight, totalHeight, hasMoreMessages, onLoadMore]);

  const selectedMessageSet = useMemo(
    () => new Set(selectedMessageIds),
    [selectedMessageIds],
  );
  const selectedMessageIdsRef = React.useRef(selectedMessageIds);
  selectedMessageIdsRef.current = selectedMessageIds;
  const draggingMessageSet = useMemo(
    () => new Set(draggingMessageIds),
    [draggingMessageIds],
  );

  const startIdx = useMemo(() => {
    let low = 0;
    let high = layout.length - 1;
    let index = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (layout[mid].top + layout[mid].height >= scrollTop - 200) {
        index = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return Math.max(0, index);
  }, [layout, scrollTop]);

  const endIdx = useMemo(() => {
    let low = startIdx;
    let high = layout.length - 1;
    let index = layout.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (layout[mid].top <= scrollTop + viewportHeight + 200) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.min(layout.length - 1, index);
  }, [layout, startIdx, scrollTop, viewportHeight]);

  const visibleItems = useMemo(() => {
    const items = [];
    for (let i = startIdx; i <= endIdx && i < flatItems.length; i++) {
      items.push({
        index: i,
        item: flatItems[i],
        style: {
          position: 'absolute' as const,
          top: 0,
          left: 0,
          right: 0,
          height: layout[i].height,
          transform: `translateY(${layout[i].top}px)`,
        },
      });
    }
    return items;
  }, [flatItems, layout, startIdx, endIdx]);

  return (
    <div className="message-list" ref={listRef} onScroll={handleListScroll}>
      {messages.length > 0 && (
        <div
          className="message-list-viewport-wrapper"
          style={{
            position: 'relative',
            height: totalHeight + 40,
            width: '100%',
          }}
        >
          {visibleItems.map(({ index, item, style }) => {
            if (item.type === 'header') {
              const borderTop = index > 0 ? '1px solid #edf0f3' : 'none';
              return (
                <header
                  className="message-date-header"
                  style={{ ...style, borderTop }}
                  key={`header-${item.id}`}
                >
                  <span>{item.label}</span>
                  <em>{item.count} 封</em>
                </header>
              );
            } else {
              const message = item.message;
              return (
                <div style={style} key={`msg-wrapper-${message.id}`}>
                  <MessageListCard
                    message={message}
                    preview={messagePreviewMap.get(message.id) ?? ''}
                    isCurrentMessage={message.id === selectedId}
                    isSelected={selectedMessageSet.has(message.id)}
                    isDragging={draggingMessageSet.has(message.id)}
                    isNew={newIds.has(message.id)}
                    hasBulkSelection={selectedMessageIds.length > 1}
                    selectedMessageIdsRef={selectedMessageIdsRef}
                    onSelectMessage={onSelectMessage}
                    onToggleMessageSelection={onToggleMessageSelection}
                    onToggleAllVisible={onToggleAllVisible}
                    onOpenMessageMenu={onOpenMessageMenu}
                    onCloseMessageMenu={onCloseMessageMenu}
                    onSetDraggingMessageIds={onSetDraggingMessageIds}
                  />
                </div>
              );
            }
          })}
          <div
            className="message-list-footer"
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              color: '#8b96a4',
              borderTop: '1px solid #e7ebf0',
              background: '#fafbfc',
            }}
          >
            <span>
              已显示 {messages.length} 封
              {loadMoreStatus ? ` · ${loadMoreStatus}` : (hasMoreMessages ? ' · 自动同步中...' : ' · 已到底')}
            </span>
          </div>
        </div>
      )}

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
    </div>
  );
}

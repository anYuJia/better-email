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
import Avatar from './Avatar';

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
  const preview = useMemo(() => mailboxListPreview(message), [message]);
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
        <Avatar
          email={message.sender_email}
          name={message.sender_name}
          className={`message-avatar avatar-tone-${Math.abs(message.id) % 6}`}
          fallbackInitial={avatarInitial}
        />
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
        {message.labels.slice(0, 2).map((label) => <span key={label} title={label}>{label}</span>)}
        {message.labels.length > 2 && (
          <span title={message.labels.slice(2).join(', ')}>
            +{message.labels.length - 2}
          </span>
        )}
        {message.attachment_count > 0 && <span title={`${message.attachment_count} 个附件`}><Paperclip size={12} /> {message.attachment_count}</span>}
      </div>
    </button>
  );
});

type LayoutItem = { top: number; height: number };

function calculateVisibleRange(
  layout: LayoutItem[],
  scrollTop: number,
  viewportHeight: number
) {
  if (layout.length === 0) {
    return { startIdx: 0, endIdx: 0 };
  }

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
  const startIdx = Math.max(0, index);

  low = startIdx;
  high = layout.length - 1;
  let endIndex = layout.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (layout[mid].top <= scrollTop + viewportHeight + 200) {
      endIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const endIdx = Math.min(layout.length - 1, endIndex);

  return { startIdx, endIdx };
}

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
  const rafIdRef = useRef<number | null>(null);
  const prevIds = prevIdsRef.current;

  const [viewportHeight, setViewportHeight] = useState(600);
  const [, setScrollTop] = useState(initialScrollTop);

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
        height = 96;
      }
      layout.push({ top: currentTop, height });
      currentTop += height;
    }
    return { layout, totalHeight: currentTop };
  }, [flatItems]);

  const [visibleRange, setVisibleRange] = useState(() =>
    calculateVisibleRange(layout, latestScrollTopRef.current, viewportHeight)
  );

  const visibleRangeRef = useRef(visibleRange);
  visibleRangeRef.current = visibleRange;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const viewportHeightRef = useRef(viewportHeight);
  viewportHeightRef.current = viewportHeight;

  // Synchronize visibleRange when layout or viewportHeight changes
  const prevLayoutRef = useRef(layout);
  const prevViewportHeightRef = useRef(viewportHeight);
  if (layout !== prevLayoutRef.current || viewportHeight !== prevViewportHeightRef.current) {
    prevLayoutRef.current = layout;
    prevViewportHeightRef.current = viewportHeight;
    const nextRange = calculateVisibleRange(layout, latestScrollTopRef.current, viewportHeight);
    setVisibleRange(nextRange);
  }

  useLayoutEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;
    const isNewView = restoredViewKeyRef.current !== listStateKey;
    const requestedScrollTop = isNewView ? initialScrollTop : latestScrollTopRef.current;
    listElement.scrollTop = requestedScrollTop;
    latestScrollTopRef.current = requestedScrollTop;
    setScrollTop(requestedScrollTop);
    const nextRange = calculateVisibleRange(layout, requestedScrollTop, viewportHeight);
    setVisibleRange(nextRange);
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

  function handleListScroll(event: React.UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop;
    latestScrollTopRef.current = nextScrollTop;

    const triggerThreshold = 1000;
    if (hasMoreMessages && !loadMoreStatus && totalHeight - (nextScrollTop + viewportHeight) < triggerThreshold) {
      onLoadMore();
    }

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const nextRange = calculateVisibleRange(layoutRef.current, nextScrollTop, viewportHeightRef.current);
      if (
        nextRange.startIdx !== visibleRangeRef.current.startIdx ||
        nextRange.endIdx !== visibleRangeRef.current.endIdx
      ) {
        setVisibleRange(nextRange);
      }
    });

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
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (scrollSaveTimerRef.current !== null) {
        window.clearTimeout(scrollSaveTimerRef.current);
      }
    };
  }, []);

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

  const visibleItems = useMemo(() => {
    const items = [];
    const { startIdx, endIdx } = visibleRange;
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
  }, [flatItems, layout, visibleRange]);

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
              {hasMoreMessages ? (
                loadMoreStatus ? ` · ${loadMoreStatus}` : (
                  <>
                    {' · '}
                    <button
                      type="button"
                      className="btn-load-more"
                      disabled={Boolean(loadMoreStatus)}
                      aria-busy={Boolean(loadMoreStatus)}
                      onClick={() => {
                        if (!loadMoreStatus) onLoadMore();
                      }}
                    >
                      加载更多
                    </button>
                  </>
                )
              ) : ' · 已到底'}
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

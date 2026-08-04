import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type {
  FilterMode,
  Message,
  MessageSummary,
} from '../app/types';
import MessageListCard from './MessageListCard';
import { calculateVisibleRange } from './messageListLayout';

const SCROLL_SAVE_DEBOUNCE_MS = 220;
const NEW_MESSAGE_ANIMATION_LIMIT = 5;
const NEW_MESSAGE_ABSORB_DELAY_MS = 800;

type MessageGroup = {
  id: string;
  label: string;
  messages: MessageSummary[];
};

type MessageListViewProps = {
  groups: MessageGroup[];
  messages: MessageSummary[];
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
  onOpenMessageMenu: (message: MessageSummary, x: number, y: number, bulk: boolean) => void;
  onCloseMessageMenu: () => void;
  onSetDraggingMessageIds: (messageIds: number[]) => void;
  onClearSearchAndFilter: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  loadMoreStatus?: string | null;
};

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
  const restoredViewKeyRef = useRef<string | null>(null);
  const latestScrollTopRef = useRef(initialScrollTop);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const listStateKeyRef = useRef<string | null>(null);
  const baselineMessageIdsRef = useRef<Set<number>>(new Set());
  const newMessageExceededRef = useRef(false);

  const [viewportHeight, setViewportHeight] = useState(600);
  const [, setScrollTop] = useState(initialScrollTop);

  const newIds = useMemo(() => {
    const set = new Set<number>();
    if (listStateKeyRef.current !== listStateKey) {
      newMessageExceededRef.current = false;
      return set;
    }
    const baseline = baselineMessageIdsRef.current;
    if (baseline.size === 0) return set;
    let count = 0;
    for (const message of messages) {
      if (baseline.has(message.id)) continue;
      count += 1;
      if (count > NEW_MESSAGE_ANIMATION_LIMIT) {
        newMessageExceededRef.current = true;
        return set;
      }
      set.add(message.id);
    }
    newMessageExceededRef.current = false;
    return set;
  }, [messages, listStateKey]);

  useEffect(() => () => {
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
    }
    onScrollTopChange(latestScrollTopRef.current);
  }, [listStateKey, onScrollTopChange]);

  const flatItems = useMemo(() => {
    const list: (
      | { type: 'header'; id: string; label: string; count: number }
      | { type: 'message'; message: MessageSummary }
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

  // Synchronize visibleRange when layout or viewportHeight changes (layout effect, not render phase)
  useLayoutEffect(() => {
    const nextRange = calculateVisibleRange(layout, latestScrollTopRef.current, viewportHeight);
    setVisibleRange((current) => (
      nextRange.startIdx === current.startIdx && nextRange.endIdx === current.endIdx
        ? current
        : nextRange
    ));
  }, [layout, viewportHeight]);

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
    if (isNewView) {
      listStateKeyRef.current = listStateKey;
      baselineMessageIdsRef.current = new Set(messages.map((m) => m.id));
    } else if (newMessageExceededRef.current) {
      baselineMessageIdsRef.current = new Set(messages.map((m) => m.id));
    }
  }, [listStateKey, initialScrollTop, messages.length]);

  // Absorb newly added ids after their appearance animation has finished, so
  // the is-new highlight is not replayed when virtualized cards remount.
  useLayoutEffect(() => {
    if (newIds.size === 0) return undefined;
    const absorb = () => {
      baselineMessageIdsRef.current = new Set(messages.map((m) => m.id));
    };
    const timer = window.setTimeout(absorb, NEW_MESSAGE_ABSORB_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [newIds, messages, listStateKey]);

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

    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
    }
    scrollSaveTimerRef.current = window.setTimeout(() => {
      scrollSaveTimerRef.current = null;
      onScrollTopChange(latestScrollTopRef.current);
    }, SCROLL_SAVE_DEBOUNCE_MS);
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

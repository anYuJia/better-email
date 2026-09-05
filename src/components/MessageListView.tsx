import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type {
  FilterMode,
  MessageSummary,
} from '../app/types';
import { messageMatchesLocalDateTimeRange, type LocalDateTimeRange } from '../mailUtils';
import MessageListCard from './MessageListCard';
import MessageDateRangePicker from './MessageDateRangePicker';
import { installScrollbarThumbDrag } from '../hooks/scrollbarThumbDrag';
import {
  GROUP_HEADER_HEIGHT,
  LIST_FOOTER_HEIGHT,
  MOBILE_MESSAGE_ROW_HEIGHT,
  MESSAGE_ROW_HEIGHT,
  calculateVisibleRange,
} from './messageListLayout';

const SCROLL_SAVE_DEBOUNCE_MS = 220;
const NEW_MESSAGE_ANIMATION_LIMIT = 5;
const NEW_MESSAGE_ABSORB_DELAY_MS = 800;
const SCROLLBAR_HIDE_DELAY_MS = 1200;
const SCROLLBAR_SIZE_PX = 6;
const SCROLLBAR_INSET_PX = 3;
const SCROLLBAR_MIN_LENGTH_PX = 32;

type MessageGroup = {
  id: string;
  label: string;
  messages: MessageSummary[];
};

type FlatListItem =
  | { type: 'header'; id: string; key: string; label: string; count: number; messageIds: number[] }
  | { type: 'message'; key: string; message: MessageSummary };

type MessageListViewProps = {
  mobile?: boolean;
  showAccountSource?: boolean;
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
  isSelectingAll?: boolean;
  isAllMessagesSelected?: boolean;
  onToggleMessageGroup?: (groupId: string, messageIds: number[], checked: boolean) => void | Promise<void>;
  isSelectingMessageGroup?: boolean;
  onSelectMessageDateRange?: (range: LocalDateTimeRange) => void;
  onOpenMessageMenu: (message: MessageSummary, x: number, y: number, bulk: boolean) => void;
  onCloseMessageMenu: () => void;
  onSetDraggingMessageIds: (messageIds: number[]) => void;
  onClearSearchAndFilter: () => void;
  onRefresh: () => void;
  onLoadMore: () => Promise<MessageSummary[]>;
  loadMoreStatus?: string | null;
};

export default function MessageListView({
  mobile = false,
  showAccountSource = false,
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
  isSelectingAll = false,
  isAllMessagesSelected = false,
  onToggleMessageGroup,
  isSelectingMessageGroup = false,
  onSelectMessageDateRange,
  onOpenMessageMenu,
  onCloseMessageMenu,
  onSetDraggingMessageIds,
  onClearSearchAndFilter,
  onRefresh,
  onLoadMore,
  loadMoreStatus,
}: MessageListViewProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const restoredViewKeyRef = useRef<string | null>(null);
  const latestScrollTopRef = useRef(initialScrollTop);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const scrollbarHideTimerRef = useRef<number | null>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement | null>(null);
  const scrollbarMetricsRef = useRef({ top: 0, height: 0 });
  const rafIdRef = useRef<number | null>(null);
  const listStateKeyRef = useRef<string | null>(null);
  const baselineMessageIdsRef = useRef<Set<number>>(new Set());
  const newMessageExceededRef = useRef(false);

  const [viewportHeight, setViewportHeight] = useState(600);
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => mobile || (typeof window !== 'undefined' && window.innerWidth <= 720),
  );
  const [, setScrollTop] = useState(initialScrollTop);
  const [heightCacheVersion, setHeightCacheVersion] = useState(0);
  const [isScrollbarVisible, setIsScrollbarVisible] = useState(false);
  const [scrollbarThumb, setScrollbarThumb] = useState({ top: 0, height: 0 });
  scrollbarMetricsRef.current = scrollbarThumb;
  const itemHeightCacheRef = useRef<Map<string, number>>(new Map());
  const itemNodeRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const [loadMoreFocusRequest, setLoadMoreFocusRequest] = useState<{
    listStateKey: string;
    previousMessageIds: ReadonlySet<number>;
  } | null>(null);
  const messageRowHeight = isMobileViewport ? MOBILE_MESSAGE_ROW_HEIGHT : MESSAGE_ROW_HEIGHT;

  useEffect(() => {
    setIsMobileViewport(mobile || window.innerWidth <= 720);
  }, [mobile]);

  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport || pullRefreshing) return;
    if (listRef.current && listRef.current.scrollTop <= 0) {
      touchStartYRef.current = e.touches[0].clientY;
    } else {
      touchStartYRef.current = null;
    }
  }, [isMobileViewport, pullRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current === null || !isMobileViewport || pullRefreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartYRef.current;
    if (diff > 0 && listRef.current && listRef.current.scrollTop <= 0) {
      const distance = Math.min(80, Math.pow(diff, 0.85));
      setPullDistance(distance);
    } else {
      setPullDistance(0);
    }
  }, [isMobileViewport, pullRefreshing]);

  const handleTouchEnd = useCallback(() => {
    if (touchStartYRef.current === null || !isMobileViewport) return;
    touchStartYRef.current = null;
    if (pullDistance >= 50 && !pullRefreshing) {
      setPullRefreshing(true);
      setPullDistance(44);
      onRefresh();
      window.setTimeout(() => {
        setPullRefreshing(false);
        setPullDistance(0);
      }, 1000);
    } else {
      setPullDistance(0);
    }
  }, [isMobileViewport, onRefresh, pullDistance, pullRefreshing]);

  const updateScrollbarThumb = useCallback((scrollTopOverride?: number) => {
    const listElement = listRef.current;
    if (!listElement) return;
    const viewportLength = listElement.clientHeight;
    const contentLength = listElement.scrollHeight;
    const scrollRange = contentLength - viewportLength;
    if (viewportLength <= 0 || scrollRange <= 0) {
      setScrollbarThumb({ top: 0, height: 0 });
      return;
    }

    const thumbHeight = Math.min(
      viewportLength - SCROLLBAR_INSET_PX * 2,
      Math.max(
        SCROLLBAR_MIN_LENGTH_PX,
        Math.round((viewportLength * viewportLength) / contentLength),
      ),
    );
    const thumbTravel = Math.max(
      0,
      viewportLength - thumbHeight - SCROLLBAR_INSET_PX * 2,
    );
    const scrollRatio = Math.min(
      1,
      Math.max(0, (scrollTopOverride ?? listElement.scrollTop) / scrollRange),
    );
    setScrollbarThumb({
      top: SCROLLBAR_INSET_PX + Math.round(thumbTravel * scrollRatio),
      height: Math.round(thumbHeight),
    });
  }, []);

  const revealScrollbar = useCallback((scrollTop: number) => {
    updateScrollbarThumb(scrollTop);
    setIsScrollbarVisible(true);
    if (scrollbarHideTimerRef.current !== null) {
      window.clearTimeout(scrollbarHideTimerRef.current);
    }
    scrollbarHideTimerRef.current = window.setTimeout(() => {
      scrollbarHideTimerRef.current = null;
      setIsScrollbarVisible(false);
    }, SCROLLBAR_HIDE_DELAY_MS);
  }, [updateScrollbarThumb]);

  useEffect(() => {
    const thumb = scrollbarThumbRef.current;
    if (!thumb) return undefined;
    return installScrollbarThumbDrag({
      thumb,
      axis: 'vertical',
      getTarget: () => listRef.current,
      getMetrics: () => {
        const listElement = listRef.current;
        const height = scrollbarMetricsRef.current.height
          || Number.parseFloat(thumb.style.height)
          || 0;
        return {
          viewportLength: listElement?.clientHeight ?? 0,
          contentLength: listElement?.scrollHeight ?? 0,
          scrollOffset: listElement?.scrollTop ?? 0,
          thumbLength: height,
          thumbTravel: Math.max(0, (listElement?.clientHeight ?? 0) - height - SCROLLBAR_INSET_PX * 2),
        };
      },
      onDragStart: () => {
        if (scrollbarHideTimerRef.current !== null) {
          window.clearTimeout(scrollbarHideTimerRef.current);
          scrollbarHideTimerRef.current = null;
        }
        setIsScrollbarVisible(true);
      },
      onDrag: (scrollTop) => {
        latestScrollTopRef.current = scrollTop;
        updateScrollbarThumb(scrollTop);
      },
      onDragEnd: () => revealScrollbar(latestScrollTopRef.current),
    });
  }, [revealScrollbar, updateScrollbarThumb]);

  useEffect(() => {
    const handleViewportResize = () => {
      setIsMobileViewport(window.innerWidth <= 720);
    };
    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

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

  useEffect(() => {
    itemHeightCacheRef.current.clear();
    itemNodeRefs.current.clear();
    setHeightCacheVersion((current) => current + 1);
  }, [groups, listStateKey, messageRowHeight]);

  useEffect(() => () => {
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
    }
    if (scrollbarHideTimerRef.current !== null) {
      window.clearTimeout(scrollbarHideTimerRef.current);
    }
    onScrollTopChange(latestScrollTopRef.current);
  }, [listStateKey, onScrollTopChange]);

  const flatItems = useMemo(() => {
    const list: FlatListItem[] = [];
    for (const group of groups) {
      list.push({
        type: 'header',
        id: group.id,
        key: `header-${group.id}`,
        label: group.label,
        count: group.messages.length,
        messageIds: group.messages.map((message) => message.id),
      });
      for (const msg of group.messages) {
        list.push({ type: 'message', key: `message-${group.id}-${msg.id}`, message: msg });
      }
    }
    return list;
  }, [groups]);

  const selectedMessageSet = useMemo(
    () => new Set(selectedMessageIds),
    [selectedMessageIds],
  );
  const visibleMessageIds = useMemo(
    () => messages.map((message) => message.id),
    [messages],
  );
  const selectedVisibleMessageCount = useMemo(
    () => visibleMessageIds.filter((id) => selectedMessageSet.has(id)).length,
    [selectedMessageSet, visibleMessageIds],
  );
  const allMessagesSelected = isAllMessagesSelected || (
    !hasMoreMessages
    && visibleMessageIds.length > 0
    && selectedMessageIds.length === visibleMessageIds.length
    && selectedVisibleMessageCount === visibleMessageIds.length
  );
  const visibleSelectionIndeterminate = selectedMessageIds.length > 0 && !allMessagesSelected;
  const visibleCheckboxRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (visibleCheckboxRef.current) {
      visibleCheckboxRef.current.indeterminate = visibleSelectionIndeterminate;
    }
  }, [visibleSelectionIndeterminate]);

  const toggleVisibleMessages = useCallback((checked: boolean) => {
    // The list-level control means all messages in the current result, not
    // merely the rows currently rendered by the virtual list. Reuse the
    // existing controller so paginated results are expanded before selection.
    onToggleAllVisible(checked);
  }, [onToggleAllVisible]);

  const toggleMessageGroup = useCallback((messageIds: number[], checked: boolean) => {
    if (onToggleMessageGroup) {
      // The group id is attached by the virtual header item at call time.
      return;
    }
    messageIds.forEach((messageId) => onToggleMessageSelection(messageId, checked));
  }, [onToggleMessageGroup, onToggleMessageSelection]);

  const headerCheckboxState = useMemo(() => new Map(
    groups.map((group) => {
      const ids = group.messages.map((message) => message.id);
      const selectedCount = ids.filter((id) => selectedMessageSet.has(id)).length;
      return [group.id, {
        checked: ids.length > 0 && selectedCount === ids.length,
        indeterminate: selectedCount > 0 && selectedCount < ids.length,
      }];
    }),
  ), [groups, selectedMessageSet]);
  const headerCheckboxRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    for (const group of groups) {
      const state = headerCheckboxState.get(group.id);
      const input = headerCheckboxRefs.current.get(group.id);
      if (input) input.indeterminate = Boolean(state?.indeterminate);
    }
  }, [groups, headerCheckboxState]);

  const handleDateRangeConfirm = useCallback((range: LocalDateTimeRange) => {
    if (onSelectMessageDateRange) {
      onSelectMessageDateRange(range);
      return;
    }
    const matchingIds = new Set(
      messages
        .filter((message) => messageMatchesLocalDateTimeRange(message.received_at, range))
        .map((message) => message.id),
    );
    messages.forEach((message) => onToggleMessageSelection(message.id, matchingIds.has(message.id)));
  }, [messages, onSelectMessageDateRange, onToggleMessageSelection]);

  const { layout, totalHeight } = useMemo(() => {
    const getItemHeight = (item: FlatListItem) => {
      const cachedHeight = itemHeightCacheRef.current.get(item.key);
      return cachedHeight && cachedHeight > 0
        ? cachedHeight
        : item.type === 'message' ? messageRowHeight : GROUP_HEADER_HEIGHT;
    };
    const layout: { top: number; height: number }[] = [];
    let currentTop = 0;
    for (const item of flatItems) {
      const height = getItemHeight(item);
      layout.push({ top: currentTop, height });
      currentTop += height;
    }
    return { layout, totalHeight: currentTop };
  }, [flatItems, heightCacheVersion, messageRowHeight]);

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
    updateScrollbarThumb();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setViewportHeight(entry.target.clientHeight);
          updateScrollbarThumb();
        }
      });
      observer.observe(listElement);
      return () => observer.disconnect();
    }
  }, [updateScrollbarThumb]);

  function handleListScroll(event: React.UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop;
    latestScrollTopRef.current = nextScrollTop;
    revealScrollbar(nextScrollTop);

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

  useLayoutEffect(() => {
    updateScrollbarThumb();
  }, [layout, updateScrollbarThumb]);

  const messagePositionById = useMemo(
    () => new Map(messages.map((message, index) => [message.id, index + 1])),
    [messages],
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

  const loadMoreFocusTarget = useMemo(() => {
    if (!loadMoreFocusRequest || loadMoreFocusRequest.listStateKey !== listStateKey) {
      return null;
    }
    return messages.find(
      (message) => !loadMoreFocusRequest.previousMessageIds.has(message.id),
    ) ?? null;
  }, [listStateKey, loadMoreFocusRequest, messages]);

  const handleLoadMoreFocusClaimed = React.useCallback(() => {
    setLoadMoreFocusRequest(null);
  }, []);

  useLayoutEffect(() => {
    let hasUpdate = false;
    for (const { item } of visibleItems) {
      const node = itemNodeRefs.current.get(item.key);
      if (!node) continue;
      const measuredHeight = Math.round(node.getBoundingClientRect().height);
      if (measuredHeight <= 0) continue;
      const currentHeight = itemHeightCacheRef.current.get(item.key) ?? 0;
      if (currentHeight !== measuredHeight) {
        itemHeightCacheRef.current.set(item.key, measuredHeight);
        hasUpdate = true;
      }
    }
    if (hasUpdate) {
      setHeightCacheVersion((current) => current + 1);
    }
  }, [visibleItems]);

  useLayoutEffect(() => {
    const request = loadMoreFocusRequest;
    if (!request) return;
    if (request.listStateKey !== listStateKey) {
      setLoadMoreFocusRequest(null);
      return;
    }

    if (!loadMoreFocusTarget) {
      // Keep the request alive across partial/concurrent renders. The target
      // is resolved by message identity when the transitioned rows commit.
      return;
    }

    const targetItemIndex = flatItems.findIndex(
      (item) => item.type === 'message' && item.message.id === loadMoreFocusTarget.id,
    );
    const targetIsMounted = visibleItems.some(
      ({ item }) => item.type === 'message' && item.message.id === loadMoreFocusTarget.id,
    );
    if (targetItemIndex < 0 || targetIsMounted) return;

    const listElement = listRef.current;
    if (!listElement) return;
    const nextScrollTop = Math.max(0, layout[targetItemIndex]?.top ?? 0);
    listElement.scrollTop = nextScrollTop;
    latestScrollTopRef.current = nextScrollTop;
    setScrollTop(nextScrollTop);
    setVisibleRange(calculateVisibleRange(layout, nextScrollTop, viewportHeight));
  }, [
    flatItems,
    layout,
    listStateKey,
    loadMoreFocusRequest,
    loadMoreFocusTarget,
    viewportHeight,
    visibleItems,
  ]);

  return (
    <div className="message-list-shell">
      <div
        className="message-list"
        ref={listRef}
        role="list"
        aria-label="邮件列表"
        aria-busy={Boolean(loadMoreStatus)}
        tabIndex={-1}
        data-local-scrollbar="true"
        onScroll={handleListScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {isMobileViewport && (pullDistance > 0 || pullRefreshing) && (
          <div
            className="mobile-pull-indicator"
            style={{ height: `${pullDistance}px`, opacity: Math.min(1, pullDistance / 35) }}
            aria-hidden="true"
          >
            <RefreshCw
              size={17}
              className={pullRefreshing ? 'animate-spin' : ''}
              style={{
                transform: pullRefreshing ? undefined : `rotate(${pullDistance * 4.5}deg)`,
              }}
            />
            <span>{pullRefreshing ? '正在同步…' : pullDistance >= 50 ? '释放立即刷新' : '下拉刷新'}</span>
          </div>
        )}
      {messages.length > 0 && (
        <>
        {(!isMobileViewport || selectedMessageIds.length > 0) && (
          <div className="message-selection-strip" aria-label="邮件批量选择操作">
            <label className="message-selection-all">
              <input
                ref={visibleCheckboxRef}
                type="checkbox"
                aria-label="选择当前筛选结果中的全部邮件"
                aria-checked={visibleSelectionIndeterminate ? 'mixed' : allMessagesSelected}
                checked={allMessagesSelected}
                disabled={Boolean(loadMoreStatus) || isSelectingAll || isSelectingMessageGroup}
                onChange={(event) => toggleVisibleMessages(event.target.checked)}
              />
              <span className="message-selection-all-label">全部</span>
            </label>
            <MessageDateRangePicker
              onConfirm={handleDateRangeConfirm}
              disabled={Boolean(loadMoreStatus) || isSelectingAll || isSelectingMessageGroup}
            />
            <span
              className="message-selection-strip-summary"
              aria-live="polite"
              aria-busy={isSelectingAll || isSelectingMessageGroup}
            >
              {isSelectingAll
                ? '正在选择全部邮件…'
                : isSelectingMessageGroup
                  ? '正在读取完整结果…'
                : selectedMessageIds.length > 0
                  ? `已选 ${selectedMessageIds.length} 封`
                  : '选择邮件'}
            </span>
          </div>
        )}
        <div
          className="message-list-viewport-wrapper"
          style={{
            position: 'relative',
            height: totalHeight + LIST_FOOTER_HEIGHT,
            width: '100%',
          }}
        >
          {visibleItems.map(({ index, item, style }) => {
            const itemKey = item.key;
            if (item.type === 'header') {
              const checkboxState = headerCheckboxState.get(item.id) ?? { checked: false, indeterminate: false };
              return (
                <div
                  role="group"
                  aria-label={`${item.label}，${item.count} 封`}
                  className={[
                    'message-date-header',
                    index > 0 ? 'message-date-header--separated' : '',
                  ].filter(Boolean).join(' ')}
                  style={style}
                  key={itemKey}
                  ref={(element) => {
                    if (element) {
                      itemNodeRefs.current.set(itemKey, element);
                    } else {
                      itemNodeRefs.current.delete(itemKey);
                    }
                  }}
                >
                  <label className="message-date-header-selection">
                    <input
                      ref={(element) => {
                        if (element) headerCheckboxRefs.current.set(item.id, element);
                        else headerCheckboxRefs.current.delete(item.id);
                      }}
                      type="checkbox"
                      aria-label={`选择${item.label}邮件`}
                      aria-checked={checkboxState.indeterminate ? 'mixed' : checkboxState.checked}
                      checked={checkboxState.checked}
                      disabled={Boolean(loadMoreStatus) || isSelectingAll || isSelectingMessageGroup}
                      onChange={(event) => {
                        if (onToggleMessageGroup) {
                          void onToggleMessageGroup(item.id, item.messageIds, event.target.checked);
                        } else {
                          toggleMessageGroup(item.messageIds, event.target.checked);
                        }
                      }}
                    />
                    <span>{item.label}</span>
                  </label>
                  <em>{item.count} 封</em>
                </div>
              );
            } else {
              const message = item.message;
              return (
                <div
                  className="message-list-item"
                  role="listitem"
                  aria-current={message.id === selectedId ? 'true' : undefined}
                  aria-posinset={messagePositionById.get(message.id)}
                  aria-setsize={messages.length}
                  style={style}
                  key={itemKey}
                  ref={(element) => {
                    if (element) {
                      itemNodeRefs.current.set(itemKey, element);
                    } else {
                      itemNodeRefs.current.delete(itemKey);
                    }
                  }}
                >
                  <MessageListCard
                    mobile={mobile}
                    showAccountSource={showAccountSource}
                    message={message}
                    isCurrentMessage={message.id === selectedId}
                    isSelected={selectedMessageSet.has(message.id)}
                    isDragging={draggingMessageSet.has(message.id)}
                    isNew={newIds.has(message.id)}
                    claimFocus={loadMoreFocusTarget?.id === message.id}
                    isSelectionMode={selectedMessageIds.length > 0}
                    hasBulkSelection={selectedMessageIds.length > 1}
                    selectedMessageIdsRef={selectedMessageIdsRef}
                    onSelectMessage={onSelectMessage}
                    onToggleMessageSelection={onToggleMessageSelection}
                    onToggleAllVisible={onToggleAllVisible}
                    onOpenMessageMenu={onOpenMessageMenu}
                    onCloseMessageMenu={onCloseMessageMenu}
                    onSetDraggingMessageIds={onSetDraggingMessageIds}
                    onFocusClaimed={handleLoadMoreFocusClaimed}
                  />
                </div>
              );
            }
          })}
          <div
            ref={footerRef}
            className="message-list-footer"
            tabIndex={-1}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: LIST_FOOTER_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
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
                        if (loadMoreStatus) return;
                        const request = {
                          listStateKey,
                          previousMessageIds: new Set(messages.map((message) => message.id)),
                        };
                        setLoadMoreFocusRequest(request);
                        const settleWithoutNewRows = () => {
                          footerRef.current?.focus({ preventScroll: true });
                          setLoadMoreFocusRequest((current) => (
                            current === request ? null : current
                          ));
                        };
                        void onLoadMore().then(
                          (loadedMessages) => {
                            const hasNewRows = loadedMessages.some(
                              (message) => !request.previousMessageIds.has(message.id),
                            );
                            if (!hasNewRows) settleWithoutNewRows();
                          },
                          settleWithoutNewRows,
                        );
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
        </>
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
      <div
        className={`message-list-scrollbar-thumb${isScrollbarVisible && scrollbarThumb.height > 0 ? ' is-visible' : ''}`}
        ref={scrollbarThumbRef}
        aria-hidden="true"
        role="presentation"
        style={{
          width: `${SCROLLBAR_SIZE_PX}px`,
          height: `${scrollbarThumb.height}px`,
          transform: `translateY(${scrollbarThumb.top}px)`,
        }}
      />
    </div>
  );
}

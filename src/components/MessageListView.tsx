import { anchoredScrollTop } from './messageListAnchor';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import type {
  FilterMode,
  MessageSummary,
} from '../app/types';
import type { LocalDateTimeRange } from '../mailUtils';
import MessageListCard from './MessageListCard';
import usePullToRefresh from '../hooks/usePullToRefresh';
import useVirtualRowMeasurements from '../hooks/useVirtualRowMeasurements';
import MessageSelectionControls from './MessageSelectionControls';
import { installScrollbarThumbDrag } from '../hooks/scrollbarThumbDrag';
import {
  GROUP_HEADER_HEIGHT,
  LIST_FOOTER_HEIGHT,
  MOBILE_MESSAGE_ROW_HEIGHT,
  MOBILE_GROUP_HEADER_HEIGHT,
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
  selectionMode?: boolean;
  selectionControlsInToolbar?: boolean;
  showAccountSource?: boolean;
  accountSourceLabels?: ReadonlyMap<number, string>;
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
  onExpandSearch?: () => void;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<MessageSummary[]>;
  loadMoreStatus?: string | null;
};

export default function MessageListView({
  mobile = false,
  selectionMode = false,
  selectionControlsInToolbar = false,
  showAccountSource = false,
  accountSourceLabels,
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
  onExpandSearch,
  onRefresh,
  onLoadMore,
  loadMoreStatus,
}: MessageListViewProps) {
  const showAccountSourceLabel = useMemo(() => {
    if (!showAccountSource || hasMoreMessages || messages.length === 0) return showAccountSource;
    const first = messages[0];
    const email = first.account_email.trim().toLocaleLowerCase();
    // Only a complete result can establish a single source. A partial page or
    // missing identity must not imply that the remaining results share it.
    return !(Number.isInteger(first.account_id) && first.account_id > 0 && email
      && messages.every((message) => message.account_id === first.account_id
        && message.account_email.trim().toLocaleLowerCase() === email));
  }, [showAccountSource, hasMoreMessages, messages]);
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
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 720,
  );
  const isMobileViewport = mobile || isNarrowViewport;
  const [heightCacheVersion, setHeightCacheVersion] = useState(0);
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const [visibilityVersion, setVisibilityVersion] = useState(0);
  const [isScrollbarVisible, setIsScrollbarVisible] = useState(false);
  const [isScrollbarDragging, setIsScrollbarDragging] = useState(false);
  const itemHeightCacheRef = useRef<Map<string, number>>(new Map());
  const itemNodeRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const [loadMoreFocusRequest, setLoadMoreFocusRequest] = useState<{
    listStateKey: string;
    previousMessageIds: ReadonlySet<number>;
  } | null>(null);
  const messageRowHeight = isMobileViewport ? MOBILE_MESSAGE_ROW_HEIGHT : MESSAGE_ROW_HEIGHT;
  const groupHeaderHeight = isMobileViewport ? MOBILE_GROUP_HEADER_HEIGHT : GROUP_HEADER_HEIGHT;
  const heightCacheContextRef = useRef({ listStateKey, messageRowHeight });

  const { pullDistance, pullRefreshing, refreshError, runRefresh, handleTouchStart,
    handleTouchMove, handleTouchEnd, handleTouchCancel } =
    usePullToRefresh(listRef, isMobileViewport, listStateKey, onRefresh);

  const updateScrollbarThumb = useCallback((scrollTopOverride?: number) => {
    const listElement = listRef.current;
    if (!listElement) return;
    const viewportLength = listElement.clientHeight;
    if (viewportLength <= 0) return;
    const contentLength = listElement.scrollHeight;
    const scrollRange = contentLength - viewportLength;
    if (scrollRange <= 0) {
      scrollbarMetricsRef.current = { top: 0, height: 0 };
      if (scrollbarThumbRef.current) scrollbarThumbRef.current.style.height = '0px';
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
    const nextThumb = {
      top: SCROLLBAR_INSET_PX + Math.round(thumbTravel * scrollRatio),
      height: Math.round(thumbHeight),
    };
    scrollbarMetricsRef.current = nextThumb;
    const thumb = scrollbarThumbRef.current;
    if (thumb) {
      thumb.style.height = `${nextThumb.height}px`;
      thumb.style.transform = `translateY(${nextThumb.top}px)`;
    }
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
        setIsScrollbarDragging(true);
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
      onDragEnd: () => {
        setIsScrollbarDragging(false);
        revealScrollbar(latestScrollTopRef.current);
      },
    });
  }, [revealScrollbar, updateScrollbarThumb]);

  useEffect(() => {
    const handleViewportResize = () => {
      setIsNarrowViewport(window.innerWidth <= 720);
    };
    handleViewportResize();
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

  useLayoutEffect(() => {
    const previous = heightCacheContextRef.current;
    heightCacheContextRef.current = { listStateKey, messageRowHeight };
    if (previous.listStateKey === listStateKey && previous.messageRowHeight === messageRowHeight) return;
    if (itemHeightCacheRef.current.size === 0) return;
    itemHeightCacheRef.current.clear();
    setHeightCacheVersion((current) => current + 1);
  }, [listStateKey, messageRowHeight]);

  useEffect(() => () => {
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
    }
    if (scrollbarHideTimerRef.current !== null) {
      window.clearTimeout(scrollbarHideTimerRef.current);
    }
    onScrollTopChange(latestScrollTopRef.current);
  }, [listStateKey, onScrollTopChange]);

  const { flatItems, itemIndexByKey } = useMemo(() => {
    const list: FlatListItem[] = [];
    const indexes = new Map<string, number>();
    for (const group of groups) {
      if (groups.length > 1) {
      indexes.set(`header-${group.id}`, list.length);
      list.push({
        type: 'header',
        id: group.id,
        key: `header-${group.id}`,
        label: group.label,
        count: group.messages.length,
        messageIds: group.messages.map((message) => message.id),
      });
      }
      for (const msg of group.messages) {
        const key = `message-${group.id}-${msg.id}`;
        indexes.set(key, list.length);
        list.push({ type: 'message', key, message: msg });
      }
    }
    return { flatItems: list, itemIndexByKey: indexes };
  }, [groups]);

  useEffect(() => {
    for (const key of itemHeightCacheRef.current.keys()) {
      if (!itemIndexByKey.has(key)) itemHeightCacheRef.current.delete(key);
    }
  }, [itemIndexByKey]);

  const selectedMessageSet = useMemo(
    () => new Set(selectedMessageIds),
    [selectedMessageIds],
  );
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

  const { layout, totalHeight } = useMemo(() => {
    const getItemHeight = (item: FlatListItem) => {
      const cachedHeight = itemHeightCacheRef.current.get(item.key);
      return cachedHeight && cachedHeight > 0
        ? cachedHeight
        : item.type === 'message' ? messageRowHeight : groupHeaderHeight;
    };
    const layout: { top: number; height: number }[] = [];
    let currentTop = 0;
    for (const item of flatItems) {
      const height = getItemHeight(item);
      layout.push({ top: currentTop, height });
      currentTop += height;
    }
    return { layout, totalHeight: currentTop };
  }, [flatItems, heightCacheVersion, messageRowHeight, groupHeaderHeight]);

  const [visibleRange, setVisibleRange] = useState(() =>
    calculateVisibleRange(layout, latestScrollTopRef.current, viewportHeight)
  );

  const visibleRangeRef = useRef(visibleRange);
  visibleRangeRef.current = visibleRange;

  const previousLayout = useRef({ rows: flatItems, layout });
  const measuredWidthRef = useRef(0);
  const wasHiddenRef = useRef(false);
  const restoringFromHiddenRef = useRef(false);
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
    if (wasHiddenRef.current || listElement.closest('[hidden]')) return;
    const isNewView = restoredViewKeyRef.current !== listStateKey;
    const previous = previousLayout.current;
    const requestedScrollTop = isNewView ? initialScrollTop : anchoredScrollTop(
      previous.rows, previous.layout, flatItems, layout,
      restoringFromHiddenRef.current ? latestScrollTopRef.current : listElement.scrollTop,
      itemIndexByKey,
    );
    restoringFromHiddenRef.current = false;
    previousLayout.current = { rows: flatItems, layout };
    listElement.scrollTop = requestedScrollTop;
    latestScrollTopRef.current = requestedScrollTop;
    const nextRange = calculateVisibleRange(layout, requestedScrollTop, viewportHeight);
    setVisibleRange((current) => nextRange.startIdx === current.startIdx && nextRange.endIdx === current.endIdx ? current : nextRange);
    restoredViewKeyRef.current = listStateKey;
    if (isNewView) {
      listStateKeyRef.current = listStateKey;
      baselineMessageIdsRef.current = new Set(messages.map((m) => m.id));
    } else if (newMessageExceededRef.current) {
      baselineMessageIdsRef.current = new Set(messages.map((m) => m.id));
    }
  }, [listStateKey, initialScrollTop, flatItems, itemIndexByKey, layout, viewportHeight, visibilityVersion]);

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
    if (listElement.clientHeight > 0) setViewportHeight(listElement.clientHeight);
    if (listElement.clientWidth > 0) measuredWidthRef.current = listElement.clientWidth;
    updateScrollbarThumb();

    if (typeof ResizeObserver !== 'undefined') {
      const updateGeometry = () => {
        if (document.body.classList.contains('pane-resizing')) return;
        for (const entry of [{ target: listElement }]) {
          const height = entry.target.clientHeight;
          const width = entry.target.clientWidth;
          // Mobile keeps the inbox mounted behind its reader. display:none
          // reports zero geometry; it is not a real density/width change.
          if (height <= 0 || width <= 0) {
            wasHiddenRef.current = true;
            continue;
          }
          setViewportHeight(height);
          const widthChanged = width !== measuredWidthRef.current;
          if (widthChanged || wasHiddenRef.current) {
            restoringFromHiddenRef.current = wasHiddenRef.current;
            if (wasHiddenRef.current) setVisibilityVersion((current) => current + 1);
            wasHiddenRef.current = false;
            measuredWidthRef.current = width;
            if (widthChanged && itemHeightCacheRef.current.size > 0) {
              itemHeightCacheRef.current.clear();
              setHeightCacheVersion((current) => current + 1);
            }
            setMeasurementVersion((current) => current + 1);
          }
          updateScrollbarThumb();
        }
      };
      const observer = new ResizeObserver(updateGeometry);
      observer.observe(listElement);
      document.addEventListener('better-email:pane-resize-end', updateGeometry);
      return () => {
        observer.disconnect();
        document.removeEventListener('better-email:pane-resize-end', updateGeometry);
      };
    }
  }, [updateScrollbarThumb]);

  function handleListScroll(event: React.UIEvent<HTMLDivElement>) {
    if (wasHiddenRef.current || event.currentTarget.closest('[hidden]')) return;
    const nextScrollTop = event.currentTarget.scrollTop;
    latestScrollTopRef.current = nextScrollTop;

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      revealScrollbar(nextScrollTop);
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

  const visibleRows = useMemo(() => visibleItems.map(({ item }) => item), [visibleItems]);
  const handleRowHeightsChanged = useCallback(() => setHeightCacheVersion((current) => current + 1), []);
  useVirtualRowMeasurements({
    rows: visibleRows,
    nodes: itemNodeRefs,
    heightCache: itemHeightCacheRef,
    messageHeight: messageRowHeight,
    headerHeight: groupHeaderHeight,
    contextKey: listStateKey,
    version: measurementVersion,
    onHeightsChanged: handleRowHeightsChanged,
  });

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

  const showFooter = messages.length > 1 || hasMoreMessages || Boolean(loadMoreStatus);
  return (
    <div className="message-list-shell">
      <div
        className="message-list"
        ref={listRef}
        role="list"
        aria-label="邮件列表"
        aria-busy={Boolean(loadMoreStatus) || pullRefreshing}
        tabIndex={-1}
        data-local-scrollbar="true"
        onScroll={handleListScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
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
      {refreshError && (
        <div className="message-list-refresh-error" role="alert">
          <span>刷新未完成：{refreshError}</span>
          <button type="button" disabled={pullRefreshing} onClick={() => { void runRefresh(); }}>重试刷新</button>
        </div>
      )}
      {messages.length > 0 && (
        <>
        {isMobileViewport && !selectionControlsInToolbar && selectedMessageIds.length > 0 && (
          <MessageSelectionControls
            messages={messages}
            selectedMessageIds={selectedMessageIds}
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
        <div
          className="message-list-viewport-wrapper"
          style={{
            position: 'relative',
            height: totalHeight + (showFooter ? LIST_FOOTER_HEIGHT : 0),
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
                    showAccountSourceLabel={showAccountSourceLabel}
                    accountSourceLabels={accountSourceLabels}
                    message={message}
                    isCurrentMessage={message.id === selectedId}
                    isSelected={selectedMessageSet.has(message.id)}
                    isDragging={draggingMessageSet.has(message.id)}
                    isNew={newIds.has(message.id)}
                    claimFocus={loadMoreFocusTarget?.id === message.id}
                    isSelectionMode={selectionMode || selectedMessageIds.length > 0}
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
          {showFooter && <div
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
          </div>}
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
            {query.trim() && onExpandSearch
              ? '当前搜索范围内没有匹配邮件，可以扩大范围继续查找。'
              : query.trim() || filter !== 'all'
              ? '可以清空搜索/筛选，或切回“全部”查看当前邮箱。'
              : '当前账号或统一邮箱范围里，这个文件夹暂时没有邮件。'}
          </span>
          <div className="empty-state-actions">
            {query.trim() && onExpandSearch && (
              <button type="button" className="mailbox-expand-search" onClick={onExpandSearch}>
                在全部账号中搜索
              </button>
            )}
            {(query.trim() || filter !== 'all') && (
              <button type="button" onClick={onClearSearchAndFilter}>
                清空搜索和筛选
              </button>
            )}
            <button type="button" disabled={pullRefreshing} onClick={() => { void runRefresh(); }}>
              刷新邮箱
            </button>
          </div>
        </div>
      )}
      </div>
      <div
        className={`message-list-scrollbar-thumb${isScrollbarVisible ? ' is-visible' : ''}${isScrollbarDragging ? ' is-dragging' : ''}`}
        ref={scrollbarThumbRef}
        aria-hidden="true"
        role="presentation"
        style={{
          width: `${SCROLLBAR_SIZE_PX}px`,
        }}
      />
    </div>
  );
}

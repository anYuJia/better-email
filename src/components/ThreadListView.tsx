import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VolumeX } from 'lucide-react';
import type { ThreadSummary } from '../app/types';
import { formatDate } from '../mailUtils';
import { calculateVisibleRange } from './messageListLayout';

/**
 * 会话行高 —— 与 `styles/message-list.css` 中 `.thread-card` 的
 * `height: 72px` 保持一致，虚拟计算高度必须等于实际渲染高度，
 * 否则滚动会跳动、选中/悬停会错位。
 */
export const THREAD_ROW_HEIGHT = 72;

type ThreadListViewProps = {
  threads: ThreadSummary[];
  activeThread: ThreadSummary | null;
  onOpenThread: (thread: ThreadSummary) => void;
  onOpenThreadMenu: (thread: ThreadSummary, x: number, y: number) => void;
};

export default function ThreadListView({
  threads,
  activeThread,
  onOpenThread,
  onOpenThreadMenu,
}: ThreadListViewProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [visibleRange, setVisibleRange] = useState(() =>
    calculateVisibleRange([], 0, 600),
  );

  const layout = useMemo(() => {
    const items: { top: number; height: number }[] = [];
    let top = 0;
    for (let i = 0; i < threads.length; i++) {
      items.push({ top, height: THREAD_ROW_HEIGHT });
      top += THREAD_ROW_HEIGHT;
    }
    return items;
  }, [threads.length]);

  const totalHeight = layout.length === 0 ? 0 : THREAD_ROW_HEIGHT * layout.length;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const viewportHeightRef = useRef(viewportHeight);
  viewportHeightRef.current = viewportHeight;
  const visibleRangeRef = useRef(visibleRange);
  visibleRangeRef.current = visibleRange;

  // 布局或视口高度变化时，用当前滚动位置重新计算可见范围，避免渲染缺口。
  useLayoutEffect(() => {
    setVisibleRange((current) => {
      const next = calculateVisibleRange(layoutRef.current, listRef.current?.scrollTop ?? 0, viewportHeightRef.current);
      return next.startIdx === current.startIdx && next.endIdx === current.endIdx ? current : next;
    });
  }, [layout, viewportHeight]);

  useLayoutEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;
    if (listElement.clientHeight > 0) {
      setViewportHeight(listElement.clientHeight);
    }
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const height = entry.target.clientHeight;
          if (height > 0) setViewportHeight(height);
        }
      });
      observer.observe(listElement);
      return () => observer.disconnect();
    }
  }, []);

  useEffect(() => () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
  }, []);

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const next = calculateVisibleRange(layoutRef.current, nextScrollTop, viewportHeightRef.current);
      if (
        next.startIdx !== visibleRangeRef.current.startIdx ||
        next.endIdx !== visibleRangeRef.current.endIdx
      ) {
        setVisibleRange(next);
      }
    });
  }

  const visibleThreads = useMemo(() => {
    const items: { index: number; thread: ThreadSummary }[] = [];
    for (let i = visibleRange.startIdx; i <= visibleRange.endIdx && i < threads.length; i++) {
      items.push({ index: i, thread: threads[i] });
    }
    return items;
  }, [threads, visibleRange]);

  return (
    <div className="thread-list" ref={listRef} role="list" aria-label="会话列表" onScroll={handleScroll}>
      {threads.length > 0 && (
        <div
          className="thread-list-viewport-wrapper"
          style={{
            position: 'relative',
            height: totalHeight,
            width: '100%',
          }}
        >
          {visibleThreads.map(({ index, thread }) => {
            const hasUnread = thread.unread_count > 0;
            return (
              <div
                key={thread.thread_key}
                className="thread-list-item"
                role="listitem"
                aria-current={activeThread?.thread_key === thread.thread_key ? 'true' : undefined}
                aria-posinset={index + 1}
                aria-setsize={threads.length}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: THREAD_ROW_HEIGHT,
                  transform: `translateY(${layout[index].top}px)`,
                }}
              >
                <button
                  className={[
                    'thread-card',
                    activeThread?.thread_key === thread.thread_key ? 'selected' : '',
                    hasUnread ? 'is-unread' : 'is-read',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onOpenThread(thread)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onOpenThreadMenu(thread, event.clientX, event.clientY);
                  }}
                >
                  {hasUnread && <span className="thread-unread-dot" aria-label="未读" />}
                  <div className="thread-topline">
                    <strong className="thread-subject" title={thread.subject || '无主题'}>
                      {thread.subject || '(无主题)'}
                    </strong>
                    <time>{formatDate(thread.latest_at)}</time>
                  </div>
                  <p className="thread-participants" title={thread.participants}>{thread.participants}</p>
                  <div className="thread-meta">
                    <span className="thread-count-badge">
                      {thread.message_count} 封
                    </span>
                    {hasUnread && (
                      <span className="thread-unread-badge">
                        {thread.unread_count} 条未读
                      </span>
                    )}
                    {thread.is_muted && (
                      <em className="thread-muted-indicator">
                        <VolumeX size={12} />
                        静音
                      </em>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {threads.length === 0 && <div className="empty-state">没有会话</div>}
    </div>
  );
}

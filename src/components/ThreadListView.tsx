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

function normalizedThreadText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function threadPreview(thread: ThreadSummary): string {
  const candidate = thread.latest_preview?.trim() ?? '';
  const normalizedCandidate = normalizedThreadText(candidate);
  const isCountOnly = /^\d+\s*封(?:邮件)?$/.test(candidate);
  const repeatsSubject = normalizedCandidate.length > 0
    && normalizedCandidate === normalizedThreadText(thread.subject);
  const repeatsSender = normalizedCandidate.length > 0
    && normalizedCandidate === normalizedThreadText(thread.participants);

  if (candidate && !isCountOnly && !repeatsSubject && !repeatsSender) {
    return candidate;
  }

  // A missing body snippet should still expose useful state without
  // manufacturing a duplicate subject or bringing back count-only metadata.
  if (thread.unread_count > 0) return `${thread.unread_count} 条未读`;
  return '';
}

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
            const sender = thread.participants.trim() || '未知发件人';
            const subject = thread.subject || '(无主题)';
            const preview = threadPreview(thread);
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
                  aria-keyshortcuts="Enter Shift+F10"
                  onClick={() => onOpenThread(thread)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onOpenThreadMenu(thread, event.clientX, event.clientY);
                  }}
                  onKeyDown={(event) => {
                    if (!((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    onOpenThreadMenu(
                      thread,
                      bounds.left + Math.min(bounds.width / 2, 220),
                      bounds.top + bounds.height / 2,
                    );
                  }}
                >
                  {hasUnread && <span className="thread-unread-dot" aria-label="未读" />}
                  <div className="thread-topline">
                    <span className={hasUnread ? 'thread-sender is-unread' : 'thread-sender'} title={sender}>
                      {sender}
                    </span>
                    <time>{formatDate(thread.latest_at)}</time>
                  </div>
                  <div className="thread-subject-line">
                    <strong className={hasUnread ? 'thread-subject is-unread' : 'thread-subject'} title={subject}>
                      {subject}
                    </strong>
                    {thread.message_count > 1 && (
                      <span className="thread-count-badge" aria-label={`${thread.message_count} 封邮件`}>
                        {thread.message_count} 封
                      </span>
                    )}
                    {thread.is_muted && (
                      <span className="thread-muted-indicator" title="已静音" aria-label="已静音">
                        <VolumeX size={12} aria-hidden="true" />
                        静音
                      </span>
                    )}
                  </div>
                  {preview && <p className="thread-preview" title={preview}>{preview}</p>}
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

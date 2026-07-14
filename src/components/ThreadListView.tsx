import {
  VolumeX,
} from 'lucide-react';
import type { ThreadSummary } from '../app/types';
import { formatDate } from '../mailUtils';

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
  return (
    <div className="thread-list">
      {threads.map((thread) => {
        const hasUnread = thread.unread_count > 0;
        return (
          <button
            key={thread.thread_key}
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
        );
      })}
      {threads.length === 0 && <div className="empty-state">没有会话</div>}
    </div>
  );
}

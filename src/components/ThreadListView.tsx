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
      {threads.map((thread) => (
        <button
          key={thread.thread_key}
          className={activeThread?.thread_key === thread.thread_key ? 'thread-card selected' : 'thread-card'}
          onClick={() => onOpenThread(thread)}
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenThreadMenu(thread, event.clientX, event.clientY);
          }}
        >
          <div>
            <strong>{thread.subject || '(无主题)'}</strong>
            <time>{formatDate(thread.latest_at)}</time>
          </div>
          <p>{thread.participants}</p>
          <span>
            {thread.message_count} 封 · 未读 {thread.unread_count}
            {thread.is_muted && (
              <em className="thread-muted-indicator">
                <VolumeX size={12} />
                静音
              </em>
            )}
          </span>
        </button>
      ))}
      {threads.length === 0 && <div className="empty-state">没有会话线程</div>}
    </div>
  );
}

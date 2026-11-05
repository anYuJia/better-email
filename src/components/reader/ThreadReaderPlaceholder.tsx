import type { ThreadSummary } from '../../app/types';
import { EmailBodySkeleton } from '../EmailReaderSkeleton';
import { EmptyMessageBody } from './PlainMessageBody';

export default function ThreadReaderPlaceholder({ thread, state = 'loading', onRetry }: {
  thread: ThreadSummary;
  state?: 'loading' | 'error' | 'empty';
  onRetry?: () => void;
}) {
  return <>
    <header className="reader-header">
      <h1 className="reader-title-block">{thread.subject || '(无主题)'}</h1>
      <p>{thread.participants} · {state === 'empty' ? 0 : thread.message_count} 封邮件</p>
      <div className="reader-actions" aria-hidden="true" />
    </header>
    {state === 'loading' ? <EmailBodySkeleton /> : <EmptyMessageBody
      role={state === 'error' ? 'alert' : undefined}
      title={state === 'error' ? '暂时无法加载此会话' : '此会话暂无可显示的邮件'}
      detail={state === 'error' ? '请重新加载，或返回列表选择其他会话。' : '邮件可能已被移动或删除。可以重新加载会话。'}
      action={onRetry && <button type="button" className="reader-warning-primary-action" onClick={onRetry}>重新加载会话</button>}
    />}
  </>;
}

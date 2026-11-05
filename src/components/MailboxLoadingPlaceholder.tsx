import type { ListMode } from '../app/types';

export default function MailboxLoadingPlaceholder({ listMode }: { listMode: ListMode }) {
  return <div className="mailbox-load-placeholder" data-list-mode={listMode} role="status">
    <span>{listMode === 'threads' ? '正在加载会话…' : '正在加载邮件…'}</span>
    <div aria-hidden="true">{[0, 1, 2, 3].map(row => <div className="mailbox-load-row" key={row}>
      {listMode === 'messages' && <i className="mailbox-load-avatar" />}
      <div className="mailbox-load-lines"><span><i /></span><span><i /></span><span><i /></span></div>
    </div>)}</div>
  </div>;
}

import { useEffect, useState } from 'react';
import type { OutboxItem } from '../../app/types';
import { canCancelOutboxItem, outboxStatusLabel, outboxTimingLabel } from '../../app/uiConfig';
import ConfirmDialog from '../ConfirmDialog';

type Props = {
  item: OutboxItem;
  onResolve?: (outboxId: number, delivered: boolean) => Promise<void>;
  onCancel?: (item: OutboxItem) => Promise<void>;
  onRepairCredentials?: () => void;
};

export default function ReaderDeliveryStatus({ item, onResolve, onCancel, onRepairCredentials }: Props) {
  const [confirmation, setConfirmation] = useState<boolean | null>(null);
  const [now, setNow] = useState(Date.now);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    if (item.status !== 'scheduled') return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [item.status, item.next_attempt_at]);
  if (item.status === 'sent' || item.status === 'cancelled') return null;
  const uncertain = item.status === 'send_unknown';
  const authenticationFailure = /(?:SMTP 认证|authentication|auth).*(?:535|login fail)|(?:535).*(?:login fail|auth)/i.test(item.last_error);
  const secondsLeft = Math.ceil((Date.parse(item.next_attempt_at) - now) / 1000);
  const countdown = item.status === 'scheduled' && secondsLeft > 0 && secondsLeft <= 30;
  return (
    <section className="reader-delivery-status" aria-label="邮件发送状态">
      <div role={uncertain || item.status === 'failed' ? 'alert' : 'status'}>
        <strong>{outboxStatusLabel(item.status)}</strong>
        <p>{countdown ? `${secondsLeft} 秒后发送，可在发送前撤回` : outboxTimingLabel(item)}</p>
        {authenticationFailure ? (
          <>
            <p>发送服务器拒绝了账号认证，邮件尚未提交。请检查邮箱的 SMTP 服务和授权码，或稍后再试。</p>
            <details><summary>查看服务器详情</summary><p>{item.last_error}</p></details>
          </>
        ) : item.last_error && <p>{item.last_error}</p>}
      </div>
      {(authenticationFailure && onRepairCredentials || canCancelOutboxItem(item.status) && onCancel) && (
        <div className="reader-delivery-actions">
          {authenticationFailure && onRepairCredentials && <button type="button" onClick={onRepairCredentials}>检查账号设置</button>}
          {canCancelOutboxItem(item.status) && onCancel && <button type="button" disabled={cancelling} onClick={async () => {
            setCancelling(true);
            setActionError('');
            try { await onCancel(item); }
            catch (error) { setActionError(`无法退回草稿：${error instanceof Error ? error.message : String(error)}`); }
            finally { setCancelling(false); }
          }}>{cancelling ? '正在退回…' : '退回草稿'}</button>}
        </div>
      )}
      {actionError && <p role="alert">{actionError}</p>}
      {uncertain && onResolve && (
        <div className="reader-delivery-actions">
          <button type="button" onClick={() => setConfirmation(true)}>我已核对，邮件已发出</button>
          <button type="button" onClick={() => setConfirmation(false)}>我已核对，退回草稿</button>
        </div>
      )}
      <ConfirmDialog
        open={confirmation !== null}
        danger={false}
        title={confirmation ? '确认邮件已经发出' : '确认退回草稿'}
        description={confirmation
          ? '请先在邮件服务商的已发送文件夹或与收件人核对。确认后只补存已发送副本，不会再次发送。'
          : '没有在已发送中找到邮件并不能证明发送失败。请核对收件人或服务商记录；退回草稿后不会自动重发。'}
        summaryText={`${item.subject || '(无主题)'} · ${item.recipients}`}
        confirmText={confirmation ? '已核对，仅补存副本' : '已核对，退回草稿'}
        onCancel={() => setConfirmation(null)}
        onConfirm={async () => {
          if (confirmation === null || !onResolve) return;
          await onResolve(item.id, confirmation);
          setConfirmation(null);
        }}
      />
    </section>
  );
}

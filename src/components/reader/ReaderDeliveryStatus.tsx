import { useState } from 'react';
import type { OutboxItem } from '../../app/types';
import { outboxStatusLabel, outboxTimingLabel } from '../../app/uiConfig';
import ConfirmDialog from '../ConfirmDialog';

type Props = {
  item: OutboxItem;
  onResolve?: (outboxId: number, delivered: boolean) => Promise<void>;
};

export default function ReaderDeliveryStatus({ item, onResolve }: Props) {
  const [confirmation, setConfirmation] = useState<boolean | null>(null);
  if (item.status === 'sent' || item.status === 'cancelled') return null;
  const uncertain = item.status === 'send_unknown';
  return (
    <section className="reader-delivery-status" aria-label="邮件发送状态">
      <div role={uncertain || item.status === 'failed' ? 'alert' : 'status'}>
        <strong>{outboxStatusLabel(item.status)}</strong>
        <p>{outboxTimingLabel(item)}</p>
        {item.last_error && <p>{item.last_error}</p>}
      </div>
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

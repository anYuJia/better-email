import { useEffect, useState } from 'react';
import { IPC } from '../../ipc/commands';
import { invoke } from '../../tauriBridge';
import { SettingsButton, SettingsRow, SettingsSection } from './shared';

type PendingWrite = {
  message_id: number;
  kind: string;
  value: string;
  created_at: string;
  subject: string;
};

function description(item: PendingWrite) {
  if (item.kind === 'seen') return item.value === '1' ? '标记为已读' : '标记为未读';
  if (item.kind === 'flagged') return item.value === '1' ? '添加星标' : '移除星标';
  if (item.kind === 'move') return '移动邮件';
  return '更新邮件';
}

export default function DetachedPendingSettings({ accountId }: { accountId: number }) {
  const [items, setItems] = useState<PendingWrite[]>([]);
  const [confirming, setConfirming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    invoke<PendingWrite[]>(IPC.ListDetachedPendingWrites, { accountId })
      .then((result) => { if (active) setItems(result); })
      .catch(() => { if (active) setError('无法读取待处理的同步操作。'); });
    return () => { active = false; };
  }, [accountId]);

  async function discard(item: PendingWrite) {
    setBusy(true);
    setError('');
    try {
      const { subject: _subject, ...pending } = item;
      const removed = await invoke<boolean>(IPC.DiscardDetachedPendingWrite, { accountId, pending });
      if (!removed) {
        setError('操作状态已变化，请重新打开此页面查看。');
      } else {
        setItems((current) => current.filter((entry) => entry !== item));
      }
      setConfirming('');
    } catch {
      setError('无法停止同步，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  if (!items.length && !error) return null;
  return (
    <SettingsSection title="需要处理的同步操作" description="服务器上的邮件标识已变化，以下操作无法继续同步。本地邮件和修改会保留。" dataSection="detached-pending-writes">
      {error && <p role="status">{error}</p>}
      {items.map((item) => {
        const key = `${item.message_id}:${item.kind}:${item.created_at}`;
        return (
          <SettingsRow
            key={key}
            title={item.subject || '（无主题）'}
            description={confirming === key ? `停止同步“${description(item)}”？本地修改会保留，服务器不会更新。` : description(item)}
            control={confirming === key ? (
              <span className="st-actions">
                <SettingsButton disabled={busy} onClick={() => setConfirming('')}>取消</SettingsButton>
                <SettingsButton variant="danger-secondary" disabled={busy} onClick={() => void discard(item)}>确认停止同步</SettingsButton>
              </span>
            ) : (
              <SettingsButton disabled={busy} onClick={() => setConfirming(key)}>停止同步</SettingsButton>
            )}
          />
        );
      })}
    </SettingsSection>
  );
}

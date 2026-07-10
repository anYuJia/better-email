import { useEffect, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import type { Account } from '../../app/types';
import './account-removal.css';

type AccountRemovalPanelProps = {
  account: Account;
  accountCount: number;
  onRemove: () => Promise<void>;
};

export default function AccountRemovalPanel({
  account,
  accountCount,
  onRemove,
}: AccountRemovalPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const canRemove = accountCount > 1;
  const confirmationMatches = confirmation.trim().toLowerCase() === account.email.toLowerCase();

  useEffect(() => {
    setDialogOpen(false);
    setConfirmation('');
    setPending(false);
    setError('');
  }, [account.id]);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) setDialogOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogOpen, pending]);

  async function handleRemove() {
    if (!canRemove || !confirmationMatches || pending) return;
    setPending(true);
    setError('');
    try {
      await onRemove();
      setDialogOpen(false);
    } catch (removeError) {
      setError(String(removeError));
      setPending(false);
    }
  }

  return (
    <>
      <section className="tool-panel settings-account-danger" aria-labelledby="remove-account-title">
        <span className="settings-account-danger-icon" aria-hidden="true">
          <Trash2 size={17} />
        </span>
        <div>
          <strong id="remove-account-title">移除这个邮箱账号</strong>
          <p>将清除本机中的邮件、目录、身份和同步记录，不会删除服务商服务器上的邮件。</p>
          {!canRemove && <small>当前是唯一账号，请先添加另一个邮箱账号。</small>}
        </div>
        <button
          type="button"
          className="settings-danger-action"
          disabled={!canRemove}
          data-account-remove-trigger
          onClick={() => {
            setConfirmation('');
            setError('');
            setDialogOpen(true);
          }}
        >
          移除账号
        </button>
      </section>

      {dialogOpen && (
        <div
          className="settings-confirm-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setDialogOpen(false);
          }}
        >
          <section
            className="settings-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-account-dialog-title"
            data-account-remove-dialog
          >
            <header>
              <span className="settings-confirm-warning" aria-hidden="true">
                <AlertTriangle size={19} />
              </span>
              <div>
                <strong id="remove-account-dialog-title">确认移除邮箱账号？</strong>
                <p>此操作会永久清除当前设备中的该账号数据。</p>
              </div>
              <button
                type="button"
                className="settings-dialog-close"
                aria-label="关闭"
                disabled={pending}
                onClick={() => setDialogOpen(false)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="settings-confirm-summary">
              <strong>{account.display_name || account.email}</strong>
              <span>{account.email}</span>
            </div>
            <label>
              输入完整邮箱地址以确认
              <input
                autoFocus
                value={confirmation}
                aria-label="输入邮箱地址确认移除"
                placeholder={account.email}
                disabled={pending}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError('');
                }}
              />
            </label>
            {error && <p className="settings-confirm-error">{error}</p>}
            <footer>
              <button
                type="button"
                className="settings-dialog-cancel"
                disabled={pending}
                onClick={() => setDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="settings-dialog-danger"
                disabled={!confirmationMatches || pending}
                data-account-remove-confirm
                onClick={() => { handleRemove().catch(() => undefined); }}
              >
                <Trash2 size={15} />
                {pending ? '正在移除…' : '永久移除'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

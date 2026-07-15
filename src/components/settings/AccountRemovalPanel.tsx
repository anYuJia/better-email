import { useEffect, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import type { Account } from '../../app/types';
import './account-removal.css';

type AccountRemovalPanelProps = {
  account: Account;
  accountCount: number;
  onRemove: (deleteSecret: boolean) => Promise<void>;
  embedded?: boolean;
};

export default function AccountRemovalPanel({
  account,
  accountCount,
  onRemove,
  embedded = false,
}: AccountRemovalPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [deleteSecret, setDeleteSecret] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const canRemove = accountCount > 0;
  const confirmationMatches = confirmation.trim().toLowerCase() === account.email.toLowerCase();

  useEffect(() => {
    setDialogOpen(false);
    setConfirmation('');
    setDeleteSecret(true);
    setPending(false);
    setError('');
  }, [account.id]);

  useEffect(() => {
    if (embedded) return undefined;
    if (!dialogOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) setDialogOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogOpen, embedded, pending]);

  async function handleRemove() {
    if (!canRemove || !confirmationMatches || pending) return;
    setPending(true);
    setError('');
    try {
      await onRemove(deleteSecret);
      setDialogOpen(false);
    } catch (removeError) {
      setError(String(removeError));
      setPending(false);
    }
  }

  const confirmationForm = (
    <>
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
      <label className="checkbox-row" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="checkbox"
          checked={deleteSecret}
          disabled={pending}
          onChange={(event) => setDeleteSecret(event.target.checked)}
        />
        <span>
          <strong>同时删除本机保存的登录凭据</strong>
          <small style={{ display: 'block', color: 'var(--settings-text-secondary)', fontSize: '11px' }}>
            {deleteSecret 
              ? "若勾选，将从本地 SQLite 凭据表中彻底清除此账号的登录密码/授权 Token。" 
              : "警告：若不勾选，该账号的登录凭据仍将以明文/密文形式保留在本地 SQLite 数据库中。"}
          </small>
        </span>
      </label>
      {error && <p className="settings-confirm-error">{error}</p>}
      <footer>
        <button
          type="button"
          className="settings-dialog-cancel"
          disabled={pending}
          onClick={() => {
            setConfirmation('');
            setError('');
          }}
        >
          清空
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
    </>
  );

  if (embedded) {
    return (
      <section className="settings-confirm-dialog settings-confirm-dialog-embedded" data-account-remove-dialog>
        <header>
          <span className="settings-confirm-warning" aria-hidden="true">
            <AlertTriangle size={19} />
          </span>
          <div>
            <strong id="remove-account-dialog-title">确认移除邮箱账号？</strong>
            <p>此操作会永久清除当前设备中的该账号数据。</p>
          </div>
        </header>
        {canRemove ? confirmationForm : <p className="settings-confirm-error">当前没有可移除的账号。</p>}
      </section>
    );
  }

  return (
    <>
      <section className="tool-panel settings-account-danger" aria-labelledby="remove-account-title">
        <div>
          <strong id="remove-account-title">删除账号</strong>
          {!canRemove && <small>当前没有可移除的账号。</small>}
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
            {confirmationForm}
          </section>
        </div>
      )}
    </>
  );
}

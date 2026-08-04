import { Mail, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

type ComposerCloseConfirmDialogProps = {
  onClose: () => void;
  onDiscard: () => void;
  onSaveDraft: () => Promise<void>;
  setOpen: Dispatch<SetStateAction<boolean>>;
};

export default function ComposerCloseConfirmDialog({
  onClose,
  onDiscard,
  onSaveDraft,
  setOpen,
}: ComposerCloseConfirmDialogProps) {
  return (
    <div
      className="settings-cache-confirm-backdrop"
      style={{ zIndex: 10000 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setOpen(false);
        }
      }}
    >
      <section
        className="settings-cache-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-close-confirm-title"
      >
        <header>
          <span className="settings-cache-confirm-mark" aria-hidden="true" style={{ background: '#e0f2fe', color: '#0284c7' }}>
            <Mail size={17} />
          </span>
          <span>
            <strong id="composer-close-confirm-title">关闭写信窗口</strong>
            <small>当前草稿有未保存的修改</small>
          </span>
          <button
            className="icon-only-action"
            type="button"
            title="关闭"
            aria-label="关闭确认"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="settings-cache-confirm-summary" style={{ background: '#f0f9ff', borderLeft: '3px solid #0ea5e9' }}>
          <span style={{ fontSize: '14px', color: '#0369a1', fontWeight: 'bold' }}>
            是否保留对当前邮件草稿的修改？
          </span>
        </div>
        <p>
          您可以选择将草稿保存至本地，以便下次在“草稿箱”中继续编辑，或者舍弃当前修改。
        </p>
        <footer>
          <button
            className="secondary"
            type="button"
            style={{ marginRight: 'auto' }}
            onClick={onClose}
          >
            继续编辑
          </button>
          <button
            className="secondary"
            type="button"
            style={{ borderColor: '#fca5a5', color: '#dc2626' }}
            onClick={onDiscard}
          >
            舍弃草稿
          </button>
          <button
            className="primary"
            type="button"
            style={{ background: 'var(--ui-accent, #0a7aff)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold' }}
            onClick={async () => {
              await onSaveDraft();
              setOpen(false);
            }}
          >
            保存草稿
          </button>
        </footer>
      </section>
    </div>
  );
}

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
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setOpen(false);
        }
      }}
    >
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-close-confirm-title"
      >
        <header>
          <span className="dialog-card-mark dialog-card-mark-info" aria-hidden="true">
            <Mail size={17} />
          </span>
          <span className="dialog-card-heading">
            <strong id="composer-close-confirm-title">关闭写信窗口</strong>
            <small>当前草稿有未保存的修改</small>
          </span>
          <button
            className="dialog-card-close"
            type="button"
            title="关闭"
            aria-label="关闭确认"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="dialog-card-summary">
          是否保留对当前邮件草稿的修改？
        </div>
        <p>
          您可以选择将草稿保存至本地，以便下次在“草稿箱”中继续编辑，或者舍弃当前修改。
        </p>
        <footer>
          <button
            className="dialog-button dialog-button-secondary dialog-button-spacer"
            type="button"
            onClick={onClose}
          >
            继续编辑
          </button>
          <button
            className="dialog-button dialog-button-danger"
            type="button"
            onClick={onDiscard}
          >
            舍弃草稿
          </button>
          <button
            className="dialog-button dialog-button-primary"
            type="button"
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

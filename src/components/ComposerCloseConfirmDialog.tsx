import { Mail, X } from 'lucide-react';
import { useId, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import useModalAccessibility from '../hooks/useModalAccessibility';

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
  const titleId = useId();
  const descriptionId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    if (!pending) onClose();
  }

  async function handleSaveDraft() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onSaveDraft();
      setOpen(false);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message || '未知错误');
      setPending(false);
    }
  }

  useModalAccessibility({
    dialogRef,
    backdropRef,
    initialFocusRef: continueButtonRef,
    onEscape: handleClose,
    escapeDisabled: pending,
  });

  return (
    <div
      ref={backdropRef}
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (!pending && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={pending || undefined}
        tabIndex={-1}
      >
        <header>
          <span className="dialog-card-mark dialog-card-mark-info" aria-hidden="true">
            <Mail size={17} />
          </span>
          <span className="dialog-card-heading">
            <strong id={titleId}>关闭写信窗口</strong>
            <small>当前邮件尚未保存到草稿箱</small>
          </span>
          <button
            className="dialog-card-close"
            type="button"
            title="关闭"
            aria-label="关闭确认"
            disabled={pending}
            onClick={handleClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="dialog-card-summary">
          要保留这封邮件吗？
        </div>
        <p id={descriptionId}>
          恢复点只用于意外关闭后的恢复，不等同于草稿箱中的草稿。保存后可从“草稿箱”继续编辑，也可以舍弃这封邮件。
        </p>
        {error && (
          <div className="confirm-dialog-error" role="alert">
            保存草稿失败：{error}
          </div>
        )}
        <footer>
          <button
            ref={continueButtonRef}
            className="dialog-button dialog-button-secondary dialog-button-spacer"
            type="button"
            disabled={pending}
            onClick={handleClose}
          >
            继续编辑
          </button>
          <button
            className="dialog-button dialog-button-danger"
            type="button"
            disabled={pending}
            onClick={onDiscard}
          >
            舍弃邮件
          </button>
          <button
            className="dialog-button dialog-button-primary"
            type="button"
            disabled={pending}
            onClick={() => { void handleSaveDraft(); }}
          >
            {pending ? '保存中…' : '保存草稿'}
          </button>
        </footer>
      </section>
    </div>
  );
}

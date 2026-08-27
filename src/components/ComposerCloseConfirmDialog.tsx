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
      className="dialog-backdrop composer-close-dialog-backdrop"
      onMouseDown={(event) => {
        if (!pending && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="dialog-card composer-close-dialog"
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
            <strong id={titleId}>保存这封邮件？</strong>
            <small>当前内容还未保存到草稿箱</small>
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
        <p id={descriptionId} className="composer-close-dialog-description">
          保存后可随时从草稿箱继续编辑。恢复点仅用于意外关闭，不能代替草稿。
        </p>
        {error && (
          <div className="confirm-dialog-error" role="alert">
            保存草稿失败：{error}
          </div>
        )}
        <footer className="composer-close-dialog-actions">
          <button
            ref={continueButtonRef}
            className="dialog-button dialog-button-secondary"
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
            舍弃并关闭
          </button>
          <button
            className="dialog-button dialog-button-primary"
            type="button"
            disabled={pending}
            onClick={() => { void handleSaveDraft(); }}
          >
            {pending ? '正在保存…' : '保存并关闭'}
          </button>
        </footer>
      </section>
    </div>
  );
}

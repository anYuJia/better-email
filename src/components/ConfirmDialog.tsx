import { useEffect, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import useModalAccessibility from '../hooks/useModalAccessibility';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  summaryText?: string;
  danger?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  description,
  summaryText,
  danger = true,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleId = useId();
  const descId = useId();

  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // A reused dialog must not expose the previous attempt's transient state.
  useEffect(() => {
    if (!open) return;
    setPending(false);
    setError(null);
  }, [open]);

  useModalAccessibility({
    open,
    dialogRef,
    backdropRef,
    initialFocusRef: cancelRef,
    onEscape: handleCancelClick,
    escapeDisabled: pending,
  });

  if (!open) return null;

  async function handleConfirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false); // Enable retry
    }
  }

  function handleCancelClick() {
    if (pending) return;
    onCancel();
  }

  return createPortal(
    <div
      ref={backdropRef}
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (!pending && event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={pending || undefined}
        tabIndex={-1}
      >
        <header>
          <span
            className={`dialog-card-mark ${danger ? 'dialog-card-mark-danger' : 'dialog-card-mark-info'}`}
            aria-hidden="true"
          >
            {danger ? <Trash2 size={17} /> : <AlertTriangle size={17} />}
          </span>
          <span className="dialog-card-heading">
            <strong id={titleId}>{title}</strong>
            <small>请仔细核对以下信息</small>
          </span>
          <button
            className="dialog-card-close"
            type="button"
            title="关闭"
            aria-label="关闭确认"
            disabled={pending}
            onClick={handleCancelClick}
          >
            <X size={16} />
          </button>
        </header>
        {summaryText && (
          <div className="dialog-card-summary">
            {summaryText}
          </div>
        )}
        <p id={descId} className="confirm-dialog-description">
          {description}
        </p>
        
        {error && (
          <div className="confirm-dialog-error" role="alert">
            错误: {error}
          </div>
        )}

        <footer>
          <button
            ref={cancelRef}
            className="dialog-button dialog-button-secondary"
            type="button"
            disabled={pending}
            onClick={handleCancelClick}
          >
            {cancelText}
          </button>
          <button
            className={`dialog-button ${danger ? 'dialog-button-danger' : 'dialog-button-primary'}`}
            type="button"
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? '执行中...' : confirmText}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

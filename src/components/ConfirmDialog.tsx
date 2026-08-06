import { useEffect, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X } from 'lucide-react';

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

  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Sync open state changes
  useEffect(() => {
    if (open) {
      previousActiveElementRef.current = document.activeElement as HTMLElement;
      setPending(false);
      setError(null);
      // Let React render first then focus cancelRef (the safe default button)
      const timer = setTimeout(() => {
        cancelRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    } else {
      // Restore focus to original active element after closing
      if (previousActiveElementRef.current) {
        const target = previousActiveElementRef.current;
        setTimeout(() => {
          target.focus?.();
        }, 30);
      }
    }
  }, [open]);

  // Tab cycle trap & Escape key listener
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!pending) {
          onCancel();
        }
        return;
      }

      if (event.key === 'Tab') {
        const focusable = [closeRef.current, cancelRef.current, confirmRef.current].filter(
          (el): el is HTMLButtonElement => el !== null && !el.disabled
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey) {
          // Backward tab
          if (document.activeElement === first) {
            last.focus();
            event.preventDefault();
          }
        } else {
          // Forward tab
          if (document.activeElement === last) {
            first.focus();
            event.preventDefault();
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, pending, onCancel]);

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
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (!pending && event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
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
            ref={closeRef}
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
          <div className="confirm-dialog-error">
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
            ref={confirmRef}
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

import React, { useEffect, useRef, useState, useId } from 'react';
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
      className="settings-cache-confirm-backdrop"
      style={{ zIndex: 10000 }}
      onMouseDown={(event) => {
        if (!pending && event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="settings-cache-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <header>
          <span
            className="settings-cache-confirm-mark"
            aria-hidden="true"
            style={{
              background: danger ? '#fee2e2' : '#e0f2fe',
              color: danger ? '#dc2626' : '#0284c7',
            }}
          >
            {danger ? <Trash2 size={17} /> : <AlertTriangle size={17} />}
          </span>
          <span>
            <strong id={titleId}>{title}</strong>
            <small>请仔细核对以下信息</small>
          </span>
          <button
            ref={closeRef}
            className="icon-only-action"
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
          <div
            className="settings-cache-confirm-summary"
            style={{
              background: danger ? '#fef2f2' : '#f0f9ff',
              borderLeft: `3px solid ${danger ? '#ef4444' : '#0ea5e9'}`,
            }}
          >
            <span
              style={{
                fontSize: '14px',
                color: danger ? '#991b1b' : '#0369a1',
                fontWeight: 'bold',
              }}
            >
              {summaryText}
            </span>
          </div>
        )}
        <p id={descId} style={{ margin: '14px 0', fontSize: '13px', color: '#4b5563', lineHeight: '1.5' }}>
          {description}
        </p>
        
        {error && (
          <div
            style={{
              margin: '10px 0',
              padding: '8px 12px',
              background: '#fef2f2',
              border: '1px solid #fca5a5',
              borderRadius: '4px',
              color: '#991b1b',
              fontSize: '12px',
              fontWeight: 'bold',
              wordBreak: 'break-all'
            }}
          >
            错误: {error}
          </div>
        )}

        <footer>
          <button
            ref={cancelRef}
            className="secondary"
            type="button"
            disabled={pending}
            onClick={handleCancelClick}
          >
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            className={danger ? 'danger' : 'primary'}
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

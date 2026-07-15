import type React from 'react';
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
  if (!open) return null;

  return createPortal(
    <div
      className="settings-cache-confirm-backdrop"
      style={{ zIndex: 10000 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        className="settings-cache-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
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
            <strong id="confirm-dialog-title">{title}</strong>
            <small>请仔细核对以下信息</small>
          </span>
          <button
            className="icon-only-action"
            type="button"
            title="关闭"
            aria-label="关闭确认"
            onClick={onCancel}
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
        <p style={{ margin: '14px 0', fontSize: '13px', color: '#4b5563', lineHeight: '1.5' }}>
          {description}
        </p>
        <footer>
          <button
            className="secondary"
            type="button"
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            className={danger ? 'danger' : 'primary'}
            type="button"
            onClick={async () => {
              await onConfirm();
            }}
          >
            {confirmText}
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}

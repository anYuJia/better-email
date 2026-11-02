import { AlertCircle, FileUp, RotateCw, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, type FocusEvent } from 'react';
import type { AttachmentImportItem } from '../../app/attachmentImports';
import type { ComposerSendIssue } from '../../hooks/useComposerSend';
import { formatBytes } from '../../mailUtils';
import './composer-transfers.css';

type Props = {
  imports: AttachmentImportItem[];
  sendIssue?: ComposerSendIssue | null;
  disabled: boolean;
  onRetry?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onRetrySend: () => void;
};

export default function ComposerTransferStatus({ imports, sendIssue, disabled, onRetry, onDismiss, onRetrySend }: Props) {
  const pending = imports.filter((item) => item.status !== 'ready');
  const failures = pending.filter((item) => item.status === 'failed')
    .reduce((count, item) => count + (item.recoveryFiles?.length || 1), 0);
  const preparing = pending.filter((item) => item.status !== 'failed').length;
  const sectionRef = useRef<HTMLElement>(null);
  const labelId = useId();
  const focusAnchor = useRef<{
    element: HTMLElement; rowId?: string; index: number; composer: HTMLElement | null;
  } | null>(null);
  const visible = pending.length > 0 || !!sendIssue;

  function rememberFocus(event: FocusEvent<HTMLElement>) {
    const element = event.target;
    const row = element.closest<HTMLElement>('[data-import-id]');
    focusAnchor.current = {
      element, rowId: row?.dataset.importId,
      index: row ? pending.findIndex(item => item.id === row.dataset.importId) : 0,
      composer: event.currentTarget.closest<HTMLElement>('.composer'),
    };
  }

  useEffect(() => {
    if (!visible) return;
    const releaseFocus = (event: PointerEvent) => {
      if (!sectionRef.current?.contains(event.target as Node)) focusAnchor.current = null;
    };
    document.addEventListener('pointerdown', releaseFocus, true);
    return () => document.removeEventListener('pointerdown', releaseFocus, true);
  }, [visible]);

  useLayoutEffect(() => {
    const anchor = focusAnchor.current;
    if (!anchor || anchor.element.isConnected) return;
    focusAnchor.current = null;
    // Only repair focus lost with this row; async completion must never pull
    // focus back from another field or another compose window.
    if (document.activeElement && document.activeElement !== document.body) return;
    const section = sectionRef.current;
    const rows = Array.from(section?.querySelectorAll<HTMLElement>('[data-import-id]') ?? []);
    const sameRow = rows.find(row => row.dataset.importId === anchor.rowId);
    const nextRow = sameRow ?? rows[Math.min(Math.max(anchor.index, 0), rows.length - 1)];
    const target = nextRow?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? nextRow ?? section
      ?? anchor.composer?.querySelector<HTMLButtonElement>('button[aria-label="添加附件"]:not(:disabled)');
    if (target?.isConnected && !target.closest('[inert]')) target.focus();
  });

  if (!pending.length && !sendIssue) return null;

  return (
    <section ref={sectionRef} className="composer-transfer-status" aria-label="附件与发送状态" tabIndex={-1}
      onFocusCapture={rememberFocus}
      onBlurCapture={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focusAnchor.current = null;
      }}>
      {pending.length > 0 && (
        <>
          <p className="composer-transfer-summary" role="status" aria-atomic="true">
            {failures > 0
              ? <><strong>{failures} 个附件未准备好</strong>{preparing > 0 ? `，另有 ${preparing} 个正在准备` : '，请重试或移除后再发送'}</>
              : `正在准备 ${pending.length} 个附件，完成后即可发送`}
          </p>
          <ul className="composer-transfer-list" aria-label="附件准备列表">
            {pending.map((item, index) => (
              <li key={item.id} data-import-id={item.id} data-import-state={item.status} tabIndex={-1}
                aria-labelledby={`${labelId}-filename-${index}`} aria-describedby={`${labelId}-detail-${index}`}>
                {item.status === 'failed' ? <AlertCircle size={16} aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}
                <div className="composer-transfer-copy">
                  <span className="composer-transfer-filename" id={`${labelId}-filename-${index}`}>{item.filename}</span>
                  <small id={`${labelId}-detail-${index}`}>{item.sizeBytes === null ? '' : `${formatBytes(item.sizeBytes)} · `}
                    {item.status === 'failed' ? item.error || '添加失败' : item.status === 'queued' ? '等待处理' : item.progress === null ? '正在准备…' : `正在准备 ${Math.round(item.progress)}%`}
                  </small>
                  {item.status !== 'failed' && (
                    <progress max={100} value={item.progress ?? undefined} aria-label={`${item.filename} 准备进度`} />
                  )}
                </div>
                {item.status === 'failed' && (
                  <div className="composer-transfer-actions">
                    <button type="button" disabled={disabled || !onRetry} onClick={() => onRetry?.(item.id)} aria-label={`重试添加 ${item.filename}`}
                      aria-describedby={`${labelId}-detail-${index}`}>
                      <RotateCw size={16} aria-hidden="true" />重试
                    </button>
                    <button type="button" disabled={disabled || !onDismiss} onClick={() => onDismiss?.(item.id)} aria-label={`移除失败附件 ${item.filename}`}>
                      <X size={16} aria-hidden="true" />移除
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {sendIssue && (
        <div className="composer-delivery-issue" role="alert" data-send-outcome={sendIssue.kind}>
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <strong>{sendIssue.kind === 'uncertain' ? '请先核对发送结果' : '邮件尚未发出'}</strong>
            <p>{sendIssue.message}</p>
          </div>
          {sendIssue.kind === 'failed' && <button type="button" disabled={disabled || pending.length > 0} onClick={onRetrySend}>重试发送</button>}
        </div>
      )}
    </section>
  );
}

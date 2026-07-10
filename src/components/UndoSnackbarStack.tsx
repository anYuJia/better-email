import { X } from 'lucide-react';
import type { UndoAction } from '../app/types';
import type { SendUndoDelaySeconds } from '../app/appConfig';
import { formatDate } from '../mailUtils';

export type PendingSendUndo = {
  outboxId: number;
  subject: string;
  expiresAt: string;
  delaySeconds: SendUndoDelaySeconds;
};

type UndoSnackbarStackProps = {
  pendingSendUndo: PendingSendUndo | null;
  undoAction: UndoAction | null;
  onUndoSend: () => void;
  onDismissSend: () => void;
  onUndoAction: () => void;
  onDismissAction: () => void;
};

export default function UndoSnackbarStack({
  pendingSendUndo,
  undoAction,
  onUndoSend,
  onDismissSend,
  onUndoAction,
  onDismissAction,
}: UndoSnackbarStackProps) {
  if (!pendingSendUndo && !undoAction) return null;

  return (
    <div className="snackbar-stack">
      {pendingSendUndo && (
        <section className="undo-snackbar send-undo-snackbar" role="status" aria-live="polite">
          <div>
            <strong>邮件将在 {pendingSendUndo.delaySeconds} 秒后发送</strong>
            <span>{pendingSendUndo.subject} · 预计 {formatDate(pendingSendUndo.expiresAt)}</span>
          </div>
          <button type="button" onClick={onUndoSend}>
            撤回发送
          </button>
          <button type="button" aria-label="关闭发送提示" onClick={onDismissSend}>
            <X size={15} />
          </button>
          <span
            className="send-undo-progress"
            style={{ animationDuration: `${pendingSendUndo.delaySeconds}s` }}
            aria-hidden="true"
          />
        </section>
      )}
      {undoAction && (
        <section className="undo-snackbar" role="status" aria-live="polite">
          <div>
            <strong>{undoAction.title}</strong>
            <span>{undoAction.detail}</span>
          </div>
          <button type="button" onClick={onUndoAction}>
            撤销
          </button>
          <button type="button" aria-label="关闭撤销提示" onClick={onDismissAction}>
            <X size={15} />
          </button>
        </section>
      )}
    </div>
  );
}

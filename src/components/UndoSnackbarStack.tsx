import { useEffect, useState } from 'react';
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

function remainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

export default function UndoSnackbarStack({
  pendingSendUndo,
  undoAction,
  onUndoSend,
  onDismissSend,
  onUndoAction,
  onDismissAction,
}: UndoSnackbarStackProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    pendingSendUndo ? remainingSeconds(pendingSendUndo.expiresAt) : 0,
  );

  useEffect(() => {
    if (!pendingSendUndo) return undefined;
    const tick = () => setSecondsLeft(remainingSeconds(pendingSendUndo.expiresAt));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [pendingSendUndo]);

  if (!pendingSendUndo && !undoAction) return null;

  return (
    <div className="snackbar-stack">
      {pendingSendUndo && (
        <section className="undo-snackbar send-undo-snackbar" role="status" aria-live="polite">
          <div>
            <strong>
              {secondsLeft > 0
                ? `邮件将在 ${secondsLeft} 秒后发送`
                : '邮件已发送'}
            </strong>
            <span>{pendingSendUndo.subject} · 预计 {formatDate(pendingSendUndo.expiresAt)}</span>
          </div>
          <button type="button" onClick={onUndoSend}>
            撤回发送
          </button>
          <button type="button" className="undo-close" aria-label="关闭发送提示" onClick={onDismissSend}>
            <X size={14} />
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

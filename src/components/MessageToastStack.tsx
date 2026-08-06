import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { PendingSendUndo } from './UndoSnackbarStack';
import { formatDate } from '../mailUtils';

export type MessageToast = { id: number; text: string };

type MessageToastStackProps = {
  toasts: MessageToast[];
  pendingSendUndo: PendingSendUndo | null;
  onUndoSend: () => void;
  onDismissSend: () => void;
};

function remainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

export default function MessageToastStack({
  toasts,
  pendingSendUndo,
  onUndoSend,
  onDismissSend,
}: MessageToastStackProps) {
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

  if (!pendingSendUndo && toasts.length === 0) return null;

  return (
    <div className="message-toast-stack" role="status" aria-live="polite">
      {pendingSendUndo && (
        <section className="message-toast message-toast-undo">
          <div className="message-toast-undo-main">
            <strong>
              邮件将在 <b className="message-toast-count">{secondsLeft}</b> 秒后发送
            </strong>
            <span>
              {pendingSendUndo.subject} · 预计 {formatDate(pendingSendUndo.expiresAt)}
            </span>
          </div>
          <button type="button" className="message-toast-undo-btn" onClick={onUndoSend}>
            撤回发送
          </button>
          <button type="button" className="message-toast-close" aria-label="关闭发送提示" onClick={onDismissSend}>
            <X size={13} />
          </button>
          <span
            className="message-toast-progress"
            style={{ animationDuration: `${pendingSendUndo.delaySeconds}s` }}
            aria-hidden="true"
          />
        </section>
      )}
      {toasts.map((toast) => (
        <div key={toast.id} className="message-toast">
          <Check size={13} strokeWidth={2.5} />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}

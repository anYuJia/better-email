import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { PendingSendUndo } from './UndoSnackbarStack';
import { formatDate } from '../mailUtils';

export type MessageToast = { id: number; text: string };

type RenderedToast = MessageToast & { leaving?: boolean };
type RenderedUndo = PendingSendUndo & { leaving?: boolean };

type MessageToastStackProps = {
  toasts: MessageToast[];
  pendingSendUndo: PendingSendUndo | null;
  onUndoSend: () => void;
  onDismissSend: () => void;
};

const EXIT_MS = 260;

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
  const [leavingToasts, setLeavingToasts] = useState<RenderedToast[]>([]);
  const [leavingUndo, setLeavingUndo] = useState<RenderedUndo | null>(null);
  const prevToastsRef = useRef(toasts);
  const prevUndoRef = useRef(pendingSendUndo);

  useEffect(() => {
    if (!pendingSendUndo) return undefined;
    const tick = () => setSecondsLeft(remainingSeconds(pendingSendUndo.expiresAt));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [pendingSendUndo]);

  if (prevUndoRef.current !== null && pendingSendUndo === null && !leavingUndo) {
    setLeavingUndo({ ...prevUndoRef.current, leaving: true });
  }
  prevUndoRef.current = pendingSendUndo;

  const removedToasts = prevToastsRef.current.filter(
    (toast) => !toasts.some((next) => next.id === toast.id),
  );
  if (removedToasts.length > 0 && leavingToasts.length === 0) {
    setLeavingToasts(removedToasts.map((toast) => ({ ...toast, leaving: true })));
  }
  prevToastsRef.current = toasts;

  useEffect(() => {
    if (leavingToasts.length === 0 && !leavingUndo) return undefined;
    const timer = window.setTimeout(() => {
      setLeavingToasts([]);
      setLeavingUndo(null);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leavingToasts, leavingUndo]);

  const renderedUndo: RenderedUndo | null = pendingSendUndo ?? leavingUndo;
  const renderedToasts: RenderedToast[] = [...toasts, ...leavingToasts];

  if (!renderedUndo && renderedToasts.length === 0) return null;

  return (
    <div className="message-toast-stack" role="status" aria-live="polite">
      {renderedUndo && (
        <section
          className={`message-toast message-toast-undo${renderedUndo.leaving ? ' leaving' : ''}`}
        >
          <div className="message-toast-undo-main">
            <strong>
              邮件将在 <b key={secondsLeft} className="message-toast-count">{secondsLeft}</b> 秒后发送
            </strong>
            <span>
              {renderedUndo.subject} · 预计 {formatDate(renderedUndo.expiresAt)}
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
            style={{
              '--ui-animation-send-undo-progress-duration': `${renderedUndo.delaySeconds}s`,
            }}
            aria-hidden="true"
          />
        </section>
      )}
      {renderedToasts.map((toast) => (
        <div
          key={toast.id}
          className={`message-toast${toast.leaving ? ' leaving' : ''}${
            leavingUndo && !toast.leaving ? ' toast-delayed' : ''
          }`}
        >
          <Check size={13} strokeWidth={2.5} />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}

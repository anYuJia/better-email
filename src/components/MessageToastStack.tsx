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
  const [leaving, setLeaving] = useState<{ toasts: RenderedToast[]; undo: RenderedUndo | null }>({
    toasts: [],
    undo: null,
  });
  const prevPropsRef = useRef({ toasts, pendingSendUndo });

  useEffect(() => {
    if (!pendingSendUndo) return undefined;
    const tick = () => setSecondsLeft(remainingSeconds(pendingSendUndo.expiresAt));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [pendingSendUndo]);

  useEffect(() => {
    const prev = prevPropsRef.current;
    prevPropsRef.current = { toasts, pendingSendUndo };
    const nowIds = new Set(toasts.map((t) => t.id));
    const prevIds = new Set(prev.toasts.map((t) => t.id));
    const leftToasts = prev.toasts
      .filter((t) => prevIds.has(t.id) && !nowIds.has(t.id))
      .map((t) => ({ ...t, leaving: true }));
    const leftUndo =
      prev.pendingSendUndo && !pendingSendUndo ? { ...prev.pendingSendUndo, leaving: true } : null;
    if (leftToasts.length === 0 && !leftUndo) {
      setLeaving({ toasts: [], undo: null });
      return undefined;
    }
    setLeaving({ toasts: leftToasts, undo: leftUndo });
    const timer = window.setTimeout(() => setLeaving({ toasts: [], undo: null }), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [toasts, pendingSendUndo]);

  const renderedUndo: RenderedUndo | null = pendingSendUndo ?? (leaving.undo ? leaving.undo : null);
  const renderedToasts: RenderedToast[] = [...toasts, ...leaving.toasts];

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
            style={{ animationDuration: `${renderedUndo.delaySeconds}s` }}
            aria-hidden="true"
          />
        </section>
      )}
      {renderedToasts.map((toast) => (
        <div key={toast.id} className={`message-toast${toast.leaving ? ' leaving' : ''}`}>
          <Check size={13} strokeWidth={2.5} />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  );
}

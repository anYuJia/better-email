import { useEffect, useState } from 'react';
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

function reconcileToasts(
  current: RenderedToast[],
  incoming: MessageToast[],
): RenderedToast[] {
  const incomingIds = new Set(incoming.map((toast) => toast.id));
  const currentById = new Map(current.map((toast) => [toast.id, toast]));
  const next: RenderedToast[] = incoming.map((toast) => {
    const rendered = currentById.get(toast.id);
    if (rendered && !rendered.leaving && rendered.text === toast.text) return rendered;
    return { ...toast };
  });

  for (const toast of current) {
    if (incomingIds.has(toast.id)) continue;
    next.push(toast.leaving ? toast : { ...toast, leaving: true });
  }

  const unchanged = next.length === current.length
    && next.every((toast, index) => toast === current[index]);
  return unchanged ? current : next;
}

function reconcileUndo(
  current: RenderedUndo | null,
  incoming: PendingSendUndo | null,
): RenderedUndo | null {
  if (!incoming) {
    if (!current || current.leaving) return current;
    return { ...current, leaving: true };
  }
  if (
    current
    && !current.leaving
    && current.outboxId === incoming.outboxId
    && current.subject === incoming.subject
    && current.expiresAt === incoming.expiresAt
    && current.delaySeconds === incoming.delaySeconds
  ) {
    return current;
  }
  return { ...incoming };
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
  const [renderedToasts, setRenderedToasts] = useState<RenderedToast[]>(() => (
    toasts.map((toast) => ({ ...toast }))
  ));
  const [renderedUndo, setRenderedUndo] = useState<RenderedUndo | null>(() => (
    pendingSendUndo ? { ...pendingSendUndo } : null
  ));

  useEffect(() => {
    if (!pendingSendUndo) return undefined;
    const tick = () => setSecondsLeft(remainingSeconds(pendingSendUndo.expiresAt));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [pendingSendUndo]);

  useEffect(() => {
    setRenderedUndo((current) => reconcileUndo(current, pendingSendUndo));
  }, [pendingSendUndo]);

  useEffect(() => {
    setRenderedToasts((current) => reconcileToasts(current, toasts));
  }, [toasts]);

  useEffect(() => {
    const hasLeavingToast = renderedToasts.some((toast) => toast.leaving);
    if (!hasLeavingToast && !renderedUndo?.leaving) return undefined;
    const timer = window.setTimeout(() => {
      setRenderedToasts((current) => current.filter((toast) => !toast.leaving));
      setRenderedUndo((current) => (current?.leaving ? null : current));
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [renderedToasts, renderedUndo]);

  const hasVisualToast = Boolean(renderedUndo || renderedToasts.length > 0);

  return (
    <>
      {pendingSendUndo && (
        <span
          key={`send-undo-announcement-${pendingSendUndo.outboxId}`}
          className="status-live-region"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          邮件将在 {pendingSendUndo.delaySeconds} 秒后发送。主题：{pendingSendUndo.subject}。可选择撤回发送。
        </span>
      )}
      {toasts.map((toast) => (
        <span
          key={`message-toast-announcement-${toast.id}`}
          className="status-live-region"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {toast.text}
        </span>
      ))}
      {hasVisualToast && (
        <div className="message-toast-stack" aria-live="off">
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
                } as React.CSSProperties}
                aria-hidden="true"
              />
            </section>
          )}
          {renderedToasts.map((toast) => (
            <div
              key={toast.id}
              className={`message-toast${toast.leaving ? ' leaving' : ''}${
                renderedUndo?.leaving && !toast.leaving ? ' toast-delayed' : ''
              }`}
            >
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
              <span>{toast.text}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

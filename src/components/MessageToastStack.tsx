import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Info, X } from 'lucide-react';
import type { PendingSendUndo } from './UndoSnackbarStack';
import { formatDate } from '../mailUtils';

export type MessageToast = {
  id: number;
  text: string;
  tone?: 'success' | 'error' | 'info';
};

type GroupedToast = MessageToast & { groupKey: string; count: number };
type RenderedToast = GroupedToast & { leaving?: boolean };
type RenderedUndo = PendingSendUndo & { leaving?: boolean };

type MessageToastStackProps = {
  toasts: MessageToast[];
  pendingSendUndo: PendingSendUndo | null;
  onUndoSend: () => void;
  onDismissSend: () => void;
};

const EXIT_MS = 260;

function visibleSlots(): number {
  return (window.visualViewport?.height ?? window.innerHeight) < 480 ? 2 : 3;
}

function groupToasts(toasts: MessageToast[]): GroupedToast[] {
  const groups = new Map<string, GroupedToast>();
  for (const toast of toasts) {
    const groupKey = JSON.stringify([toast.tone ?? 'success', toast.text.trim()]);
    const previous = groups.get(groupKey);
    // A repeated result remains one announcement, while its visual count updates.
    groups.delete(groupKey);
    groups.set(groupKey, { ...toast, text: toast.text.trim(), groupKey, count: (previous?.count ?? 0) + 1 });
  }
  return [...groups.values()];
}

function remainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000));
}

function reconcileToasts(
  current: RenderedToast[],
  incoming: GroupedToast[],
  capacity: number,
): RenderedToast[] {
  const incomingIds = new Set(incoming.map((toast) => toast.groupKey));
  const currentById = new Map(current.map((toast) => [toast.groupKey, toast]));
  const next: RenderedToast[] = incoming.map((toast) => {
    const rendered = currentById.get(toast.groupKey);
    if (rendered && !rendered.leaving && rendered.count === toast.count) return rendered;
    return { ...toast };
  });

  for (const toast of current) {
    if (next.length >= capacity) break;
    if (incomingIds.has(toast.groupKey)) continue;
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
  const [slotCount, setSlotCount] = useState(visibleSlots);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const ownsFocusRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    pendingSendUndo ? remainingSeconds(pendingSendUndo.expiresAt) : 0,
  );
  const [renderedUndo, setRenderedUndo] = useState<RenderedUndo | null>(() => (
    pendingSendUndo ? { ...pendingSendUndo } : null
  ));
  const toastCapacity = slotCount - (pendingSendUndo || renderedUndo ? 1 : 0);
  const visibleToasts = useMemo(
    () => groupToasts(toasts).slice(-toastCapacity),
    [toasts, toastCapacity],
  );
  const [renderedToasts, setRenderedToasts] = useState<RenderedToast[]>(visibleToasts);
  const hasRenderedToasts = renderedToasts.length > 0;

  useEffect(() => {
    const resize = () => setSlotCount(visibleSlots());
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);

  useLayoutEffect(() => () => {
    if (ownsFocusRef.current && previousFocusRef.current?.isConnected
      && (document.activeElement === document.body || listRef.current?.contains(document.activeElement))) {
      previousFocusRef.current.focus({ preventScroll: true });
    }
  }, [hasRenderedToasts]);

  useEffect(() => {
    if (!pendingSendUndo) return undefined;
    const tick = () => setSecondsLeft(remainingSeconds(pendingSendUndo.expiresAt));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [pendingSendUndo]);

  useLayoutEffect(() => {
    setRenderedUndo((current) => reconcileUndo(current, pendingSendUndo));
  }, [pendingSendUndo]);

  useLayoutEffect(() => {
    setRenderedToasts((current) => reconcileToasts(current, visibleToasts, toastCapacity));
  }, [visibleToasts, toastCapacity]);

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
      {visibleToasts.map((toast) => (
        <span
          key={`message-toast-announcement-${toast.groupKey}`}
          className="status-live-region"
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
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
              aria-hidden={renderedUndo.leaving || undefined}
            >
              <div className="message-toast-undo-main">
                <strong>
                  邮件将在 <b key={secondsLeft} className="message-toast-count">{secondsLeft}</b> 秒后发送
                </strong>
                <span>
                  {renderedUndo.subject} · 预计 {formatDate(renderedUndo.expiresAt)}
                </span>
              </div>
              <button type="button" className="message-toast-undo-btn" disabled={renderedUndo.leaving} onClick={onUndoSend}>
                撤回发送
              </button>
              <button type="button" className="message-toast-close" aria-label="关闭发送提示" disabled={renderedUndo.leaving} onClick={onDismissSend}>
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
          {renderedToasts.length > 0 && <div
            ref={listRef}
            className="message-toast-list"
            role="region"
            aria-label="最近通知"
            tabIndex={0}
            onFocusCapture={(event) => {
              ownsFocusRef.current = true;
              if (event.relatedTarget instanceof HTMLElement && !event.currentTarget.contains(event.relatedTarget)) {
                previousFocusRef.current = event.relatedTarget;
              }
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) ownsFocusRef.current = false;
            }}
          >
          {renderedToasts.slice(0, toastCapacity).map((toast) => (
            <div
              key={toast.groupKey}
              aria-hidden={toast.leaving || undefined}
              className={`message-toast toast-${toast.tone ?? 'success'}${toast.leaving ? ' leaving' : ''}${
                renderedUndo?.leaving && !toast.leaving ? ' toast-delayed' : ''
              }`}
            >
              {toast.tone === 'error' ? (
                <AlertCircle size={15} strokeWidth={2.2} aria-hidden="true" />
              ) : toast.tone === 'info' ? (
                <Info size={15} strokeWidth={2.2} aria-hidden="true" />
              ) : (
                <Check size={14} strokeWidth={2.5} aria-hidden="true" />
              )}
              <span className="message-toast-text">{toast.text}</span>
              {toast.count > 1 && <span className="message-toast-repeat" aria-label={`重复 ${toast.count} 次`}>×{toast.count}</span>}
            </div>
          ))}
          </div>}
        </div>
      )}
    </>
  );
}

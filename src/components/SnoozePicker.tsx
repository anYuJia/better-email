import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarClock,
  CalendarDays,
  Clock3,
  Coffee,
  MoonStar,
  X,
} from 'lucide-react';
import {
  buildSnoozeOptions,
  parseFutureDateTimeLocal,
  toDateTimeLocalValue,
} from '../app/snooze';
import './snooze-picker.css';

type SnoozePickerProps = {
  targetCount: number;
  targetLabel: string;
  onConfirm: (snoozedUntil: string) => Promise<void> | void;
  onClose: () => void;
};

const presetIcons = {
  'later-today': MoonStar,
  tomorrow: Coffee,
  weekend: CalendarDays,
  'next-week': CalendarClock,
};

export default function SnoozePicker({
  targetCount,
  targetLabel,
  onConfirm,
  onClose,
}: SnoozePickerProps) {
  const now = useMemo(() => new Date(), []);
  const options = useMemo(() => buildSnoozeOptions(now), [now]);
  const [customValue, setCustomValue] = useState(toDateTimeLocalValue(options[1].date));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  // 打开时保存旧焦点并聚焦第一个选项；关闭时恢复旧焦点（触发元素可能已卸载）。
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    firstOptionRef.current?.focus();
    return () => {
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        try {
          previouslyFocused.focus();
        } catch {
          // 忽略不可聚焦的恢复目标。
        }
      }
    };
  }, []);

  // 背景 inert：把除本对话框外的 body 子元素设为 inert/aria-hidden，键盘与
  // 读屏焦点无法逃逸。用 previouslyInert 记录原状态，只恢复本层设置的 inert，
  // 不错误解除父层 modal 的 inert（支持嵌套 modal）。
  useEffect(() => {
    const modal = modalRef.current;
    const container = modal?.parentElement;
    if (!modal || !container) return undefined;
    const siblings = Array.from(container.children).filter((element) => element !== modal);
    const previouslyInert = new Map<Element, boolean>();
    for (const sibling of siblings) {
      previouslyInert.set(sibling, sibling.hasAttribute('inert'));
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }
    return () => {
      for (const sibling of siblings) {
        if (previouslyInert.get(sibling)) continue;
        sibling.removeAttribute('inert');
        sibling.removeAttribute('aria-hidden');
      }
    };
  }, []);

  // 焦点循环：Tab/Shift+Tab 在对话框内循环，不逃逸到背景。
  useEffect(() => {
    const modalNode = modalRef.current;
    if (!modalNode) return;
    const modal: HTMLElement = modalNode;
    const focusableSelector =
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!modal.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    modal.addEventListener('keydown', handleKeyDown);
    return () => modal.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, submitting]);

  async function confirm(date: Date) {
    setSubmitting(true);
    try {
      await onConfirm(date.toISOString());
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmCustom() {
    const date = parseFutureDateTimeLocal(customValue);
    if (!date) {
      setError('请选择一个晚于当前时间的日期');
      return;
    }
    setError('');
    await confirm(date);
  }

  return createPortal(
    <div
      className="snooze-backdrop"
      ref={modalRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section className="snooze-dialog" role="dialog" aria-modal="true" aria-labelledby="snooze-title">
        <header>
          <span className="snooze-dialog-icon" aria-hidden="true">
            <Clock3 size={19} />
          </span>
          <span>
            <strong id="snooze-title">稍后处理</strong>
            <small>{targetCount > 1 ? `${targetCount} 封邮件` : targetLabel}</small>
          </span>
          <button type="button" aria-label="关闭稍后处理" title="关闭" onClick={onClose} disabled={submitting}>
            <X size={16} />
          </button>
        </header>

        <div className="snooze-preset-grid">
          {options.map((option, index) => {
            const Icon = presetIcons[option.id];
            return (
              <button
                ref={index === 0 ? firstOptionRef : undefined}
                type="button"
                key={option.id}
                data-snooze-preset={option.id}
                disabled={submitting}
                onClick={() => { void confirm(option.date); }}
              >
                <span aria-hidden="true"><Icon size={17} /></span>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </button>
            );
          })}
        </div>

        <div className="snooze-custom">
          <span>
            <strong>自定义时间</strong>
            <small>邮件会在所选时间自动回到收件箱</small>
          </span>
          <div>
            <input
              type="datetime-local"
              aria-label="自定义稍后处理时间"
              value={customValue}
              min={toDateTimeLocalValue(new Date(Date.now() + 5 * 60 * 1000))}
              onChange={(event) => {
                setCustomValue(event.target.value);
                setError('');
              }}
            />
            <button type="button" onClick={() => { void confirmCustom(); }} disabled={submitting}>
              确定
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

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

  useEffect(() => {
    firstOptionRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

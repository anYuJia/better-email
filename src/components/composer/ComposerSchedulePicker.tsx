import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Trash2 } from 'lucide-react';
import { createPortal } from 'react-dom';

type ComposerSchedulePickerProps = {
  value: string;
  onChange: (value: string) => void;
  openRequest?: number;
  triggerLabel?: string;
  className?: string;
};

type TimeParts = {
  hour: number;
  minute: number;
};

type PickerPosition = {
  top: number;
  left: number;
};

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function parseDateTimeLocal(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    );
    if (
      date.getFullYear() === Number(match[1])
      && date.getMonth() === Number(match[2]) - 1
      && date.getDate() === Number(match[3])
      && date.getHours() === Number(match[4])
      && date.getMinutes() === Number(match[5])
    ) {
      return date;
    }
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateTimeLocalValue(date: Date) {
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join('T');
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function roundScheduleSeed() {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15);
  if (date.getMinutes() === 60) {
    date.setHours(date.getHours() + 1, 0, 0, 0);
  }
  return date;
}

function buildCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const firstCell = new Date(month.getFullYear(), month.getMonth(), 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(firstCell);
    day.setDate(firstCell.getDate() + index);
    return day;
  });
}

function displayValue(date: Date | null) {
  if (!date) return '选择发送时间';
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type TimeSelectProps = {
  ariaLabel: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
};

function TimeSelect({ ariaLabel, value, options, onChange }: TimeSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className="composer-schedule-time-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {pad(value)}
      </button>
      {open && (
        <div id={listboxId} className="composer-schedule-time-options" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              onClick={() => {
                onChange(option);
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
              }}
            >
              {pad(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ComposerSchedulePicker({
  value,
  onChange,
  openRequest,
  triggerLabel,
  className = '',
}: ComposerSchedulePickerProps) {
  const initialDateRef = useRef(parseDateTimeLocal(value) ?? roundScheduleSeed());
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(initialDateRef.current));
  const [time, setTime] = useState<TimeParts>(() => ({
    hour: initialDateRef.current.getHours(),
    minute: initialDateRef.current.getMinutes(),
  }));
  const lastOpenRequestRef = useRef<number | null>(openRequest ?? null);
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const selectedDate = parseDateTimeLocal(value);
  const selectedDayKey = selectedDate ? dateKey(selectedDate) : '';
  const calendarDays = buildCalendarDays(viewMonth);

  useEffect(() => {
    const next = parseDateTimeLocal(value);
    if (!next) return;
    setViewMonth(startOfMonth(next));
    setTime({ hour: next.getHours(), minute: next.getMinutes() });
  }, [value]);

  useLayoutEffect(() => {
    if (!open) return undefined;

    function updatePosition() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const margin = 12;
      const gap = 6;
      const left = Math.min(
        Math.max(margin, triggerRect.left),
        Math.max(margin, window.innerWidth - popoverRect.width - margin),
      );
      const below = triggerRect.bottom + gap;
      const above = triggerRect.top - popoverRect.height - gap;
      const fitsBelow = below + popoverRect.height <= window.innerHeight - margin;
      const fitsAbove = above >= margin;
      const maxTop = Math.max(margin, window.innerHeight - popoverRect.height - margin);
      const top = fitsBelow
        ? below
        : fitsAbove
          ? above
          : Math.min(Math.max(margin, below), maxTop);
      setPosition({ top, left });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node
        && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      event.stopImmediatePropagation();
    }

    document.addEventListener('pointerdown', handlePointerDown);
    // The composer modal also listens for Escape. Capture the first key so
    // closing this picker does not dismiss the whole compose window.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  function openPicker() {
    const current = selectedDate ?? initialDateRef.current;
    setViewMonth(startOfMonth(current));
    setTime({ hour: current.getHours(), minute: current.getMinutes() });
    setPosition(null);
    setOpen(true);
  }

  useEffect(() => {
    if (openRequest == null || openRequest === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = openRequest;
    openPicker();
  }, [openRequest]);

  function updateDateTime(date: Date, nextTime = time) {
    const next = new Date(date);
    next.setHours(nextTime.hour, nextTime.minute, 0, 0);
    onChange(toDateTimeLocalValue(next));
  }

  function selectDay(day: Date) {
    updateDateTime(day);
    setViewMonth(startOfMonth(day));
  }

  function selectToday() {
    const today = new Date();
    setViewMonth(startOfMonth(today));
    updateDateTime(today);
  }

  function updateTime(field: keyof TimeParts, valueText: string) {
    const nextTime = { ...time, [field]: Number(valueText) };
    setTime(nextTime);
    updateDateTime(selectedDate ?? initialDateRef.current, nextTime);
  }

  const monthLabel = `${viewMonth.getFullYear()}年${viewMonth.getMonth() + 1}月`;
  const picker = open ? (
    <section
      ref={popoverRef}
      className="composer-schedule-picker-popover"
      role="dialog"
      aria-label="选择定时发送时间"
      style={{
        top: position?.top ?? -10000,
        left: position?.left ?? -10000,
      }}
    >
      <header className="composer-schedule-picker-header">
        <div className="composer-schedule-picker-header-copy">
          <strong>{selectedDate ? displayValue(selectedDate) : '定时发送'}</strong>
          <small>{selectedDate ? '邮件将在该时间自动发送' : '选择发送日期和时间'}</small>
        </div>
        <div className="composer-schedule-picker-actions">
          <button
            type="button"
            className="composer-schedule-picker-today"
            onClick={selectToday}
          >
            今天
          </button>
          <button
            type="button"
            className="composer-schedule-picker-confirm"
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus({ preventScroll: true });
            }}
          >
            <Check size={13} aria-hidden="true" />
            确定
          </button>
        </div>
      </header>

      <div className="composer-schedule-picker-monthbar">
        <button
          type="button"
          aria-label="上个月"
          onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
        >
          <ChevronLeft size={15} />
        </button>
        <strong>{monthLabel}</strong>
        <button
          type="button"
          aria-label="下个月"
          onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="composer-schedule-picker-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="composer-schedule-picker-grid" role="grid" aria-label={monthLabel}>
        {calendarDays.map((day) => {
          const key = dateKey(day);
          const isCurrentMonth = day.getMonth() === viewMonth.getMonth();
          const isToday = key === dateKey(new Date());
          const isSelected = key === selectedDayKey;
          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-label={`${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              className={`composer-schedule-picker-day${isCurrentMonth ? '' : ' is-outside'}${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`}
              onClick={() => selectDay(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div className="composer-schedule-picker-time">
        <span>
          <Clock3 size={14} aria-hidden="true" />
          发送时间
        </span>
        <div className="composer-schedule-picker-time-fields">
          <TimeSelect
            ariaLabel="小时"
            value={time.hour}
            options={Array.from({ length: 24 }, (_, hour) => hour)}
            onChange={(hour) => updateTime('hour', String(hour))}
          />
          <b>:</b>
          <TimeSelect
            ariaLabel="分钟"
            value={time.minute}
            options={Array.from({ length: 60 }, (_, minute) => minute)}
            onChange={(minute) => updateTime('minute', String(minute))}
          />
        </div>
      </div>

      <footer className="composer-schedule-picker-footer">
        <button
          type="button"
          className="composer-schedule-picker-clear"
          onClick={() => {
            onChange('');
            setOpen(false);
            triggerRef.current?.focus({ preventScroll: true });
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
          清除定时
        </button>
      </footer>
    </section>
  ) : null;

  return (
    <span className={`composer-schedule-picker${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`composer-schedule-picker-trigger${selectedDate ? ' is-set' : ''}`}
        aria-label="定时发送时间"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            openPicker();
          }
        }}
      >
        <CalendarDays size={14} aria-hidden="true" />
        <span>{triggerLabel ?? displayValue(selectedDate)}</span>
      </button>
      {open && createPortal(picker, document.body)}
    </span>
  );
}

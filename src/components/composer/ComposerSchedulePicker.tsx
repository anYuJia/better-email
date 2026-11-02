import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useWheelContainment } from '../../hooks/useWheelContainment';
import usePopoverPresence from '../../hooks/usePopoverPresence';

type ComposerSchedulePickerProps = {
  active?: boolean;
  value: string;
  onChange: (value: string) => void;
  openRequest?: number;
  triggerLabel?: string;
  compactTriggerLabel?: string;
  className?: string;
  anchorRef?: RefObject<HTMLElement | null>;
  showTrigger?: boolean;
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
    ) return date;
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateTimeLocalValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateFromParts(day: string, time: TimeParts) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), time.hour, time.minute, 0, 0);
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null;
}

function roundScheduleSeed() {
  const date = new Date();
  date.setSeconds(0, 0);
  // Always advance at an exact quarter boundary; rounding 11:45:16 to
  // 11:45:00 would leave an expired schedule that cannot be confirmed.
  date.setMinutes(Math.ceil((date.getMinutes() + 1) / 15) * 15);
  if (date.getMinutes() === 60) date.setHours(date.getHours() + 1, 0, 0, 0);
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
  active: boolean;
  ariaLabel: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
};

function TimeSelect({ active, ariaLabel, value, options, onChange }: TimeSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const visible = active && open;

  useEffect(() => { if (!active) setOpen(false); }, [active]);

  useEffect(() => {
    if (!visible) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
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
  }, [visible]);

  return (
    <div className="composer-schedule-time-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={visible}
        aria-haspopup="listbox"
        onClick={() => { if (active) setOpen((current) => !current); }}
        onKeyDown={(event) => {
          if (active && event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {pad(value)}
      </button>
      {visible && (
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
  active = true,
  value,
  onChange,
  openRequest,
  triggerLabel,
  compactTriggerLabel,
  className = '',
  anchorRef,
  showTrigger = true,
}: ComposerSchedulePickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const lastOpenRequestRef = useRef<number | null>(openRequest ?? null);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(parseDateTimeLocal(value) ?? roundScheduleSeed()));
  const [draftDate, setDraftDate] = useState(() => dateKey(parseDateTimeLocal(value) ?? roundScheduleSeed()));
  const [draftTime, setDraftTime] = useState<TimeParts>(() => {
    const seed = parseDateTimeLocal(value) ?? roundScheduleSeed();
    return { hour: seed.getHours(), minute: seed.getMinutes() };
  });
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const [error, setError] = useState('');
  const visible = active && open;
  useWheelContainment(popoverRef, visible);
  const present = usePopoverPresence(popoverRef, visible);
  const committedDate = parseDateTimeLocal(value);
  const draftDateValue = dateFromParts(draftDate, draftTime);
  const calendarDays = buildCalendarDays(viewMonth);

  useLayoutEffect(() => {
    if (active) return;
    setOpen(false);
  }, [active]);

  useEffect(() => {
    if (present) return;
    setPosition(null);
    setError('');
    const next = parseDateTimeLocal(value);
    if (!next) return;
    setViewMonth(startOfMonth(next));
    setDraftDate(dateKey(next));
    setDraftTime({ hour: next.getHours(), minute: next.getMinutes() });
  }, [present, value]);

  useLayoutEffect(() => {
    if (!visible) return undefined;
    function updatePosition() {
      const anchor = triggerRef.current ?? anchorRef?.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const left = Math.min(Math.max(margin, anchorRect.right - popoverRect.width), Math.max(margin, window.innerWidth - popoverRect.width - margin));
      const below = anchorRect.bottom + gap;
      const above = anchorRect.top - popoverRect.height - gap;
      const top = below + popoverRect.height <= window.innerHeight - margin
        ? below
        : above >= margin
          ? above
          : Math.min(Math.max(margin, below), Math.max(margin, window.innerHeight - popoverRect.height - margin));
      setPosition({ top, left });
    }
    updatePosition();
    window.addEventListener('resize', updatePosition);
    document.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      document.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, visible]);

  function focusAnchor() {
    const anchor = triggerRef.current ?? anchorRef?.current;
    if (active && anchor?.isConnected && !anchor.closest('[inert]')) anchor.focus({ preventScroll: true });
  }

  function closeWithoutCommit() {
    setOpen(false);
    focusAnchor();
  }

  useEffect(() => {
    if (!visible) return undefined;
    popoverRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
      closeWithoutCommit();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Node && popoverRef.current?.querySelector('.composer-schedule-time-options')?.contains(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeWithoutCommit();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [visible]);

  function openPicker() {
    if (!active) return;
    // A stale autosaved schedule must not reopen on a time that can no longer
    // be confirmed. Start from the next quarter-hour when the saved value has
    // already passed, while preserving an active schedule for normal edits.
    const current = committedDate && committedDate.getTime() > Date.now()
      ? committedDate
      : roundScheduleSeed();
    setViewMonth(startOfMonth(current));
    setDraftDate(dateKey(current));
    setDraftTime({ hour: current.getHours(), minute: current.getMinutes() });
    setError('');
    setOpen(true);
  }

  useEffect(() => {
    if (openRequest == null || openRequest === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = openRequest;
    openPicker();
  }, [active, openRequest]);

  function confirmSchedule() {
    if (!visible) return;
    if (!draftDateValue || draftDateValue.getTime() <= Date.now()) {
      setError('请选择晚于当前时间的发送时间');
      return;
    }
    const nextValue = toDateTimeLocalValue(draftDateValue);
    setOpen(false);
    onChange(nextValue);
    focusAnchor();
  }

  const monthLabel = `${viewMonth.getFullYear()}年${viewMonth.getMonth() + 1}月`;
  const picker = present ? (
    <section
      ref={popoverRef}
      className="composer-schedule-picker-popover"
      role="dialog"
      aria-label="选择定时发送时间"
      aria-hidden={!visible || undefined}
      {...(!visible ? { inert: '' } : {})}
      style={{ top: position?.top ?? -10000, left: position?.left ?? -10000 }}
    >
      <header className="composer-schedule-picker-header">
        <div className="composer-schedule-picker-header-copy">
          <strong>{draftDateValue ? displayValue(draftDateValue) : '定时发送'}</strong>
          <small>确认后才会更新邮件草稿</small>
        </div>
        <div className="composer-schedule-picker-actions">
          <button type="button" className="composer-schedule-picker-today" onClick={() => {
            const today = new Date();
            setViewMonth(startOfMonth(today));
            setDraftDate(dateKey(today));
            setError('');
          }}>今天</button>
          <button type="button" className="composer-schedule-picker-confirm" onClick={confirmSchedule}>
            <Check size={16} aria-hidden="true" />确定
          </button>
        </div>
      </header>

      <div className="composer-schedule-picker-monthbar">
        <button type="button" aria-label="上个月" onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}>
          <ChevronLeft size={16} />
        </button>
        <strong>{monthLabel}</strong>
        <button type="button" aria-label="下个月" onClick={() => setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}>
          <ChevronRight size={16} />
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
          const isSelected = key === draftDate;
          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-label={`${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              className={`composer-schedule-picker-day${isCurrentMonth ? '' : ' is-outside'}${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}`}
              onClick={() => {
                setDraftDate(key);
                setViewMonth(startOfMonth(day));
                setError('');
              }}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div className="composer-schedule-picker-time">
        <span><Clock3 size={14} aria-hidden="true" />发送时间</span>
        <div className="composer-schedule-picker-time-fields">
          <TimeSelect active={visible} ariaLabel="小时" value={draftTime.hour} options={Array.from({ length: 24 }, (_, hour) => hour)} onChange={(hour) => { setDraftTime((current) => ({ ...current, hour })); setError(''); }} />
          <b>:</b>
          <TimeSelect active={visible} ariaLabel="分钟" value={draftTime.minute} options={Array.from({ length: 60 }, (_, minute) => minute)} onChange={(minute) => { setDraftTime((current) => ({ ...current, minute })); setError(''); }} />
        </div>
      </div>
      {error && <p className="composer-schedule-picker-error" role="alert">{error}</p>}
    </section>
  ) : null;

  return (
    <span className={`composer-schedule-picker${className ? ` ${className}` : ''}`}>
      {showTrigger && (
        <button
          ref={triggerRef}
          type="button"
          className={`composer-schedule-picker-trigger${committedDate ? ' is-set' : ''}`}
          aria-label="定时发送时间"
          aria-haspopup="dialog"
          aria-expanded={visible}
          disabled={!active}
          onClick={() => (open ? closeWithoutCommit() : openPicker())}
        >
          <CalendarDays size={14} aria-hidden="true" />
          {compactTriggerLabel ? (
            <>
              <span className="composer-schedule-label-full">{triggerLabel ?? displayValue(committedDate)}</span>
              <span className="composer-schedule-label-compact">{compactTriggerLabel}</span>
            </>
          ) : <span>{triggerLabel ?? displayValue(committedDate)}</span>}
        </button>
      )}
      {present && createPortal(picker, document.body)}
    </span>
  );
}

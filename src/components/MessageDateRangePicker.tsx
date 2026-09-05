import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import useModalAccessibility from '../hooks/useModalAccessibility';
import { resolveLocalDateTimeRange, type LocalDateTimeRange } from '../mailUtils';

type MessageDateRangePickerProps = {
  onConfirm: (range: LocalDateTimeRange) => void;
  disabled?: boolean;
};

type CalendarMonth = { year: number; month: number };
type RangeDraft = LocalDateTimeRange;

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const YEAR_OPTIONS = Array.from({ length: 201 }, (_, index) => 1900 + index);

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayKey() {
  return dateKey(new Date());
}

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3])
    ? date
    : null;
}

function monthOf(date: Date): CalendarMonth {
  return { year: date.getFullYear(), month: date.getMonth() };
}

function shiftMonth(value: CalendarMonth, delta: number): CalendarMonth {
  return monthOf(new Date(value.year, value.month + delta, 1));
}

function calendarDays(value: CalendarMonth): Array<Date | null> {
  const first = new Date(value.year, value.month, 1);
  const count = new Date(value.year, value.month + 1, 0).getDate();
  const days: Array<Date | null> = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= count; day += 1) days.push(new Date(value.year, value.month, day));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function CalendarSelect({
  label,
  value,
  options,
  onChange,
  format,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.indexOf(value)));

  useEffect(() => {
    setActiveIndex(Math.max(0, options.indexOf(value)));
  }, [value, options]);

  useEffect(() => {
    if (!open) return;
    const initialIndex = Math.max(0, options.indexOf(value));
    setActiveIndex(initialIndex);
    const target = rootRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    target?.scrollIntoView({ block: 'nearest' });
  }, [open, value, options]);

  useEffect(() => {
    if (!open || activeIndex < 0 || activeIndex >= options.length) return;
    const target = document.getElementById(`${listboxId}-opt-${options[activeIndex]}`);
    target?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listboxId, open, options]);

  useEffect(() => {
    if (!open) return undefined;
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape, true);
    };
  }, [open]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(true);
        setActiveIndex(Math.max(0, options.indexOf(value)));
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(options.length - 1, prev + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (event.key === 'PageDown') {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(options.length - 1, prev + 10));
      return;
    }

    if (event.key === 'PageUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 10));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const selected = options[activeIndex];
      if (selected !== undefined) {
        onChange(selected);
      }
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
  }

  const activeOptionId = open && activeIndex >= 0 ? `${listboxId}-opt-${options[activeIndex]}` : undefined;

  return (
    <div className="message-date-range-calendar-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={activeOptionId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span>{format(value)}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div id={listboxId} className="message-date-range-calendar-options" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button
              id={`${listboxId}-opt-${option}`}
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              className={[option === value ? 'is-selected' : '', activeIndex === index ? 'is-active' : ''].filter(Boolean).join(' ')}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => {
                onChange(option);
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
              }}
            >
              {format(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CalendarPane({
  label,
  value,
  selectedDate,
  onChangeMonth,
  onSelectDate,
}: {
  label: string;
  value: CalendarMonth;
  selectedDate: string;
  onChangeMonth: (next: CalendarMonth) => void;
  onSelectDate: (date: string) => void;
}) {
  const days = useMemo(() => calendarDays(value), [value]);
  return (
    <section className="message-date-range-calendar" aria-label={`${label}日期日历`}>
      <div className="message-date-range-calendar-header">
        <button type="button" aria-label={`${label}上一个月`} onClick={() => onChangeMonth(shiftMonth(value, -1))}>
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <div className="message-date-range-calendar-selects">
          <CalendarSelect
            label={`${label}年份`}
            value={value.year}
            options={YEAR_OPTIONS}
            format={(year) => `${year}年`}
            onChange={(year) => onChangeMonth({ year, month: value.month })}
          />
          <CalendarSelect
            label={`${label}月份`}
            value={value.month}
            options={Array.from({ length: 12 }, (_, month) => month)}
            format={(month) => `${month + 1}月`}
            onChange={(month) => onChangeMonth({ year: value.year, month })}
          />
        </div>
        <button type="button" aria-label={`${label}下一个月`} onClick={() => onChangeMonth(shiftMonth(value, 1))}>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="message-date-range-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="message-date-range-days">
        {days.map((date, index) => date ? (
          <button
            type="button"
            key={dateKey(date)}
            className={dateKey(date) === selectedDate ? 'is-selected' : ''}
            aria-label={`${label}${dateKey(date)}`}
            aria-pressed={dateKey(date) === selectedDate}
            onClick={() => onSelectDate(dateKey(date))}
          >
            {date.getDate()}
          </button>
        ) : <span className="message-date-range-day-empty" key={`empty-${index}`} aria-hidden="true" />)}
      </div>
    </section>
  );
}

export default function MessageDateRangePicker({ onConfirm, disabled = false }: MessageDateRangePickerProps) {
  const today = todayKey();
  const initialDate = parseDateKey(today) ?? new Date();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RangeDraft>({
    startDate: today,
    startTime: '00:00:00',
    endDate: today,
    endTime: '24:00:00',
  });
  const [startMonth, setStartMonth] = useState<CalendarMonth>(() => monthOf(initialDate));
  const [endMonth, setEndMonth] = useState<CalendarMonth>(() => shiftMonth(monthOf(initialDate), 1));
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const closePicker = () => {
    setOpen(false);
    setError('');
  };

  useModalAccessibility({ open, dialogRef, backdropRef, initialFocusRef: closeButtonRef, onEscape: closePicker });

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function applyPreset(days: number) {
    const end = new Date();
    const start = new Date();
    if (days > 1) {
      start.setDate(start.getDate() - (days - 1));
    }
    const startKey = dateKey(start);
    const endKey = dateKey(end);
    setDraft({
      startDate: startKey,
      startTime: '00:00:00',
      endDate: endKey,
      endTime: '24:00:00',
    });
    setStartMonth(monthOf(start));
    setEndMonth(monthOf(end));
    setError('');
  }

  function updateDraft(field: keyof RangeDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError('');
    const date = (field === 'startDate' || field === 'endDate') ? parseDateKey(value) : null;
    if (date && field === 'startDate') setStartMonth(monthOf(date));
    if (date && field === 'endDate') setEndMonth(monthOf(date));
  }

  function confirm() {
    const resolved = resolveLocalDateTimeRange(draft);
    if (!resolved.valid) {
      setError(resolved.error);
      return;
    }
    onConfirm(draft);
    closePicker();
  }

  return (
    <>
      <button
        type="button"
        className="message-date-range-trigger"
        aria-label="按日期范围筛选邮件"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => { setError(''); setOpen((current) => !current); }}
      >
        <CalendarDays size={14} aria-hidden="true" />
        <span>日期筛选</span>
      </button>
      {open && createPortal((
        <div className="message-date-range-backdrop" ref={backdropRef} onMouseDown={(event) => { if (event.target === event.currentTarget) closePicker(); }}>
          <section className="message-date-range-modal" role="dialog" aria-modal="true" aria-label="按日期范围筛选邮件" ref={dialogRef}>
            <header className="message-date-range-modal-header">
              <button ref={closeButtonRef} type="button" aria-label="关闭日期筛选" onClick={closePicker}><X size={17} aria-hidden="true" /></button>
              <h2>按日期范围筛选邮件</h2>
              <span aria-hidden="true" />
            </header>
            <div className="message-date-range-presets" role="group" aria-label="快捷日期范围">
              <button type="button" className="message-date-range-preset-btn" onClick={() => applyPreset(1)}>今天</button>
              <button type="button" className="message-date-range-preset-btn" onClick={() => applyPreset(7)}>近 7 天</button>
              <button type="button" className="message-date-range-preset-btn" onClick={() => applyPreset(30)}>近 30 天</button>
            </div>
            <div className="message-date-range-inputs">
              <label>
                <span>开始</span>
                <input aria-label="开始日期" type="text" inputMode="numeric" value={draft.startDate} placeholder="YYYY-MM-DD" onChange={(event) => updateDraft('startDate', event.target.value)} />
                <input aria-label="开始时间" type="text" inputMode="numeric" maxLength={8} value={draft.startTime} placeholder="24:00:00" onChange={(event) => updateDraft('startTime', event.target.value)} />
              </label>
              <span className="message-date-range-input-separator" aria-hidden="true">至</span>
              <label>
                <span>结束</span>
                <input aria-label="结束日期" type="text" inputMode="numeric" value={draft.endDate} placeholder="YYYY-MM-DD" onChange={(event) => updateDraft('endDate', event.target.value)} />
                <input aria-label="结束时间" type="text" inputMode="numeric" maxLength={8} value={draft.endTime} placeholder="24:00:00" onChange={(event) => updateDraft('endTime', event.target.value)} />
              </label>
            </div>
            <div className="message-date-range-calendars">
              <CalendarPane label="开始" value={startMonth} selectedDate={draft.startDate} onChangeMonth={setStartMonth} onSelectDate={(value) => updateDraft('startDate', value)} />
              <CalendarPane label="结束" value={endMonth} selectedDate={draft.endDate} onChangeMonth={setEndMonth} onSelectDate={(value) => updateDraft('endDate', value)} />
            </div>
            {error && <p className="message-date-range-error" role="alert">{error}</p>}
            <footer className="message-date-range-actions">
              <button type="button" onClick={closePicker}>取消</button>
              <button type="button" className="message-date-range-confirm" onClick={confirm}><Check size={14} aria-hidden="true" />确定</button>
            </footer>
          </section>
        </div>
      ), document.body)}
    </>
  );
}

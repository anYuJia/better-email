import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
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
          <select aria-label={`${label}年份`} value={value.year} onChange={(event) => onChangeMonth({ year: Number(event.target.value), month: value.month })}>
            {YEAR_OPTIONS.map((year) => <option key={year} value={year}>{year}年</option>)}
          </select>
          <select aria-label={`${label}月份`} value={value.month} onChange={(event) => onChangeMonth({ year: value.year, month: Number(event.target.value) })}>
            {Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{month + 1}月</option>)}
          </select>
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
    startTime: '24:00:00',
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
        <span>多筛日期</span>
      </button>
      {open && createPortal((
        <div className="message-date-range-backdrop" ref={backdropRef} onMouseDown={(event) => { if (event.target === event.currentTarget) closePicker(); }}>
          <section className="message-date-range-modal" role="dialog" aria-modal="true" aria-label="按日期范围筛选邮件" ref={dialogRef}>
            <header className="message-date-range-modal-header">
              <button ref={closeButtonRef} type="button" aria-label="关闭日期筛选" onClick={closePicker}><X size={17} aria-hidden="true" /></button>
              <h2>按日期范围筛选邮件</h2>
              <span aria-hidden="true" />
            </header>
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

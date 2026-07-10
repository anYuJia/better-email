import type { FolderRole } from './types';

export type SnoozePresetId = 'later-today' | 'tomorrow' | 'weekend' | 'next-week';

export type SnoozeOption = {
  id: SnoozePresetId;
  label: string;
  detail: string;
  date: Date;
};

function atLocalTime(date: Date, hour: number, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateDetail(date: Date, now: Date) {
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export function buildSnoozeOptions(now = new Date()): SnoozeOption[] {
  let laterToday = atLocalTime(now, 18);
  let laterTodayLabel = '今天晚些时候';
  if (laterToday.getTime() <= now.getTime()) {
    laterToday = atLocalTime(addDays(now, 1), 13);
    laterTodayLabel = '明天下午';
  }

  const tomorrow = atLocalTime(addDays(now, 1), 9);
  const daysUntilSaturday = ((6 - now.getDay() + 7) % 7) || 7;
  const weekend = atLocalTime(addDays(now, daysUntilSaturday), 9);
  const daysUntilMonday = ((1 - now.getDay() + 7) % 7) || 7;
  const nextWeek = atLocalTime(addDays(now, daysUntilMonday), 9);

  return [
    {
      id: 'later-today',
      label: laterTodayLabel,
      detail: dateDetail(laterToday, now),
      date: laterToday,
    },
    {
      id: 'tomorrow',
      label: '明天上午',
      detail: dateDetail(tomorrow, now),
      date: tomorrow,
    },
    {
      id: 'weekend',
      label: '本周末',
      detail: dateDetail(weekend, now),
      date: weekend,
    },
    {
      id: 'next-week',
      label: '下周一',
      detail: dateDetail(nextWeek, now),
      date: nextWeek,
    },
  ];
}

export function toDateTimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

export function parseFutureDateTimeLocal(value: string, now = new Date()) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime()) || date.getTime() <= now.getTime()) return null;
  return date;
}

export function canSnoozeRole(role: FolderRole) {
  return !['drafts', 'outbox', 'sent', 'trash', 'snoozed'].includes(role);
}

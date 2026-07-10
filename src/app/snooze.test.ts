import { describe, expect, it } from 'vitest';
import {
  buildSnoozeOptions,
  canSnoozeRole,
  parseFutureDateTimeLocal,
  toDateTimeLocalValue,
} from './snooze';

describe('snooze helpers', () => {
  it('builds future presets at predictable local times', () => {
    const now = new Date(2026, 6, 11, 10, 30);
    const options = buildSnoozeOptions(now);

    expect(options).toHaveLength(4);
    expect(options.every((option) => option.date.getTime() > now.getTime())).toBe(true);
    expect(options[0].date.getHours()).toBe(18);
    expect(options[1].date.getDate()).toBe(12);
    expect(options[1].date.getHours()).toBe(9);
    expect(options[2].date.getDay()).toBe(6);
    expect(options[3].date.getDay()).toBe(1);
  });

  it('moves later-today to tomorrow afternoon after 18:00', () => {
    const now = new Date(2026, 6, 11, 20, 0);
    const [laterToday] = buildSnoozeOptions(now);

    expect(laterToday.label).toBe('明天下午');
    expect(laterToday.date.getDate()).toBe(12);
    expect(laterToday.date.getHours()).toBe(13);
  });

  it('round-trips datetime-local values and rejects past dates', () => {
    const now = new Date(2026, 6, 11, 10, 0);
    const future = new Date(2026, 6, 12, 9, 30);
    const value = toDateTimeLocalValue(future);

    expect(value).toBe('2026-07-12T09:30');
    expect(parseFutureDateTimeLocal(value, now)?.getTime()).toBe(future.getTime());
    expect(parseFutureDateTimeLocal('2026-07-11T09:30', now)).toBeNull();
  });

  it('only allows incoming and organized mail to be snoozed', () => {
    expect(canSnoozeRole('inbox')).toBe(true);
    expect(canSnoozeRole('archive')).toBe(true);
    expect(canSnoozeRole('custom')).toBe(true);
    expect(canSnoozeRole('sent')).toBe(false);
    expect(canSnoozeRole('drafts')).toBe(false);
    expect(canSnoozeRole('trash')).toBe(false);
    expect(canSnoozeRole('snoozed')).toBe(false);
  });
});

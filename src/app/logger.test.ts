import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flowInfo,
  flowWarn,
  formatLogTimestamp,
  logError,
  logInfo,
  logLine,
  logWarn,
  verboseFlowLogsEnabled,
} from './logger';

/** 与 Rust 端 src-tauri/src/logging.rs 共用：YYYY-MM-DD HH:mm:ss.SSS ±HH:MM */
const TIMESTAMP_SHAPE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}$/;
const TIMESTAMP_PREFIXED_RE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}\] /;

/** 与 formatLogTimestamp 相同的本机时区偏移算法，用于独立校验偏移正确性。 */
function expectedLocalOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

describe('logger', () => {
  it('keeps verbose flow logs enabled in development', () => {
    expect(verboseFlowLogsEnabled(true, null)).toBe(true);
  });

  it('keeps production flow logs quiet unless explicitly enabled', () => {
    expect(verboseFlowLogsEnabled(false, null)).toBe(false);
    expect(verboseFlowLogsEnabled(false, { getItem: () => null })).toBe(false);
    expect(verboseFlowLogsEnabled(false, { getItem: () => '1' })).toBe(true);
  });

  it('fails closed when local storage is unavailable', () => {
    expect(verboseFlowLogsEnabled(false, {
      getItem: () => {
        throw new Error('storage unavailable');
      },
    })).toBe(false);
  });

  describe('timestamps', () => {
    const spies: Array<ReturnType<typeof vi.spyOn>> = [];
    afterEach(() => {
      spies.splice(0).forEach((spy) => spy.mockRestore());
    });

    function spyOnConsole(method: 'info' | 'warn' | 'error' | 'log' | 'debug') {
      const spy = vi.spyOn(console, method).mockImplementation(() => {});
      spies.push(spy);
      return spy;
    }

    it('formats a local timestamp with offset in the shared shape', () => {
      const date = new Date(2026, 7, 12, 14, 32, 8, 417);
      const stamp = formatLogTimestamp(date);
      expect(stamp).toMatch(TIMESTAMP_SHAPE_RE);
      expect(stamp).toContain('2026-08-12 14:32:08.417');
      // 偏移与 JS getTimezoneOffset 推导一致（保持本机时区）
      expect(stamp.endsWith(expectedLocalOffset(date))).toBe(true);
    });

    it('matches the timestamp shape shared with the Rust backend', () => {
      // 与 src-tauri/src/logging.rs 的 %Y-%m-%d %H:%M:%S%.3f %:z 保持一致。
      expect(formatLogTimestamp()).toMatch(TIMESTAMP_SHAPE_RE);
    });

    it('timestamps flow info logs and keeps the original body', () => {
      const infoSpy = spyOnConsole('info');
      flowInfo('sync', 'refreshAll start', { account_id: 1 });
      const [first, ...rest] = infoSpy.mock.calls[0];
      expect(typeof first).toBe('string');
      expect(first).toMatch(TIMESTAMP_PREFIXED_RE);
      expect(first).toContain('[sync] refreshAll start');
      expect(rest).toEqual([{ account_id: 1 }]);
    });

    it('timestamps flow warn logs', () => {
      const warnSpy = spyOnConsole('warn');
      flowWarn('app-flow', 'syncAndRefresh failed', { error: 'x' });
      const [first] = warnSpy.mock.calls[0];
      expect(first).toMatch(TIMESTAMP_PREFIXED_RE);
      expect(first).toContain('[app-flow] syncAndRefresh failed');
    });

    it('timestamps info and warn through their unified entries', () => {
      const infoSpy = spyOnConsole('info');
      const warnSpy = spyOnConsole('warn');
      logInfo('listening for events');
      logWarn('unread count stale', { count: 3 });
      expect(infoSpy.mock.calls[0][0]).toMatch(TIMESTAMP_PREFIXED_RE);
      expect(infoSpy.mock.calls[0][0]).toContain('listening for events');
      expect(warnSpy.mock.calls[0][0]).toMatch(TIMESTAMP_PREFIXED_RE);
      expect(warnSpy.mock.calls[0][0]).toContain('unread count stale');
    });

    it('timestamps error logs and serializes the error through the redaction boundary', () => {
      const errorSpy = spyOnConsole('error');
      const err = new Error('boom');
      logError('Failed to sync:', err);
      const [first, ...rest] = errorSpy.mock.calls[0];
      expect(first).toMatch(TIMESTAMP_PREFIXED_RE);
      expect(first).toContain('Failed to sync:');
      expect(rest).toEqual([expect.objectContaining({
        name: 'Error',
        message: 'boom',
        stack: expect.stringContaining('Error: boom'),
      })]);
      expect(rest[0]).not.toBe(err);
    });

    it('timestamps bare non-string arguments without bypassing error redaction', () => {
      const errorSpy = spyOnConsole('error');
      const err = new Error('boom');
      logError(err);
      const [first, ...rest] = errorSpy.mock.calls[0];
      expect(first).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}\]$/);
      expect(rest).toEqual([expect.objectContaining({
        name: 'Error',
        message: 'boom',
        stack: expect.stringContaining('Error: boom'),
      })]);
      expect(rest[0]).not.toBe(err);
    });

    it('timestamps plain log lines', () => {
      const logSpy = spyOnConsole('log');
      logLine('Mock opening URL:', 'https://example.com');
      const [first, ...rest] = logSpy.mock.calls[0];
      expect(first).toMatch(TIMESTAMP_PREFIXED_RE);
      expect(first).toContain('Mock opening URL:');
      expect(rest).toEqual(['https://example.com']);
    });
  });
});

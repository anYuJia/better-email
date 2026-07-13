import { describe, expect, it } from 'vitest';
import { verboseFlowLogsEnabled } from './logger';

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
});

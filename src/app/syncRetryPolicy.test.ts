import { describe, expect, it } from 'vitest';
import {
  SYNC_RETRY_BASE_DELAY_MS,
  SYNC_RETRY_MAX_DELAY_MS,
  syncRetryDelayMs,
} from './syncRetryPolicy';

describe('sync retry policy', () => {
  it('grows exponentially after consecutive failures', () => {
    const noJitter = () => 0.5;
    expect(syncRetryDelayMs(1, 60_000, noJitter)).toBe(5_000);
    expect(syncRetryDelayMs(2, 60_000, noJitter)).toBe(10_000);
    expect(syncRetryDelayMs(3, 60_000, noJitter)).toBe(20_000);
  });

  it('never retries slower than the normal timer interval', () => {
    const noJitter = () => 0.5;
    expect(syncRetryDelayMs(10, 30_000, noJitter)).toBe(30_000);
  });

  it('caps retry delays and keeps jitter bounded', () => {
    expect(syncRetryDelayMs(20, 60 * 60_000, () => 1)).toBe(SYNC_RETRY_MAX_DELAY_MS);
    expect(syncRetryDelayMs(1, 60_000, () => 0)).toBe(SYNC_RETRY_BASE_DELAY_MS);
  });
});

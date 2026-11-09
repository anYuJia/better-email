import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useBackgroundScheduler from './useBackgroundScheduler';

vi.mock('../tauriBridge', () => ({ isPermissionGranted: vi.fn().mockResolvedValue(false), invoke: vi.fn() }));

describe('scheduled outbox progress', () => {
  afterEach(() => vi.useRealTimers());

  it('runs due mail through the tracked background queue', async () => {
    vi.useFakeTimers();
    const enqueueBackgroundTask = vi.fn().mockResolvedValue({});
    const { unmount } = renderHook(() => useBackgroundScheduler({
      account: null,
      outbox: [{ id: 1, message_id: 2, subject: 'test', recipients: 'test@example.com', status: 'scheduled', attempts: 0,
        last_error: '', queued_at: '', next_attempt_at: new Date(Date.now() + 1000).toISOString() }],
      setOutbox: vi.fn(), setPendingSendUndo: vi.fn(), setNotificationStatus: vi.fn(),
      setBackgroundSyncStatus: vi.fn(), setStatus: vi.fn(), enqueueBackgroundTask,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(enqueueBackgroundTask).toHaveBeenCalledWith('outbox-smtp', 'timer');
    unmount();
  });

  it('triggers onSnoozeReleased when due snoozed messages are released', async () => {
    vi.useFakeTimers();
    const { invoke } = await import('../tauriBridge');
    vi.mocked(invoke).mockResolvedValue({ released_count: 2 });
    const onSnoozeReleased = vi.fn();
    const { unmount } = renderHook(() => useBackgroundScheduler({
      account: null,
      outbox: [],
      setOutbox: vi.fn(),
      setPendingSendUndo: vi.fn(),
      setNotificationStatus: vi.fn(),
      setBackgroundSyncStatus: vi.fn(),
      setStatus: vi.fn(),
      enqueueBackgroundTask: vi.fn(),
      onSnoozeReleased,
    }));
    await act(async () => { await Promise.resolve(); });
    expect(onSnoozeReleased).toHaveBeenCalled();
    unmount();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundTask } from './types';
import { waitForBackgroundTask } from './waitForBackgroundTask';

const task = (status: BackgroundTask['status'], message = '') => ({ id: 7, status, message }) as BackgroundTask;
afterEach(() => vi.useRealTimers());

describe('synchronization completion', () => {
  it('waits through queued and running states, not just enqueue acknowledgement', async () => {
    vi.useFakeTimers();
    const readTask = vi.fn().mockResolvedValueOnce(task('queued')).mockResolvedValueOnce(task('running')).mockResolvedValue(task('done'));
    const done = vi.fn();
    const completion = waitForBackgroundTask(7, { readTask }).then(done);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await completion;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'cancelled'] as const)('rejects a %s task with actionable detail', async (status) => {
    await expect(waitForBackgroundTask(7, { readTask: async () => task(status, '重新检查网络') })).rejects.toThrow('重新检查网络');
  });

  it('reports a timeout without claiming the synchronization completed', async () => {
    vi.useFakeTimers();
    const completion = waitForBackgroundTask(7, { timeoutMs: 100, pollMs: 50, readTask: async () => task('running') });
    const assertion = expect(completion).rejects.toThrow('同步尚未结束');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('stops polling when its owner unmounts', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const readTask = vi.fn(async () => task('running'));
    const completion = waitForBackgroundTask(7, { signal: controller.signal, readTask });
    const assertion = expect(completion).rejects.toThrow('等待已取消');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(3000);
    expect(readTask).toHaveBeenCalledTimes(1);
  });

  it('does not accept another task as this refresh result', async () => {
    await expect(waitForBackgroundTask(9, { readTask: async () => task('done') })).rejects.toThrow('无法确认');
  });
});

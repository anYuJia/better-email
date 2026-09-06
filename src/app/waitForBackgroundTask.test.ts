import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundTask } from './types';
import { waitForBackgroundTask } from './waitForBackgroundTask';

const task = (status: BackgroundTask['status'], message = '') => ({ id: 7, status, message }) as BackgroundTask;
afterEach(() => vi.useRealTimers());

describe('synchronization completion', () => {
  it('waits through queued and running states, not just enqueue acknowledgement', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const completion = waitForBackgroundTask(7, { timeoutMs: 100, pollMs: 50, readTask: async () => task('running') });
    const assertion = expect(completion).rejects.toThrow('同步尚未结束');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('stops polling when its owner unmounts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
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

describe('in-flight synchronization boundaries', () => {
  it('times out a stalled IPC call without polling again or retaining timers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const readTask = vi.fn(() => new Promise<BackgroundTask>(() => undefined));
    const assertion = expect(waitForBackgroundTask(7, { timeoutMs: 100, readTask })).rejects.toThrow('本次等待已超时');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(readTask).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a pending IPC call and ignores a late successful response', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const controller = new AbortController();
    let resolve!: (value: BackgroundTask) => void;
    const readTask = vi.fn(() => new Promise<BackgroundTask>((accept) => { resolve = accept; }));
    const assertion = expect(waitForBackgroundTask(7, { signal: controller.signal, readTask })).rejects.toThrow('等待已取消');
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    resolve(task('done'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(readTask).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a clock adjustment from extending the synchronization deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const readTask = vi.fn(async () => task('running'));
    const assertion = expect(waitForBackgroundTask(7, { timeoutMs: 100, pollMs: 50, readTask })).rejects.toThrow('本次等待已超时');
    await vi.advanceTimersByTimeAsync(50);
    vi.setSystemTime(Date.now() - 60_000);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid poll interval %s before reading', async (pollMs) => {
    const readTask = vi.fn(async () => task('done'));
    await expect(waitForBackgroundTask(7, { pollMs, readTask })).rejects.toThrow('参数无效');
    expect(readTask).not.toHaveBeenCalled();
  });

  it('rejects an unknown backend status instead of leaving the spinner running', async () => {
    await expect(waitForBackgroundTask(7, { readTask: async () => ({ ...task('running'), status: 'missing' } as unknown as BackgroundTask) })).rejects.toThrow('无法确认');
  });
  it('does not begin an IPC read after immediate cancellation', async () => {
    const controller = new AbortController();
    const readTask = vi.fn(async () => task('done'));
    const completion = waitForBackgroundTask(7, { readTask, signal: controller.signal });
    controller.abort();
    await expect(completion).rejects.toThrow('等待已取消');
    expect(readTask).not.toHaveBeenCalled();
  });

});

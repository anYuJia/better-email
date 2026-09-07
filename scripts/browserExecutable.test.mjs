import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findBrowserExecutable, probeExecutable } from './browserExecutable.mjs';

afterEach(() => vi.useRealTimers());
function processThat(action) {
  const child = new EventEmitter();
  child.kill = vi.fn();
  queueMicrotask(() => action(child));
  return child;
}
describe('browser executable discovery', () => {
  it('continues after unavailable platform executables without an unhandled error', async () => {
    const spawnProcess = vi.fn((name) => processThat((child) => {
      if (name === 'chrome') child.emit('exit', 0);
      else { child.emit('error', new Error('ENOENT')); child.emit('exit', -2); }
    }));
    expect(await findBrowserExecutable(['/missing/mac', '/missing/windows', 'chrome'], { spawnProcess })).toBe('chrome');
    expect(spawnProcess).toHaveBeenCalledTimes(3);
  });
  it('rejects nonzero versions and reports no valid candidate', async () => {
    const spawnProcess = () => processThat((child) => child.emit('exit', 1));
    await expect(findBrowserExecutable(['invalid'], { spawnProcess })).rejects.toThrow('not found');
  });
  it('terminates a hung version probe and ignores a late exit', async () => {
    vi.useFakeTimers();
    const child = new EventEmitter();
    child.kill = vi.fn();
    const result = probeExecutable('hung', { spawnProcess: () => child, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe(false);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('exit', 0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('handles a synchronous process creation failure', async () => {
    expect(await probeExecutable('bad', { spawnProcess: () => { throw new Error('cannot spawn'); } })).toBe(false);
  });
});

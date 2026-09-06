import type { BackgroundTask } from './types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

const cancelledMessage = '同步状态等待已取消';
const timeoutMessage = '同步尚未结束，请在任务中心查看进度；本次等待已超时';

function bounded<T>(operation: () => Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error(cancelledMessage)); return; }
    if (milliseconds <= 0) { reject(new Error(timeoutMessage)); return; }
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      complete();
    };
    const stop = () => finish(() => reject(new Error(cancelledMessage)));
    const timer = setTimeout(() => finish(() => reject(new Error(timeoutMessage))), milliseconds);
    signal?.addEventListener('abort', stop, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw new Error(cancelledMessage);
      return operation();
    }).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error(cancelledMessage)); return; }
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      reject(new Error(cancelledMessage));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

export async function waitForBackgroundTask(
  taskId: number,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    pollMs?: number;
    readTask?: (id: number) => Promise<BackgroundTask>;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const pollMs = options.pollMs ?? 750;
  if (!Number.isSafeInteger(taskId) || taskId <= 0
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647
    || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error('同步任务或等待参数无效');
  }
  const readTask = options.readTask ?? ((id) => invoke<BackgroundTask>(IPC.GetBackgroundTask, { taskId: id }));
  const deadline = performance.now() + timeoutMs;
  while (true) {
    const task = await bounded(() => readTask(taskId), deadline - performance.now(), options.signal);
    if (options.signal?.aborted) throw new Error(cancelledMessage);
    if (performance.now() >= deadline) throw new Error(timeoutMessage);
    if (!task || task.id !== taskId) throw new Error('无法确认本次同步任务状态，请查看任务中心');
    if (task.status === 'done') return;
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(task.message || (task.status === 'cancelled' ? '同步已取消' : '同步失败'));
    }
    if (task.status !== 'queued' && task.status !== 'running') {
      throw new Error('无法确认本次同步任务状态，请查看任务中心');
    }
    await pause(Math.min(pollMs, deadline - performance.now()), options.signal);
  }
}

import type { BackgroundTask } from './types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('同步状态等待已取消')); return; }
    const stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      reject(new Error('同步状态等待已取消'));
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
  const readTask = options.readTask ?? ((id) => invoke<BackgroundTask>(IPC.GetBackgroundTask, { taskId: id }));
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
  while (true) {
    if (options.signal?.aborted) throw new Error('同步状态等待已取消');
    const task = await readTask(taskId);
    if (!task || task.id !== taskId) throw new Error('无法确认本次同步任务状态，请查看任务中心');
    if (task.status === 'done') return;
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(task.message || (task.status === 'cancelled' ? '同步已取消' : '同步失败'));
    }
    if (Date.now() >= deadline) throw new Error('同步尚未结束，请在任务中心查看进度；本次等待已超时');
    await pause(Math.min(options.pollMs ?? 750, deadline - Date.now()), options.signal);
  }
}

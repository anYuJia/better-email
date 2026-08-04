import type { Message } from '../app/types';
import { flowInfo, flowWarn } from '../app/logger';

export const manualUnreadStorageKey = 'better-email.manual-unread-message-ids';
export const readerAttachmentLoadDelayMs = 0;
export const readerBodyFetchDelayMs = 16;
export const readerTrustedRemoteRenderDelayMs = 16;
export const readerBackgroundIdleTimeoutMs = 100;

export function readerFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('app-flow', event, details);
}

export function readerFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('app-flow', event, details);
}

export function loadManualUnreadMessageIds(): Set<number> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(manualUnreadStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is number => Number.isInteger(id) && id > 0));
  } catch {
    return new Set();
  }
}

export function saveManualUnreadMessageIds(ids: Set<number>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(manualUnreadStorageKey, JSON.stringify([...ids].slice(-5000)));
  } catch {
    // Best effort only; read state still works for the current session.
  }
}

type IdleScheduler = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export function scheduleReaderBackgroundWork(callback: () => void, delayMs: number): () => void {
  const scheduler = window as IdleScheduler;
  let idleHandle: number | null = null;
  let cancelled = false;
  const timer = window.setTimeout(() => {
    const run = () => {
      if (!cancelled) callback();
    };
    if (scheduler.requestIdleCallback) {
      idleHandle = scheduler.requestIdleCallback(run, { timeout: readerBackgroundIdleTimeoutMs });
    } else {
      run();
    }
  }, delayMs);

  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    if (idleHandle !== null) scheduler.cancelIdleCallback?.(idleHandle);
  };
}

export class MessageDetailLRU {
  private cache = new Map<number, Message>();
  private limit: number;

  constructor(limit = 5) {
    this.limit = limit;
  }

  get(id: number): Message | undefined {
    if (!this.cache.has(id)) return undefined;
    const val = this.cache.get(id)!;
    this.cache.delete(id);
    this.cache.set(id, val);
    return val;
  }

  peek(id: number): Message | undefined {
    return this.cache.get(id);
  }

  set(id: number, message: Message): void {
    if (this.cache.has(id)) {
      this.cache.delete(id);
    } else if (this.cache.size >= this.limit) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(id, message);
  }

  patch(id: number, patch: Partial<Message>): Message | undefined {
    const existing = this.cache.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, id: existing.id };
    this.cache.delete(id);
    this.cache.set(id, updated);
    return updated;
  }

  delete(id: number): void {
    this.cache.delete(id);
  }

  clear(): void {
    this.cache.clear();
  }
}

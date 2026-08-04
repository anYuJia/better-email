import { flowInfo, flowWarn } from './logger';
import { diagnosticInfo, diagnosticWarn } from './logger';
import type { OutboxItem } from './types';
import { invoke } from '../tauriBridge';
import { syncIntervalMs } from '../mailUtils';

const scheduledOutboxStatuses = new Set(['scheduled']);

export function syncModeStatus(syncMode: string) {
  const intervalMs = syncIntervalMs(syncMode);
  if (!intervalMs) return '后台获取新邮件已关闭';
  const minutes = Math.round(intervalMs / 60_000);
  return `后台获取新邮件已启用：每 ${minutes} 分钟`;
}

export function outboxFlowLog(event: string, details: Record<string, unknown> = {}) {
  flowInfo('outbox-flow', event, details);
}

export function outboxFlowWarn(event: string, details: Record<string, unknown> = {}) {
  flowWarn('outbox-flow', event, details);
}

export function fetchTimerLog(event: string, details: Record<string, unknown> = {}) {
  diagnosticInfo('[better-email][fetch-timer]', event, details);
}

export function fetchTimerWarn(event: string, details: Record<string, unknown> = {}) {
  diagnosticWarn('[better-email][fetch-timer]', event, details);
}

export type OutboxInvoke = <T>(command: string) => Promise<T>;

export async function runDueOutboxSmtp(invokeCommand: OutboxInvoke = invoke): Promise<OutboxItem[]> {
  await invokeCommand<OutboxItem[]>('release_due_outbox_items');
  return invokeCommand<OutboxItem[]>('flush_outbox_smtp');
}

export function nextOutboxWakeItem(items: OutboxItem[]): OutboxItem | null {
  let nextItem: OutboxItem | null = null;
  let nextTimestamp = Number.POSITIVE_INFINITY;

  for (const item of items) {
    if (!scheduledOutboxStatuses.has(item.status) || !item.next_attempt_at) continue;
    const timestamp = Date.parse(item.next_attempt_at);
    if (!Number.isFinite(timestamp) || timestamp >= nextTimestamp) continue;
    nextItem = item;
    nextTimestamp = timestamp;
  }

  return nextItem;
}

export function outboxFlushMessage(items: OutboxItem[]): string {
  let failed = 0;
  let blocked = 0;
  let pendingRetry = 0;
  let archivePending = 0;

  for (const item of items) {
    if (item.status === 'retry') {
      failed += 1;
      if (item.next_attempt_at) pendingRetry += 1;
    } else if (item.status === 'failed') {
      blocked += 1;
    } else if (item.status === 'sent_remote_pending') {
      archivePending += 1;
    }
  }

  if (blocked > 0) {
    return `SMTP 发送暂停，${blocked} 封需要重新保存账号授权码`;
  }
  if (failed > 0) {
    return `SMTP 发送完成，${failed} 封需重试${pendingRetry > 0 ? '，已安排下次尝试' : ''}`;
  }
  if (archivePending > 0) {
    return `SMTP 发送完成，${archivePending} 封仅等待远端已发送留档重试`;
  }
  return 'SMTP 发件箱发送完成';
}

export function outboxStatusCounts(items: OutboxItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

import type { InvokeArgs } from './types';

const KEY = 'better-email:composer-recovery-v1';
type RecoveryRecord = { revision: number; payload: unknown };

export function loadMockComposerRecovery(): RecoveryRecord {
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return { revision: 0, payload: null };
  const record = JSON.parse(raw) as RecoveryRecord;
  if (!Number.isSafeInteger(record.revision)) throw new Error('恢复点版本无效');
  return record;
}

export function saveMockComposerRecovery(args?: InvokeArgs): boolean {
  if (!args || !Number.isSafeInteger(args.revision) || args.revision <= 0) return false;
  const current = loadMockComposerRecovery();
  if (args.revision <= current.revision) return false;
  const payload = JSON.parse(String(args.payloadJson));
  window.localStorage.setItem(KEY, JSON.stringify({ revision: args.revision, payload }));
  return true;
}

export function clearMockComposerRecovery(args?: InvokeArgs): boolean {
  return saveMockComposerRecovery(args ? { revision: args.revision, payloadJson: 'null' } : undefined);
}

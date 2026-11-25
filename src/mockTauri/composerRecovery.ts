import type { InvokeArgs } from './types';

const legacyKey = 'better-email:composer-recovery-v1';
const prefix = 'better-email:composer-recovery-v2:';
type RecoveryRecord = { revision: number; payload: unknown };

function key(accountId: number, draftId: number, recoveryId = '') {
  return `${prefix}${accountId}:${draftId}:${recoveryId}`;
}

function readRecord(storageKey: string): RecoveryRecord | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  const record = JSON.parse(raw) as RecoveryRecord;
  if (!Number.isSafeInteger(record.revision)) throw new Error('恢复点版本无效');
  return record;
}

function migrateLegacyRecord() {
  const previous = readRecord(legacyKey);
  if (!previous) return;
  const payload = previous.payload as { draft?: { account_id?: number; draft_id?: number } } | null;
  const target = key(payload?.draft?.account_id ?? 0, payload?.draft?.draft_id ?? 0);
  if ((readRecord(target)?.revision ?? 0) < previous.revision) {
    localStorage.setItem(target, JSON.stringify(previous));
  }
  localStorage.removeItem(legacyKey);
}

export function loadMockComposerRecovery(args?: InvokeArgs): RecoveryRecord {
  migrateLegacyRecord();
  const accountId = args?.accountId;
  const draftId = args?.draftId;
  const missing = { revision: 0, payload: null };
  let maxRevision = 0;
  let latest = missing as RecoveryRecord;
  for (let index = 0; index < localStorage.length; index++) {
    const name = localStorage.key(index);
    if (!name?.startsWith(prefix)) continue;
    const [account, draft] = name.slice(prefix.length).split(':').map(Number);
    const entry = readRecord(name);
    if (entry) maxRevision = Math.max(maxRevision, entry.revision);
    if ((accountId != null && account !== accountId) || (draftId != null && draft !== draftId)) continue;
    if (!entry || (latest.payload && !entry.payload)) continue;
    if ((!latest.payload && entry.payload) || entry.revision > latest.revision) latest = entry;
  }
  return latest.revision ? latest : { revision: maxRevision, payload: null };
}

function writeRecord(accountId: number, draftId: number, recoveryId: string, record: RecoveryRecord) {
  if (!Number.isSafeInteger(record.revision) || record.revision <= 0) return false;
  migrateLegacyRecord();
  const name = key(accountId, draftId, recoveryId);
  if (record.revision <= (readRecord(name)?.revision ?? 0)) return false;
  localStorage.setItem(name, JSON.stringify(record));
  return true;
}

export function saveMockComposerRecovery(args?: InvokeArgs): boolean {
  if (!args) return false;
  const payload = JSON.parse(String(args.payloadJson));
  return writeRecord(payload.recovery_account_id ?? payload.draft.account_id, payload.draft.draft_id, payload.recovery_id ?? '',
    { revision: args.revision, payload });
}

export function clearMockComposerRecovery(args?: InvokeArgs): boolean {
  return args ? writeRecord(args.accountId, args.draftId, args.recoveryId ?? '', { revision: args.revision, payload: null }) : false;
}

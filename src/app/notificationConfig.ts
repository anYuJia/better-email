import { defaultNotificationPolicy, type NotificationPolicy } from '../mailUtils';
import { notificationPolicyStorageKey, sendUndoDelayStorageKey, readAppStorage } from './storageConfig';

export { notificationPolicyStorageKey, sendUndoDelayStorageKey };
export type SendUndoDelaySeconds = 0 | 5 | 10 | 20 | 30;
export const sendUndoDelayOptions: { value: SendUndoDelaySeconds; label: string }[] = [
  { value: 0, label: '关闭，立即发送' },
  { value: 5, label: '5 秒' },
  { value: 10, label: '10 秒（推荐）' },
  { value: 20, label: '20 秒' },
  { value: 30, label: '30 秒' },
];


export function loadNotificationPolicy(): NotificationPolicy {
  try {
    const stored = readAppStorage(notificationPolicyStorageKey);
    return stored ? { ...defaultNotificationPolicy, ...JSON.parse(stored) } : { ...defaultNotificationPolicy };
  } catch {
    return { ...defaultNotificationPolicy };
  }
}

export function loadSendUndoDelaySeconds(): SendUndoDelaySeconds {
  try {
    const raw = readAppStorage(sendUndoDelayStorageKey);
    if (raw == null) return 10;
    const stored = Number(raw);
    return sendUndoDelayOptions.some((option) => option.value === stored)
      ? stored as SendUndoDelaySeconds
      : 10;
  } catch {
    return 10;
  }
}


export type AccountNotificationMode = 'normal' | 'priority' | 'muted';

export function notificationListEntries(value: string): string[] {
  return [...new Set(value
    .split(/[\n,;，；]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean))];
}

function updateNotificationList(value: string, email: string, include: boolean): string {
  const normalizedEmail = email.trim().toLowerCase();
  const current = notificationListEntries(value).filter((item) => item !== normalizedEmail);
  return (include && normalizedEmail ? [...current, normalizedEmail] : current).join('\n');
}

export function getAccountNotificationMode(policy: NotificationPolicy, email: string): AccountNotificationMode {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return 'normal';
  if (notificationListEntries(policy.mutedAccounts).includes(normalizedEmail)) return 'muted';
  if (notificationListEntries(policy.priorityAccounts).includes(normalizedEmail)) return 'priority';
  return 'normal';
}

export function setAccountNotificationMode(
  policy: NotificationPolicy,
  email: string,
  mode: AccountNotificationMode,
): NotificationPolicy {
  return {
    ...policy,
    mutedAccounts: updateNotificationList(policy.mutedAccounts, email, mode === 'muted'),
    priorityAccounts: updateNotificationList(policy.priorityAccounts, email, mode === 'priority'),
  };
}

export function toggleAccountNotificationList(
  policy: NotificationPolicy,
  key: 'mutedAccounts' | 'priorityAccounts',
  email: string,
): NotificationPolicy {
  const normalizedEmail = email.trim().toLowerCase();
  const current = notificationListEntries(policy[key]);
  const next = current.includes(normalizedEmail)
    ? current.filter((item) => item !== normalizedEmail)
    : [...current, normalizedEmail];
  const nextPolicy = { ...policy, [key]: next.join('\n') };
  if (current.includes(normalizedEmail)) return nextPolicy;
  return {
    ...nextPolicy,
    [key === 'mutedAccounts' ? 'priorityAccounts' : 'mutedAccounts']: updateNotificationList(
      policy[key === 'mutedAccounts' ? 'priorityAccounts' : 'mutedAccounts'],
      normalizedEmail,
      false,
    ),
  };
}

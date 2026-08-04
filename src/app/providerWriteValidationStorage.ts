import { emptyDraft } from './appConfig';
import type {
  Account,
  DraftInput,
  Message,
  RemoteActionReport,
} from './types';
import {
  providerWriteValidationStorageKey,
  providerWritebackValidationStorageKey,
} from './providerWriteValidationTypes';
import type {
  ProviderWritebackValidationRecord,
  ProviderWritebackValidationResult,
  ProviderWritebackValidationStepId,
} from './providerWriteValidationTypes';

export function createProviderWriteValidationId(now: Date = new Date()): string {
  return now.toISOString().replace(/\D/g, '').slice(0, 14);
}

export function buildProviderWriteValidationDraft(
  account: Account,
  validationId: string = createProviderWriteValidationId(),
): DraftInput {
  const safeValidationId = validationId.trim() || createProviderWriteValidationId();
  return {
    ...emptyDraft,
    account_id: account.id,
    to: account.email,
    subject: `[Better Email 验收] ${safeValidationId}`,
    body: [
      'Better Email 服务商写入验收',
      '',
      `验证编号：${safeValidationId}`,
      `账号：${account.email}`,
      '',
      '发送前确认',
      '1. 收件人应保持为当前账号，避免向第三方发送测试内容。',
      '2. 如需验证附件，请手动添加一个不含敏感信息的小文件。',
      '3. 不要在主题、正文或附件中粘贴密码、授权码或 Token。',
      '',
      '发送后检查',
      '1. SMTP 接受邮件，本地状态进入已发送或留档待重试。',
      '2. IMAP Sent 留档成功，远端已发送目录可看到同一验证编号。',
      '3. 自发自收邮件进入收件箱，正文和可选附件可正常读取。',
      '4. 已读、星标、归档与恢复操作可以回写远端。',
      '',
      '此草稿不会自动发送；请检查后在撰写器中手动点击发送。',
    ].join('\n'),
  };
}

export function loadProviderWriteValidationIds(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(providerWriteValidationStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([accountId, validationId]) => [accountId, String(validationId ?? '').trim()])
        .filter(([, validationId]) => Boolean(validationId)),
    );
  } catch {
    return {};
  }
}

export function saveProviderWriteValidationId(
  current: Record<string, string>,
  accountId: number,
  validationId: string,
): Record<string, string> {
  const next = {
    ...current,
    [String(accountId)]: validationId.trim(),
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(providerWriteValidationStorageKey, JSON.stringify(next));
  }
  return next;
}

export function loadProviderWritebackValidationRecords(): Record<
  string,
  ProviderWritebackValidationRecord
> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(providerWritebackValidationStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ProviderWritebackValidationRecord>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, record]) =>
        Boolean(record?.validationId?.trim()) && Boolean(record?.results)),
    );
  } catch {
    return {};
  }
}

export function saveProviderWritebackValidationResult(
  current: Record<string, ProviderWritebackValidationRecord>,
  accountId: number,
  validationId: string,
  stepId: ProviderWritebackValidationStepId,
  result: ProviderWritebackValidationResult,
): Record<string, ProviderWritebackValidationRecord> {
  const accountKey = String(accountId);
  const normalizedId = validationId.trim();
  const previous = current[accountKey];
  const next = {
    ...current,
    [accountKey]: {
      validationId: normalizedId,
      results: {
        ...(previous?.validationId === normalizedId ? previous.results : {}),
        [stepId]: result,
      },
    },
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(providerWritebackValidationStorageKey, JSON.stringify(next));
  }
  return next;
}

export function resetProviderWritebackValidation(
  current: Record<string, ProviderWritebackValidationRecord>,
  accountId: number,
  validationId: string,
): Record<string, ProviderWritebackValidationRecord> {
  const next = {
    ...current,
    [String(accountId)]: {
      validationId: validationId.trim(),
      results: {},
    },
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(providerWritebackValidationStorageKey, JSON.stringify(next));
  }
  return next;
}

export function providerWritebackResultFromReport(
  report: RemoteActionReport,
  checkedAt: string = new Date().toISOString(),
): ProviderWritebackValidationResult {
  if (report.remote_applied) {
    return { state: 'passed', detail: report.message, checkedAt };
  }
  if (report.remote_attempted) {
    return {
      state: 'failed',
      detail: '远端回写已尝试但未成功，请检查连接或服务商限制后重试。',
      checkedAt,
    };
  }
  return {
    state: 'warning',
    detail: '本地操作已完成，但远端未执行；请检查凭据、远端 UID 和文件夹映射。',
    checkedAt,
  };
}

export function matchesProviderWriteValidation(
  subject: string,
  validationId: string,
): boolean {
  const normalizedId = validationId.trim().toLowerCase();
  return Boolean(normalizedId) && subject.toLowerCase().includes(normalizedId);
}

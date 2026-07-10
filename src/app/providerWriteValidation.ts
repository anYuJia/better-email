import { emptyDraft } from './appConfig';
import type {
  Account,
  DraftInput,
  Message,
  OutboxItem,
  RemoteActionReport,
} from './types';

export const providerWriteValidationStorageKey = 'better-email.providerWriteValidationIds.v1';
export const providerWritebackValidationStorageKey = 'better-email.providerWritebackValidation.v1';

export type ProviderWriteValidationStageTone =
  | 'pending'
  | 'active'
  | 'passed'
  | 'warning'
  | 'failed';

export type ProviderWriteValidationStage = {
  id: 'smtp' | 'archive' | 'receipt' | 'attachment' | 'remote';
  title: string;
  tone: ProviderWriteValidationStageTone;
  detail: string;
};

export type ProviderWriteValidationStatus = {
  validationId: string;
  subject: string;
  stages: ProviderWriteValidationStage[];
  passedCoreStages: number;
  coreStageCount: number;
  complete: boolean;
  writebackComplete: boolean;
  sentMessageId: number | null;
  receivedMessageId: number | null;
};

export type ProviderWritebackValidationStepId = 'read' | 'star' | 'archive' | 'restore';
export type ProviderWritebackValidationState =
  | 'pending'
  | 'running'
  | 'passed'
  | 'warning'
  | 'failed';

export type ProviderWritebackValidationResult = {
  state: 'passed' | 'warning' | 'failed';
  detail: string;
  checkedAt: string;
};

export type ProviderWritebackValidationRecord = {
  validationId: string;
  results: Partial<Record<ProviderWritebackValidationStepId, ProviderWritebackValidationResult>>;
};

export type ProviderWritebackValidationStep = {
  id: ProviderWritebackValidationStepId;
  title: string;
  state: ProviderWritebackValidationState;
  detail: string;
  enabled: boolean;
};

export type ProviderWritebackValidationProgress = {
  validationId: string;
  ready: boolean;
  blockedReason: string;
  steps: ProviderWritebackValidationStep[];
  passedSteps: number;
  totalSteps: number;
  complete: boolean;
};

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

function newestMessage(messages: Message[]): Message | null {
  return [...messages].sort((left, right) => {
    const dateOrder = right.received_at.localeCompare(left.received_at);
    return dateOrder || right.id - left.id;
  })[0] ?? null;
}

export function selectProviderWriteValidationMessages(
  validationId: string,
  messages: Message[],
): { sentMessage: Message | null; receivedMessage: Message | null } {
  const normalizedId = validationId.trim();
  const matchedMessages = messages.filter((message) =>
    matchesProviderWriteValidation(message.subject, normalizedId));
  return {
    sentMessage: newestMessage(
      matchedMessages.filter((message) => message.folder_role === 'sent'),
    ),
    receivedMessage: newestMessage(
      matchedMessages.filter(
        (message) =>
          message.folder_role !== 'sent'
          && message.folder_role !== 'drafts'
          && message.folder_role !== 'outbox',
      ),
    ),
  };
}

const writebackStepDefinitions: Array<{
  id: ProviderWritebackValidationStepId;
  title: string;
  pendingDetail: string;
  runningDetail: string;
}> = [
  {
    id: 'read',
    title: '已读回写',
    pendingDetail: '把收件副本标为已读，并确认远端 \\Seen 状态。',
    runningDetail: '正在写入远端 \\Seen 状态。',
  },
  {
    id: 'star',
    title: '星标回写',
    pendingDetail: '添加星标，并确认远端 \\Flagged 状态。',
    runningDetail: '正在写入远端 \\Flagged 状态。',
  },
  {
    id: 'archive',
    title: '归档回写',
    pendingDetail: '移动到远端归档目录，并确认目标 mailbox 与 UID。',
    runningDetail: '正在把验证邮件移动到远端归档目录。',
  },
  {
    id: 'restore',
    title: '恢复回写',
    pendingDetail: '恢复到收件箱，并确认远端目标 UID 已重新绑定。',
    runningDetail: '正在把验证邮件恢复到远端收件箱。',
  },
];

export function buildProviderWritebackValidationProgress(
  validationId: string,
  receivedMessage: Message | null,
  record: ProviderWritebackValidationRecord | null,
  runningStep: ProviderWritebackValidationStepId | null = null,
): ProviderWritebackValidationProgress | null {
  const normalizedId = validationId.trim();
  if (!normalizedId) return null;
  const activeResults = record?.validationId === normalizedId ? record.results : {};
  const hasRemoteMailbox = Boolean(receivedMessage?.remote_mailbox.trim());
  const hasRemoteUid = (receivedMessage?.remote_uid ?? 0) > 0;
  const canRestoreByMessageId = Boolean(
    activeResults.archive?.state === 'passed'
    && receivedMessage?.message_id_header?.trim(),
  );
  const ready = hasRemoteMailbox && (hasRemoteUid || canRestoreByMessageId);
  const blockedReason = !receivedMessage
    ? '等待自发自收邮件进入本地列表后开始回写验收。'
    : !ready
      ? '收件副本缺少远端 mailbox 或 UID，暂不能安全执行回写验收。'
      : '';
  let previousPassed = true;
  const steps = writebackStepDefinitions.map((definition) => {
    const result = activeResults[definition.id];
    const state: ProviderWritebackValidationState = runningStep === definition.id
      ? 'running'
      : result?.state ?? 'pending';
    const enabled =
      ready
      && runningStep === null
      && previousPassed
      && state !== 'passed';
    const detail = state === 'running'
      ? definition.runningDetail
      : result?.detail ?? definition.pendingDetail;
    previousPassed = previousPassed && state === 'passed';
    return {
      id: definition.id,
      title: definition.title,
      state,
      detail,
      enabled,
    };
  });
  const passedSteps = steps.filter((step) => step.state === 'passed').length;
  return {
    validationId: normalizedId,
    ready,
    blockedReason,
    steps,
    passedSteps,
    totalSteps: steps.length,
    complete: passedSteps === steps.length,
  };
}

function smtpStage(item: OutboxItem | null, sentMessage: Message | null): ProviderWriteValidationStage {
  if (!item) {
    return sentMessage
      ? {
          id: 'smtp',
          title: 'SMTP 发送',
          tone: 'warning',
          detail: '已发现本地已发送邮件，但没有对应发件箱记录。',
        }
      : {
          id: 'smtp',
          title: 'SMTP 发送',
          tone: 'pending',
          detail: '草稿尚未加入发件箱，真实发送仍需手动确认。',
        };
  }
  if (item.status === 'sent' || item.status === 'sent_remote_pending') {
    return {
      id: 'smtp',
      title: 'SMTP 发送',
      tone: 'passed',
      detail: `SMTP 已接受邮件 · 尝试 ${item.attempts} 次`,
    };
  }
  if (item.status === 'sent_dry_run') {
    return {
      id: 'smtp',
      title: 'SMTP 发送',
      tone: 'warning',
      detail: '发送演练已完成，但没有真实连接 SMTP 投递。',
    };
  }
  if (item.status === 'retry' || item.status === 'failed') {
    return {
      id: 'smtp',
      title: 'SMTP 发送',
      tone: item.status === 'failed' ? 'failed' : 'warning',
      detail: item.last_error || 'SMTP 发送失败，等待重试。',
    };
  }
  if (item.status === 'cancelled') {
    return {
      id: 'smtp',
      title: 'SMTP 发送',
      tone: 'warning',
      detail: '发送已撤回，邮件回到草稿箱。',
    };
  }
  return {
    id: 'smtp',
    title: 'SMTP 发送',
    tone: 'active',
    detail: item.status === 'scheduled' && item.next_attempt_at
      ? `等待定时发送 · ${item.next_attempt_at}`
      : '邮件已进入发件箱，等待 SMTP 处理。',
  };
}

function archiveStage(
  item: OutboxItem | null,
  sentMessage: Message | null,
): ProviderWriteValidationStage {
  if (sentMessage?.remote_mailbox && sentMessage.remote_uid > 0) {
    return {
      id: 'archive',
      title: 'Sent 留档',
      tone: 'passed',
      detail: `${sentMessage.remote_mailbox} · UID ${sentMessage.remote_uid}`,
    };
  }
  if (item?.status === 'sent_remote_pending') {
    return {
      id: 'archive',
      title: 'Sent 留档',
      tone: 'warning',
      detail: item.last_error || 'SMTP 已完成，IMAP Sent 留档等待重试。',
    };
  }
  if (sentMessage || item?.status === 'sent') {
    return {
      id: 'archive',
      title: 'Sent 留档',
      tone: 'warning',
      detail: '本地已发送已生成，但尚未确认远端 mailbox 与 UID。',
    };
  }
  return {
    id: 'archive',
    title: 'Sent 留档',
    tone: 'pending',
    detail: '等待 SMTP 成功后写入远端已发送目录。',
  };
}

function receiptStage(receivedMessage: Message | null): ProviderWriteValidationStage {
  if (!receivedMessage) {
    return {
      id: 'receipt',
      title: '自发自收',
      tone: 'pending',
      detail: '同步邮件头后，将按验证编号查找收件副本。',
    };
  }
  return {
    id: 'receipt',
    title: '自发自收',
    tone: receivedMessage.remote_mailbox && receivedMessage.remote_uid > 0 ? 'passed' : 'warning',
    detail: receivedMessage.remote_mailbox && receivedMessage.remote_uid > 0
      ? `${receivedMessage.folder_role} · ${receivedMessage.remote_mailbox} UID ${receivedMessage.remote_uid}`
      : `已发现本地收件副本 · ${receivedMessage.folder_role}`,
  };
}

function attachmentStage(
  sentMessage: Message | null,
  receivedMessage: Message | null,
): ProviderWriteValidationStage {
  if (receivedMessage?.attachment_count) {
    return {
      id: 'attachment',
      title: '附件读取',
      tone: 'passed',
      detail: `收件副本包含 ${receivedMessage.attachment_count} 个附件，可继续下载验证。`,
    };
  }
  if (sentMessage?.attachment_count) {
    return {
      id: 'attachment',
      title: '附件读取',
      tone: 'active',
      detail: `已发送包含 ${sentMessage.attachment_count} 个附件，等待收件同步。`,
    };
  }
  return {
    id: 'attachment',
    title: '附件读取',
    tone: 'pending',
    detail: '本轮未添加附件；附件验证为可选步骤。',
  };
}

function remoteStage(
  receivedMessage: Message | null,
  writebackProgress: ProviderWritebackValidationProgress | null,
): ProviderWriteValidationStage {
  if (!receivedMessage) {
    return {
      id: 'remote',
      title: '远端回写',
      tone: 'pending',
      detail: '收到远端副本后，可定位邮件测试已读、星标、归档与恢复。',
    };
  }
  if (!receivedMessage.remote_mailbox || receivedMessage.remote_uid <= 0) {
    return {
      id: 'remote',
      title: '远端回写',
      tone: 'warning',
      detail: '收件副本缺少远端 mailbox 或 UID，暂不能安全回写。',
    };
  }
  if (writebackProgress?.complete) {
    return {
      id: 'remote',
      title: '远端回写',
      tone: 'passed',
      detail: '已读、星标、归档与恢复均已确认远端回写成功。',
    };
  }
  const failedStep = writebackProgress?.steps.find((step) => step.state === 'failed');
  if (failedStep) {
    return {
      id: 'remote',
      title: '远端回写',
      tone: 'failed',
      detail: `${failedStep.title}失败，可修复连接后从当前步骤重试。`,
    };
  }
  const warningStep = writebackProgress?.steps.find((step) => step.state === 'warning');
  if (warningStep) {
    return {
      id: 'remote',
      title: '远端回写',
      tone: 'warning',
      detail: `${warningStep.title}只完成本地操作，尚未确认远端结果。`,
    };
  }
  if ((writebackProgress?.passedSteps ?? 0) > 0) {
    return {
      id: 'remote',
      title: '远端回写',
      tone: 'active',
      detail: `已通过 ${writebackProgress?.passedSteps}/${writebackProgress?.totalSteps} 步，继续完成剩余回写验收。`,
    };
  }
  return {
    id: 'remote',
    title: '远端回写',
    tone: 'active',
    detail: `${receivedMessage.folder_role} · ${receivedMessage.is_read ? '已读' : '未读'} · ${
      receivedMessage.is_starred ? '已星标' : '未星标'
    }，可定位后继续操作验证。`,
  };
}

export function buildProviderWriteValidationStatus(
  validationId: string,
  messages: Message[],
  outbox: OutboxItem[],
  writebackProgress: ProviderWritebackValidationProgress | null = null,
): ProviderWriteValidationStatus | null {
  const normalizedId = validationId.trim();
  if (!normalizedId) return null;
  const matchedOutbox = outbox
    .filter((item) => matchesProviderWriteValidation(item.subject, normalizedId))
    .sort((left, right) => right.id - left.id)[0] ?? null;
  const { sentMessage, receivedMessage } = selectProviderWriteValidationMessages(
    normalizedId,
    messages,
  );
  const stages = [
    smtpStage(matchedOutbox, sentMessage),
    archiveStage(matchedOutbox, sentMessage),
    receiptStage(receivedMessage),
    attachmentStage(sentMessage, receivedMessage),
    remoteStage(receivedMessage, writebackProgress),
  ];
  const coreStageIds = new Set(['smtp', 'archive', 'receipt']);
  const passedCoreStages = stages.filter(
    (stage) => coreStageIds.has(stage.id) && stage.tone === 'passed',
  ).length;

  return {
    validationId: normalizedId,
    subject: `[Better Email 验收] ${normalizedId}`,
    stages,
    passedCoreStages,
    coreStageCount: coreStageIds.size,
    complete: passedCoreStages === coreStageIds.size,
    writebackComplete: writebackProgress?.complete ?? false,
    sentMessageId: sentMessage?.id ?? null,
    receivedMessageId: receivedMessage?.id ?? null,
  };
}

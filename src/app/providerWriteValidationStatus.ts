import type {
  Message,
  OutboxItem,
} from './types';
import type {
  ProviderWriteValidationStage,
  ProviderWriteValidationStatus,
  ProviderWritebackValidationProgress,
  ProviderWritebackValidationRecord,
  ProviderWritebackValidationState,
  ProviderWritebackValidationStepId,
} from './providerWriteValidationTypes';
import { matchesProviderWriteValidation } from './providerWriteValidationStorage';

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

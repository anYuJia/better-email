import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildProviderWritebackValidationProgress,
  buildProviderWriteValidationDraft,
  buildProviderWriteValidationStatus,
  createProviderWriteValidationId,
  loadProviderWriteValidationIds,
  loadProviderWritebackValidationRecords,
  providerWritebackResultFromReport,
  resetProviderWritebackValidation,
  saveProviderWriteValidationId,
  saveProviderWritebackValidationResult,
  selectProviderWriteValidationMessages,
  type ProviderWritebackValidationStepId,
} from '../app/providerWriteValidation';
import type {
  Account,
  DraftInput,
  Message,
  OutboxItem,
  RemoteActionReport,
  RestoreMessageReport,
} from '../app/types';
import { invoke } from '../tauriBridge';

type UseProviderWriteValidationOptions = {
  account: Account | null;
  outbox: OutboxItem[];
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useProviderWriteValidation({
  account,
  outbox,
  setStatus,
}: UseProviderWriteValidationOptions) {
  const [validationIds, setValidationIds] = useState<Record<string, string>>(
    loadProviderWriteValidationIds,
  );
  const [validationMessages, setValidationMessages] = useState<Message[]>([]);
  const [validationLoading, setValidationLoading] = useState(false);
  const [writebackRecords, setWritebackRecords] = useState(
    loadProviderWritebackValidationRecords,
  );
  const [runningWritebackStep, setRunningWritebackStep] =
    useState<ProviderWritebackValidationStepId | null>(null);
  const accountId = account?.id ?? 0;
  const activeValidationId = accountId ? validationIds[String(accountId)] ?? '' : '';
  const { receivedMessage } = useMemo(
    () => selectProviderWriteValidationMessages(activeValidationId, validationMessages),
    [activeValidationId, validationMessages],
  );
  const writebackProgress = useMemo(
    () => buildProviderWritebackValidationProgress(
      activeValidationId,
      receivedMessage,
      accountId ? writebackRecords[String(accountId)] ?? null : null,
      runningWritebackStep,
    ),
    [
      accountId,
      activeValidationId,
      receivedMessage,
      runningWritebackStep,
      writebackRecords,
    ],
  );
  const validationStatus = useMemo(
    () => buildProviderWriteValidationStatus(
      activeValidationId,
      validationMessages,
      outbox,
      writebackProgress,
    ),
    [activeValidationId, outbox, validationMessages, writebackProgress],
  );

  const refreshValidation = useCallback(async (announce = true) => {
    if (!accountId || !activeValidationId) {
      setValidationMessages([]);
      return [];
    }
    setValidationLoading(true);
    try {
      const nextMessages = await invoke<Message[]>('list_provider_write_validation_messages', {
        accountId,
        validationId: activeValidationId,
      });
      setValidationMessages(nextMessages);
      if (announce) {
        setStatus(
          nextMessages.length
            ? `已刷新验证 ${activeValidationId}：找到 ${nextMessages.length} 封相关邮件`
            : `已刷新验证 ${activeValidationId}：暂未找到已发送或收件副本`,
        );
      }
      return nextMessages;
    } finally {
      setValidationLoading(false);
    }
  }, [accountId, activeValidationId, setStatus]);

  useEffect(() => {
    setValidationMessages([]);
    setRunningWritebackStep(null);
    if (!accountId || !activeValidationId) return;
    refreshValidation(false).catch((error) => setStatus(String(error)));
  }, [accountId, activeValidationId, refreshValidation, setStatus]);

  function createValidationDraft(): DraftInput | null {
    if (!account) return null;
    const validationId = createProviderWriteValidationId();
    setValidationIds((current) =>
      saveProviderWriteValidationId(current, account.id, validationId));
    setWritebackRecords((current) =>
      resetProviderWritebackValidation(current, account.id, validationId));
    setValidationMessages([]);
    setRunningWritebackStep(null);
    return buildProviderWriteValidationDraft(account, validationId);
  }

  const runWritebackStep = useCallback(async (stepId: ProviderWritebackValidationStepId) => {
    if (!accountId || !activeValidationId || !receivedMessage || !writebackProgress) {
      setStatus('等待验证邮件进入收件箱后再执行远端回写验收');
      return;
    }
    const step = writebackProgress.steps.find((item) => item.id === stepId);
    if (!step?.enabled) {
      setStatus(step?.state === 'passed' ? `${step.title}已经通过` : '请按顺序完成前一步回写验收');
      return;
    }
    setRunningWritebackStep(stepId);
    try {
      let report: RemoteActionReport;
      if (stepId === 'read') {
        report = await invoke<RemoteActionReport>('set_message_read', {
          messageId: receivedMessage.id,
          isRead: true,
        });
      } else if (stepId === 'star') {
        report = await invoke<RemoteActionReport>('set_message_starred', {
          messageId: receivedMessage.id,
          isStarred: true,
        });
      } else if (stepId === 'archive') {
        report = await invoke<RemoteActionReport>('move_message_to_role', {
          messageId: receivedMessage.id,
          role: 'archive',
        });
      } else {
        const restored = await invoke<RestoreMessageReport>('restore_message_to_inbox', {
          messageId: receivedMessage.id,
        });
        report = restored.remote;
      }
      const result = providerWritebackResultFromReport(report);
      setWritebackRecords((current) =>
        saveProviderWritebackValidationResult(
          current,
          accountId,
          activeValidationId,
          stepId,
          result,
        ));
      await refreshValidation(false);
      setStatus(`${step.title}：${report.message}`);
    } catch (error) {
      setWritebackRecords((current) =>
        saveProviderWritebackValidationResult(
          current,
          accountId,
          activeValidationId,
          stepId,
          {
            state: 'failed',
            detail: '回写操作未完成，请检查连接后重试。',
            checkedAt: new Date().toISOString(),
          },
        ));
      setStatus(`${step.title}失败：${String(error)}`);
    } finally {
      setRunningWritebackStep(null);
    }
  }, [
    accountId,
    activeValidationId,
    receivedMessage,
    refreshValidation,
    setStatus,
    writebackProgress,
  ]);

  const resetWritebackProgress = useCallback(() => {
    if (!accountId || !activeValidationId) return;
    setWritebackRecords((current) =>
      resetProviderWritebackValidation(current, accountId, activeValidationId));
    setRunningWritebackStep(null);
    setStatus(`已重置验证 ${activeValidationId} 的远端回写进度`);
  }, [accountId, activeValidationId, setStatus]);

  return {
    activeValidationId,
    validationStatus,
    validationLoading,
    writebackProgress,
    runningWritebackStep,
    createValidationDraft,
    refreshValidation,
    runWritebackStep,
    resetWritebackProgress,
  };
}

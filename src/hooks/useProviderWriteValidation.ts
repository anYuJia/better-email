import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import {
  buildProviderWriteValidationDraft,
  buildProviderWriteValidationStatus,
  createProviderWriteValidationId,
  loadProviderWriteValidationIds,
  saveProviderWriteValidationId,
} from '../app/providerWriteValidation';
import type { Account, DraftInput, Message, OutboxItem } from '../app/types';
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
  const accountId = account?.id ?? 0;
  const activeValidationId = accountId ? validationIds[String(accountId)] ?? '' : '';
  const validationStatus = useMemo(
    () => buildProviderWriteValidationStatus(activeValidationId, validationMessages, outbox),
    [activeValidationId, outbox, validationMessages],
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
    if (!accountId || !activeValidationId) return;
    refreshValidation(false).catch((error) => setStatus(String(error)));
  }, [accountId, activeValidationId, refreshValidation, setStatus]);

  function createValidationDraft(): DraftInput | null {
    if (!account) return null;
    const validationId = createProviderWriteValidationId();
    setValidationIds((current) =>
      saveProviderWriteValidationId(current, account.id, validationId));
    setValidationMessages([]);
    return buildProviderWriteValidationDraft(account, validationId);
  }

  return {
    activeValidationId,
    validationStatus,
    validationLoading,
    createValidationDraft,
    refreshValidation,
  };
}

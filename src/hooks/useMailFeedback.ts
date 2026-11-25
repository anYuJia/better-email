import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { formatInvokeError } from '../app/accountConnectionFlows';
import type { AccountScope, OutboxItem } from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type Options = {
  accountScope: AccountScope;
  enqueueManualSyncAndWait: () => Promise<unknown>;
  refreshAll: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
};

export default function useMailFeedback({ accountScope, enqueueManualSyncAndWait, refreshAll, setStatus, setOutbox }: Options) {
  const [refreshErrors, setRefreshErrors] = useState<Partial<Record<AccountScope, string>>>({});
  const handleRefresh = useCallback(async () => {
    try {
      await enqueueManualSyncAndWait();
      setRefreshErrors((previous) => {
        if (!(accountScope in previous)) return previous;
        const next = { ...previous };
        delete next[accountScope];
        return next;
      });
    } catch (error) {
      const detail = formatInvokeError(error);
      setRefreshErrors((previous) => ({ ...previous, [accountScope]: detail }));
    }
  }, [accountScope, enqueueManualSyncAndWait]);
  const handleRefreshAction = useCallback(() => { void handleRefresh(); }, [handleRefresh]);
  const resolveDelivery = useCallback(async (outboxId: number, delivered: boolean) => {
    const updated = await invoke<OutboxItem>(IPC.ResolveOutboxOutcome, { outboxId, delivered });
    setOutbox((items) => items.map((item) => item.id === updated.id ? updated : item));
    try {
      await refreshAll();
    } catch (error) {
      setStatus(`结果已保存，但列表刷新失败：${String(error)}`);
      return;
    }
    setStatus(delivered ? '已确认发送，仅补存已发送副本，不会重发' : '已退回草稿，不会自动重发');
  }, [refreshAll, setOutbox, setStatus]);
  return { refreshError: refreshErrors[accountScope], handleRefresh, handleRefreshAction, resolveDelivery };
}

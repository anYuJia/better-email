import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { OutboxItem } from '../app/types';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type Options = {
  enqueueManualSyncAndWait: () => Promise<unknown>;
  refreshAll: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<string>>;
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
};

export default function useMailFeedback({ enqueueManualSyncAndWait, refreshAll, setStatus, setOutbox }: Options) {
  const handleRefresh = useCallback(async () => {
    try {
      await enqueueManualSyncAndWait();
    } catch (error) {
      setStatus(`刷新未完成：${String(error)}`);
      throw error;
    }
  }, [enqueueManualSyncAndWait, setStatus]);
  const handleRefreshAction = useCallback(() => { void handleRefresh().catch(() => undefined); }, [handleRefresh]);
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
  return { handleRefresh, handleRefreshAction, resolveDelivery };
}

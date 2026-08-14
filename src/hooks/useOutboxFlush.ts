import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { OutboxItem } from '../app/types';
import {
  outboxFlowLog,
  outboxFlowWarn,
  outboxFlushMessage,
  outboxStatusCounts,
  runDueOutboxSmtp,
} from '../app/backgroundTaskFlow';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type OutboxFlushOptions = {
  setOutbox: Dispatch<SetStateAction<OutboxItem[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  refreshMailboxContext: () => Promise<void>;
};

export default function useOutboxFlush({
  setOutbox,
  setStatus,
  refreshMailboxContext,
}: OutboxFlushOptions) {
  const flushOutboxDryRun = useCallback(async (): Promise<string> => {
    const items = await invoke<OutboxItem[]>(IPC.FlushOutboxDryRun);
    setOutbox(items);
    await refreshMailboxContext();
    const message = '发件箱队列已完成本地发送演练';
    setStatus(message);
    return message;
  }, [setOutbox, setStatus, refreshMailboxContext]);

  const flushOutboxSmtp = useCallback(async (taskId?: number): Promise<string> => {
    outboxFlowLog('manual smtp flush start');
    const items = await invoke<OutboxItem[]>(IPC.FlushOutboxSmtp, taskId == null ? undefined : { taskId });
    setOutbox(items);
    await refreshMailboxContext();
    const message = outboxFlushMessage(items);
    outboxFlowLog('manual smtp flush done', {
      outboxItems: items.length,
      statuses: outboxStatusCounts(items),
      message,
    });
    setStatus(message);
    return message;
  }, [setOutbox, setStatus, refreshMailboxContext]);

  const sendDueOutboxItems = useCallback(async (taskId?: number): Promise<{ message: string; items: OutboxItem[] }> => {
    outboxFlowLog('scheduled smtp due start');
    let items: OutboxItem[];
    try {
      if (taskId == null) {
        items = await runDueOutboxSmtp();
      } else {
        await invoke<OutboxItem[]>(IPC.ReleaseDueSnoozedMessages);
        items = await invoke<OutboxItem[]>(IPC.FlushOutboxSmtp, { taskId });
      }
    } catch (error) {
      outboxFlowWarn('scheduled smtp due failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    setOutbox(items);
    await refreshMailboxContext();
    const message = outboxFlushMessage(items);
    outboxFlowLog('scheduled smtp due done', {
      outboxItems: items.length,
      statuses: outboxStatusCounts(items),
      message,
    });
    setStatus(message);
    return { message, items };
  }, [setOutbox, setStatus, refreshMailboxContext]);

  return {
    flushOutboxDryRun,
    flushOutboxSmtp,
    sendDueOutboxItems,
  };
}

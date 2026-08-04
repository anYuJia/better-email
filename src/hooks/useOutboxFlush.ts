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
    const items = await invoke<OutboxItem[]>('flush_outbox_dry_run');
    setOutbox(items);
    await refreshMailboxContext();
    const message = '发件箱队列已完成本地发送演练';
    setStatus(message);
    return message;
  }, [setOutbox, setStatus, refreshMailboxContext]);

  const flushOutboxSmtp = useCallback(async (): Promise<string> => {
    outboxFlowLog('manual smtp flush start');
    const items = await invoke<OutboxItem[]>('flush_outbox_smtp');
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

  const sendDueOutboxItems = useCallback(async (): Promise<string> => {
    outboxFlowLog('scheduled smtp due start');
    let items: OutboxItem[];
    try {
      items = await runDueOutboxSmtp();
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
    return message;
  }, [setOutbox, setStatus, refreshMailboxContext]);

  return {
    flushOutboxDryRun,
    flushOutboxSmtp,
    sendDueOutboxItems,
  };
}

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { MessageSummary, ThreadSummary } from '../app/types';
import type { LoadMetaResult } from './useAppMetaLoader';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';

type PermanentDeleteControllerOptions = {
  selected: MessageSummary | null;
  messages: MessageSummary[];
  threadMessages: MessageSummary[];
  folderId: number | null;
  loadMeta: (folderId: number | null) => Promise<LoadMetaResult>;
  loadMessages: (folderId: number | null) => Promise<MessageSummary[]>;
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setSelectedMessageIds: Dispatch<SetStateAction<number[]>>;
  setActiveThread: Dispatch<SetStateAction<ThreadSummary | null>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  clearSelectedDetailIf: (messageId: number) => void;
};

export default function usePermanentDeleteController({
  selected,
  messages,
  threadMessages,
  folderId,
  loadMeta,
  loadMessages,
  setSelectedId,
  setSelectedMessageIds,
  setActiveThread,
  setThreadMessages,
  setStatus,
  clearSelectedDetailIf,
}: PermanentDeleteControllerOptions) {
  const [target, setTarget] = useState<MessageSummary[] | null>(null);

  const requestMessages = useCallback((input: MessageSummary | MessageSummary[]) => {
    const candidates = Array.isArray(input) ? input : [input];
    const trashMessages = [...new Map(
      candidates
        .filter((message) => message.folder_role === 'trash')
        .map((message) => [message.id, message]),
    ).values()];
    if (trashMessages.length === 0) {
      setStatus('只有废纸篓中的邮件可以永久删除');
      return;
    }
    setTarget(trashMessages);
  }, [setStatus]);

  const requestSelected = useCallback(() => {
    if (selected) requestMessages(selected);
  }, [requestMessages, selected]);

  const confirm = useCallback(async (input: MessageSummary[]) => {
    const targetMessages = [...new Map(
      input
        .filter((message) => message.folder_role === 'trash')
        .map((message) => [message.id, message]),
    ).values()];
    if (targetMessages.length === 0) return;

    const targetIds = new Set(targetMessages.map((message) => message.id));
    const firstVisibleIndex = messages.findIndex((message) => targetIds.has(message.id));
    let lastReport = '';
    for (const message of targetMessages) {
      const report = await invoke<{ message: string }>(IPC.DeleteMessagePermanently, {
        messageId: message.id,
      });
      lastReport = report.message;
      clearSelectedDetailIf(message.id);
    }

    await loadMeta(folderId);
    const refreshedMessages = await loadMessages(folderId);
    setSelectedMessageIds((current) => current.filter((messageId) => !targetIds.has(messageId)));
    if (selected && targetIds.has(selected.id)) {
      const fallbackIndex = firstVisibleIndex >= 0
        ? Math.min(firstVisibleIndex, refreshedMessages.length - 1)
        : 0;
      setSelectedId(refreshedMessages[fallbackIndex]?.id ?? null);
    }
    if (threadMessages.some((message) => targetIds.has(message.id))) {
      setActiveThread(null);
      setThreadMessages([]);
    }
    setStatus(targetMessages.length === 1 ? lastReport : `已永久删除 ${targetMessages.length} 封邮件`);
  }, [
    clearSelectedDetailIf,
    folderId,
    loadMessages,
    loadMeta,
    messages,
    selected,
    setActiveThread,
    setSelectedId,
    setSelectedMessageIds,
    setStatus,
    setThreadMessages,
    threadMessages,
  ]);

  return {
    confirmPermanentlyDelete: target,
    setConfirmPermanentlyDelete: setTarget,
    requestPermanentlyDeleteMessages: requestMessages,
    handlePermanentlyDelete: requestSelected,
    permanentlyDeleteMessageConfirmed: confirm,
  };
}

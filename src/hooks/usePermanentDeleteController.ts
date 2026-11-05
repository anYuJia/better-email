import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { MessageSummary, RemoteActionReport, ThreadSummary } from '../app/types';
import type { LoadMetaResult } from './useAppMetaLoader';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';

type PermanentDeleteControllerOptions = {
  selected: MessageSummary | null;
  messages: MessageSummary[];
  threadMessages: MessageSummary[];
  folderId: number | null;
  mailboxContextKey?: string;
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
  mailboxContextKey = String(folderId),
  loadMeta,
  loadMessages,
  setSelectedId,
  setSelectedMessageIds,
  setActiveThread,
  setThreadMessages,
  setStatus,
  clearSelectedDetailIf,
}: PermanentDeleteControllerOptions) {
  const inFlight = useRef(false);
  const [target, setTarget] = useState<MessageSummary[] | null>(null);
  const [deleteRefreshError, setDeleteRefreshError] = useState<string | null>(null);
  const refreshRetry = useRef<{ folderId: number | null; outcome: string } | null>(null);
  const refreshGeneration = useRef(0);
  const currentContext = useRef(mailboxContextKey);
  currentContext.current = mailboxContextKey;
  const retryInFlight = useRef(false);
  useEffect(() => {
    ++refreshGeneration.current;
    refreshRetry.current = null;
    setDeleteRefreshError(null);
  }, [mailboxContextKey]);
  const refreshAfterDelete = useCallback(async (targetFolderId: number | null, outcome: string) => {
    if (currentContext.current !== mailboxContextKey) return undefined;
    const generation = ++refreshGeneration.current;
    // The deletion is already committed. Refresh both independent views, and
    // never turn an unrelated refresh error into another destructive retry.
    const results = await Promise.allSettled([loadMeta(targetFolderId), loadMessages(targetFolderId)]);
    if (generation !== refreshGeneration.current || currentContext.current !== mailboxContextKey) return undefined;
    const failedRefresh = results.find((result) => result.status === 'rejected');
    const error = failedRefresh?.status === 'rejected'
      ? `列表刷新失败，请重试刷新：${String(failedRefresh.reason).replace(/^Error:\s*/i, '')}` : null;
    refreshRetry.current = error ? { folderId: targetFolderId, outcome } : null;
    setDeleteRefreshError(error);
    return error;
  }, [loadMeta, loadMessages, mailboxContextKey]);
  const retryDeleteRefresh = useCallback(async () => {
    const retry = refreshRetry.current;
    if (!retry || retryInFlight.current) return;
    retryInFlight.current = true;
    try {
      const error = await refreshAfterDelete(retry.folderId, retry.outcome);
      if (error !== undefined) setStatus(error ? `${retry.outcome}；${error}` : `${retry.outcome}；列表已刷新`);
    } finally {
      retryInFlight.current = false;
    }
  }, [refreshAfterDelete, setStatus]);

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

    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const deletedIds = new Set<number>();
      const failed: MessageSummary[] = [];
      const failures: string[] = [];
      let lastReport = '';
      for (const message of targetMessages) {
        try {
          const report = await invoke<RemoteActionReport>(IPC.DeleteMessagePermanently, { messageId: message.id });
          if (!report.local_applied) throw new Error(report.message || '服务器删除未确认，本地邮件仍保留');
          deletedIds.add(message.id);
          lastReport = report.message;
          clearSelectedDetailIf(message.id);
        } catch (error) {
          failed.push(message);
          failures.push(String(error).replace(/^Error:\s*/i, ''));
        }
      }
      // Apply acknowledged outcomes before network/UI refresh work. A failed
      // refresh must not leave deleted IDs selected or replay their deletion.
      setTarget(failed.length ? failed : null);
      if (deletedIds.size) {
        setSelectedMessageIds((current) => current.filter((id) => !deletedIds.has(id)));
        const firstVisibleIndex = messages.findIndex((message) => deletedIds.has(message.id));
        const remaining = messages.filter((message) => !deletedIds.has(message.id));
        const index = Math.max(0, Math.min(firstVisibleIndex, remaining.length - 1));
        setSelectedId((current) => current !== null && deletedIds.has(current) ? remaining[index]?.id ?? null : current);
        if (threadMessages.some((message) => deletedIds.has(message.id))) {
          setActiveThread(null);
          setThreadMessages([]);
        }
      }
      const outcome = failed.length
        ? `${deletedIds.size ? `已删除 ${deletedIds.size} 封；` : ''}${failed.length} 封尚未删除。${failures[0]}`
        : targetMessages.length === 1 ? lastReport : `已永久删除 ${deletedIds.size} 封邮件`;
      setStatus(outcome);
      const refreshError = deletedIds.size ? await refreshAfterDelete(folderId, outcome) : null;
      const detail = refreshError ? `${outcome}；${refreshError}` : outcome;
      if (refreshError) setStatus(detail);
      // Only failed deletions keep the destructive confirmation open.
      if (failed.length) throw new Error(detail);
    } finally {
      inFlight.current = false;
    }
  }, [
    clearSelectedDetailIf,
    folderId,
    refreshAfterDelete,
    messages,
    setActiveThread,
    setSelectedId,
    setSelectedMessageIds,
    setStatus,
    setThreadMessages,
    threadMessages,
  ]);

  return {
    deleteRefreshError,
    retryDeleteRefresh,
    confirmPermanentlyDelete: target,
    setConfirmPermanentlyDelete: setTarget,
    requestPermanentlyDeleteMessages: requestMessages,
    handlePermanentlyDelete: requestSelected,
    permanentlyDeleteMessageConfirmed: confirm,
  };
}

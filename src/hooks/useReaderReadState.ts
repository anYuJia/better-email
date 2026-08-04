import { startTransition, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import type {
  Folder,
  MailStats,
  MessageSummary,
  RemoteActionReport,
  ThreadSummary,
} from '../app/types';
import { invoke } from '../tauriBridge';
import {
  loadManualUnreadMessageIds,
  readerFlowLog,
  readerFlowWarn,
  saveManualUnreadMessageIds,
} from './readerSelectionState';

type ReaderReadStateOptions = {
  activeThread: ThreadSummary | null;
  setActiveThread: Dispatch<SetStateAction<ThreadSummary | null>>;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setStats: Dispatch<SetStateAction<MailStats | null>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setThreads: Dispatch<SetStateAction<ThreadSummary[]>>;
};

export default function useReaderReadState({
  activeThread,
  setActiveThread,
  setFolders,
  setMessages,
  setStats,
  setThreadMessages,
  setThreads,
}: ReaderReadStateOptions) {
  const manualUnreadMessageIdsRef = useRef<Set<number>>(loadManualUnreadMessageIds());
  const autoReadInFlightRef = useRef<Set<number>>(new Set());

  const rememberManualReadState = useCallback((messageIds: number[], isRead: boolean) => {
    const next = new Set(manualUnreadMessageIdsRef.current);
    for (const messageId of messageIds) {
      if (isRead) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
    }
    manualUnreadMessageIdsRef.current = next;
    saveManualUnreadMessageIds(next);
  }, []);

  const clearManualUnreadSuppression = useCallback((messageIds: number[]) => {
    if (messageIds.length === 0) return;
    const next = new Set(manualUnreadMessageIdsRef.current);
    let changed = false;
    for (const messageId of messageIds) {
      if (next.delete(messageId)) changed = true;
    }
    if (!changed) return;
    manualUnreadMessageIdsRef.current = next;
    saveManualUnreadMessageIds(next);
  }, []);

  const markMessageReadAfterReading = useCallback((message: MessageSummary) => {
    if (message.is_read) {
      return;
    }
    if (manualUnreadMessageIdsRef.current.has(message.id)) {
      return;
    }
    if (autoReadInFlightRef.current.has(message.id)) {
      return;
    }

    const selectedMessageId = message.id;
    const selectedAccountId = message.account_id;
    const selectedRemoteMailbox = message.remote_mailbox;
    const selectedRemoteUid = message.remote_uid;
    const activeThreadKey = activeThread?.thread_key ?? null;

    autoReadInFlightRef.current.add(selectedMessageId);
    readerFlowLog('markReadAfterReading start', {
      messageId: selectedMessageId,
      accountId: selectedAccountId,
      mailbox: selectedRemoteMailbox,
      uid: selectedRemoteUid,
    });
    invoke<RemoteActionReport>('set_message_read', { messageId: selectedMessageId, isRead: true })
      .then((report) => {
        startTransition(() => {
          setMessages((current) => current.map((item) => (
            item.id === selectedMessageId ? { ...item, is_read: true } : item
          )));
          if (activeThreadKey) {
            setThreadMessages((current) => current.map((item) => (
              item.id === selectedMessageId ? { ...item, is_read: true } : item
            )));
            setActiveThread((current) => current && current.thread_key === activeThreadKey
              ? { ...current, unread_count: Math.max(0, current.unread_count - 1) }
              : current);
            setThreads((current) => current.map((thread) => thread.thread_key === activeThreadKey
              ? { ...thread, unread_count: Math.max(0, thread.unread_count - 1) }
              : thread));
          }
          setStats((current) => current
            ? { ...current, unread_messages: Math.max(0, current.unread_messages - 1) }
            : current);
          setFolders((current) => current.map((folder) => (
            folder.id === message.folder_id || (folder.is_virtual && folder.role === message.folder_role)
              ? { ...folder, unread_count: Math.max(0, folder.unread_count - 1) }
              : folder
          )));
        });

        readerFlowLog('markReadAfterReading done', {
          messageId: selectedMessageId,
          message: report.message,
        });
      })
      .catch((error) => {
        readerFlowWarn('markReadAfterReading failed', {
          messageId: selectedMessageId,
          error: String(error).replace(/^Error:\s*/i, ''),
        });
      })
      .finally(() => {
        autoReadInFlightRef.current.delete(selectedMessageId);
      });
  }, [activeThread?.thread_key, setActiveThread, setFolders, setMessages, setStats, setThreadMessages, setThreads]);

  return {
    rememberManualReadState,
    clearManualUnreadSuppression,
    markMessageReadAfterReading,
  };
}

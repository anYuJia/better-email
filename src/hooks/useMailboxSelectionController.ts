import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { invoke } from '../tauriBridge';
import { MessageDetailLRU } from './readerSelectionState';
import useReaderBodyLoading from './useReaderBodyLoading';
import useReaderReadState from './useReaderReadState';
import {
  htmlHasRemoteVisualContent,
  isMessageBodyCorrupted,
  senderDomain,
} from '../mailUtils';
import {
  applyMessageMetadataPatch,
  resolveReaderSelectedDetail,
  type MessageMetadataPatch,
} from '../app/messageDetailUtils';
import type {
  Attachment,
  Folder,
  MailStats,
  Message,
  MessageSummary,
  RemoteActionReport,
  RemoteImageTrust,
  ThreadSummary,
} from '../app/types';

export type UseMailboxSelectionControllerOptions = {
  messages: MessageSummary[];
  threadMessages: MessageSummary[];
  threads: ThreadSummary[];
  activeThread: ThreadSummary | null;
  folders: Folder[];
  stats: MailStats | null;
  mailboxContextKey: string;
  remoteImageTrusts: RemoteImageTrust[];
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setThreads: Dispatch<SetStateAction<ThreadSummary[]>>;
  setActiveThread: Dispatch<SetStateAction<ThreadSummary | null>>;
  setStats: Dispatch<SetStateAction<MailStats | null>>;
  setFolders: Dispatch<SetStateAction<Folder[]>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useMailboxSelectionController({
  messages,
  threadMessages,
  threads,
  activeThread,
  folders,
  stats,
  mailboxContextKey,
  remoteImageTrusts,
  setMessages,
  setThreadMessages,
  setThreads,
  setActiveThread,
  setStats,
  setFolders,
  setAttachments,
  setStatus,
}: UseMailboxSelectionControllerOptions) {
  const {
    rememberManualReadState,
    clearManualUnreadSuppression,
    markMessageReadAfterReading,
  } = useReaderReadState({
    activeThread,
    setActiveThread,
    setFolders,
    setMessages,
    setStats,
    setThreadMessages,
    setThreads,
  });

  const [selectedId, setSelectedIdState] = useState<number | null>(null);
  const setSelectedId = useCallback((value: SetStateAction<number | null>) => {
    setSelectedIdState(value);
  }, []);
  const [readerSelectionRevision, setReaderSelectionRevision] = useState(0);
  const [selectedDetail, setSelectedDetail] = useState<Message | null>(null);
  const messageDetailCacheRef = useRef(new MessageDetailLRU(5));
  const selectedIdRef = useRef<number | null>(null);
  const selectedDetailRef = useRef<Message | null>(null);
  const detailContextKeyRef = useRef(mailboxContextKey);

  selectedIdRef.current = selectedId;
  selectedDetailRef.current = selectedDetail;

  const readerSelectedId = selectedId;

  const patchSelectedDetailMetadata = useCallback((messageId: number, patch: MessageMetadataPatch) => {
    messageDetailCacheRef.current.patch(messageId, patch);
    setSelectedDetail((current) => {
      if (!current || current.id !== messageId) return current;
      return applyMessageMetadataPatch(current, patch);
    });
  }, []);

  const invalidateSelectedDetail = useCallback((messageId: number) => {
    messageDetailCacheRef.current.delete(messageId);
    setSelectedDetail((current) => (current?.id === messageId ? null : current));
  }, []);

  const clearSelectedDetailIf = useCallback((messageId: number) => {
    messageDetailCacheRef.current.delete(messageId);
    if (selectedIdRef.current === messageId) {
      setSelectedId(null);
    }
    setSelectedDetail((current) => (current?.id === messageId ? null : current));
  }, [setSelectedId]);

  const updateDetailCache = useCallback((message: Message) => {
    messageDetailCacheRef.current.set(message.id, message);
  }, []);

  useEffect(() => {
    const contextChanged = detailContextKeyRef.current !== mailboxContextKey;
    detailContextKeyRef.current = mailboxContextKey;
    if (!readerSelectedId) {
      setSelectedDetail(null);
      return;
    }
    if (contextChanged) {
      // 邮箱上下文变化后旧缓存不再可信：即使选中 id 未变也要重新拉取
      messageDetailCacheRef.current.clear();
      setSelectedDetail(null);
    } else {
      const cached = messageDetailCacheRef.current.get(readerSelectedId);
      if (cached) {
        setSelectedDetail(cached);
        return;
      }
      // 无 cache 时立即清空旧详情，避免 reader 显示上一封邮件
      setSelectedDetail(null);
    }
    let cancelled = false;
    invoke<Message>('get_message_detail', { messageId: readerSelectedId })
      .then((detail) => {
        if (cancelled) return;
        messageDetailCacheRef.current.set(readerSelectedId, detail);
        setSelectedDetail(detail);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load message detail:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [readerSelectedId, mailboxContextKey]);

  // 派生值：确保 reader 只收到与当前 readerSelectedId 匹配的详情，防止 stale
  const readerSelectedDetail = useMemo(
    () => resolveReaderSelectedDetail(selectedDetail, readerSelectedId),
    [selectedDetail, readerSelectedId],
  );
  const selected = useMemo(
    () =>
      messages.find((message) => message.id === readerSelectedId)
      ?? threadMessages.find((message) => message.id === readerSelectedId)
      ?? null,
    [messages, threadMessages, readerSelectedId],
  );
  const selectedSenderDomain = useMemo(
    () => (readerSelectedDetail ? senderDomain(readerSelectedDetail.sender_email) : ''),
    [readerSelectedDetail?.sender_email],
  );
  const selectedSenderTrusted = useMemo(
    () =>
      Boolean(
        readerSelectedDetail &&
          remoteImageTrusts.some(
            (trust) =>
              trust.account_id === readerSelectedDetail.account_id &&
              ((trust.scope === 'sender' && trust.value === readerSelectedDetail.sender_email.trim().toLowerCase()) ||
                (trust.scope === 'domain' && trust.value === selectedSenderDomain)),
          ),
      ),
    [remoteImageTrusts, readerSelectedDetail?.account_id, readerSelectedDetail?.sender_email, selectedSenderDomain],
  );

  const {
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
  } = useReaderBodyLoading({
    selected,
    readerSelectedDetail,
    selectedDetail,
    selectedSenderTrusted,
    activeThread,
    messageDetailCacheRef,
    setAttachments,
    setMessages,
    setSelectedDetail,
    setStatus,
    setThreadMessages,
  });

  const selectMessageForReading = useCallback((messageId: number) => {
    clearManualUnreadSuppression([messageId]);
    setSelectedId(messageId);
    setReaderSelectionRevision((current) => current + 1);
  }, [clearManualUnreadSuppression, setSelectedId]);




  return {
    selectedId,
    setSelectedId,
    readerSelectedId,
    readerSelectedDetail,
    readerSelectionRevision,
    selected,
    selectedDetail,
    setSelectedDetail,
    selectedSenderDomain,
    selectedSenderTrusted,
    selectMessageForReading,
    patchSelectedDetailMetadata,
    invalidateSelectedDetail,
    clearSelectedDetailIf,
    updateDetailCache,
    rememberManualReadState,
    clearManualUnreadSuppression,
    markMessageReadAfterReading,
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
  };
}

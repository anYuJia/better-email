import {
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
  senderDomain,
} from '../mailUtils';
import {
  applyMessageMetadataPatch,
  type MessageMetadataPatch,
} from '../app/messageDetailUtils';
import { logError } from '../app/logger';
import type {
  Attachment,
  Folder,
  MailStats,
  Message,
  MessageSummary,
  RemoteImageTrust,
  ThreadSummary,
} from '../app/types';
import { IPC } from '../ipc/commands';

export type MessageDetailLoadState =
  | { status: 'idle' }
  | { status: 'loading'; messageId: number }
  | { status: 'error'; messageId: number; error: string };

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
  activeThread,
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
  const [detailLoadState, setDetailLoadState] = useState<MessageDetailLoadState>({ status: 'idle' });
  const [detailRetryRevision, setDetailRetryRevision] = useState(0);
  const messageDetailCacheRef = useRef(new MessageDetailLRU(5));
  const selectedIdRef = useRef<number | null>(null);
  const selectedDetailRef = useRef<Message | null>(null);
  const detailContextKeyRef = useRef(mailboxContextKey);

  selectedIdRef.current = selectedId;
  selectedDetailRef.current = selectedDetail;

  const readerSelectedId = selectedId;

  const patchSelectedDetailMetadata = useCallback((messageId: number, patch: MessageMetadataPatch) => {
    const applyMessageSummaryPatch = (nextMessages: MessageSummary[]) =>
      nextMessages.map((message) =>
        message.id === messageId ? { ...message, ...patch, id: message.id } : message,
      );

    setMessages(applyMessageSummaryPatch);
    setThreadMessages(applyMessageSummaryPatch);
    messageDetailCacheRef.current.patch(messageId, patch);
    setSelectedDetail((current) => {
      if (!current || current.id !== messageId) return current;
      return applyMessageMetadataPatch(current, patch);
    });
  }, [setMessages, setThreadMessages]);

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
      setDetailLoadState({ status: 'idle' });
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
        setDetailLoadState({ status: 'idle' });
        setSelectedDetail(cached);
        return;
      }
      // 无 cache 时立即清空旧详情，避免 reader 显示上一封邮件
      setSelectedDetail(null);
    }
    setDetailLoadState({ status: 'loading', messageId: readerSelectedId });
    let cancelled = false;
    invoke<Message>(IPC.GetMessageDetail, { messageId: readerSelectedId })
      .then((detail) => {
        if (cancelled) return;
        if (!detail || detail.id !== readerSelectedId) throw new Error('邮件详情不可用，请重试');
        messageDetailCacheRef.current.set(readerSelectedId, detail);
        setSelectedDetail(detail);
        setDetailLoadState({ status: 'idle' });
      })
      .catch((error) => {
        if (cancelled) return;
        logError('Failed to load message detail:', error);
        setDetailLoadState({
          status: 'error', messageId: readerSelectedId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [readerSelectedId, mailboxContextKey, detailRetryRevision]);

  const retrySelectedDetail = useCallback(() => {
    if (selectedIdRef.current == null) return;
    messageDetailCacheRef.current.delete(selectedIdRef.current);
    setDetailLoadState({ status: 'loading', messageId: selectedIdRef.current });
    setDetailRetryRevision((current) => current + 1);
  }, []);

  // Never expose another message's content while actions already target the new
  // selection. The reader renders an explicit loading/error surface instead.
  const readerSelectedDetail = selectedDetail?.id === selectedId
    && detailContextKeyRef.current === mailboxContextKey ? selectedDetail : null;
  const visibleDetailLoadState: MessageDetailLoadState = selectedId == null || readerSelectedDetail
    ? { status: 'idle' }
    : detailLoadState.status !== 'idle' && detailLoadState.messageId === selectedId
      ? detailLoadState
      : { status: 'loading', messageId: selectedId };
  const readerDisplayedId = readerSelectedDetail?.id ?? null;
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
    attachmentsLoaded,
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
    bodyFetchState,
    markBodyFetchStarted,
    markBodyFetchSucceeded,
    markBodyFetchFailed,
  } = useReaderBodyLoading({
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
    detailLoadState: visibleDetailLoadState,
    retrySelectedDetail,
    readerDisplayedId,
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
    attachmentsLoaded,
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
    bodyFetchState: bodyFetchState?.messageId === readerDisplayedId ? bodyFetchState : null,
    markBodyFetchStarted,
    markBodyFetchSucceeded,
    markBodyFetchFailed,
  };
}

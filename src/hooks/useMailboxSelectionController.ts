import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { invoke } from '../tauriBridge';
import {
  MessageDetailLRU,
  readerAttachmentLoadDelayMs,
  readerBodyFetchDelayMs,
  readerFlowLog,
  readerFlowWarn,
  readerTrustedRemoteRenderDelayMs,
  scheduleReaderBackgroundWork,
} from './readerSelectionState';
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
  const bodyFetchInFlightRef = useRef<Set<number>>(new Set());
  const bodyFetchFailedRef = useRef<Set<number>>(new Set());
  const trustedRemoteImageRenderRef = useRef<Set<number>>(new Set());
  const detailContextKeyRef = useRef(mailboxContextKey);

  selectedIdRef.current = selectedId;
  selectedDetailRef.current = selectedDetail;

  const readerSelectedId = useDeferredValue(selectedId);

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

  const selectMessageForReading = useCallback((messageId: number) => {
    clearManualUnreadSuppression([messageId]);
    setSelectedId(messageId);
    setReaderSelectionRevision((current) => current + 1);
  }, [clearManualUnreadSuppression, setSelectedId]);

  useEffect(() => {
    setAttachments([]);
    if (!selected) return undefined;

    const selectedMessageId = selected.id;
    let cancelled = false;
    const cancelScheduledWork = scheduleReaderBackgroundWork(() => {
      invoke<Attachment[]>('list_attachments', { messageId: selectedMessageId })
        .then((items) => {
          if (!cancelled) startTransition(() => setAttachments(items));
        })
        .catch((error) => {
          if (!cancelled) setStatus(String(error));
        });
    }, readerAttachmentLoadDelayMs);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!readerSelectedDetail || !selectedSenderTrusted) return undefined;
    if (readerSelectedDetail.sanitized_html.includes('src="https://')) return undefined;
    if (trustedRemoteImageRenderRef.current.has(readerSelectedDetail.id)) return undefined;

    const selectedMessageId = readerSelectedDetail.id;
    const selectedBody = readerSelectedDetail.body;
    const activeThreadKey = activeThread?.thread_key ?? null;
    let cancelled = false;
    const cancelScheduledWork = scheduleReaderBackgroundWork(() => {
      if (!htmlHasRemoteVisualContent(selectedBody)) return;
      trustedRemoteImageRenderRef.current.add(selectedMessageId);
      invoke<Message>('render_message_with_remote_image_policy', { messageId: selectedMessageId })
        .then((updated) => {
          if (cancelled) return;
          startTransition(() => {
            const { body, sanitized_html, ...summary } = updated;
            setMessages((current) => current.map((message) => (
              message.id === updated.id ? summary : message
            )));
            if (activeThreadKey) {
              setThreadMessages((current) => current.map((message) => (
                message.id === updated.id ? summary : message
              )));
            }
            if (selectedDetail?.id === updated.id) {
              setSelectedDetail(updated);
            }
            messageDetailCacheRef.current.set(updated.id, updated);
          });
        })
        .catch((error) => {
          trustedRemoteImageRenderRef.current.delete(selectedMessageId);
          if (!cancelled) setStatus(String(error));
        });
    }, readerTrustedRemoteRenderDelayMs);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [
    activeThread?.thread_key,
    readerSelectedDetail?.id,
    selectedSenderTrusted,
  ]);

  useEffect(() => {
    if (!readerSelectedDetail) return undefined;
    const isHeaderOnlyRemoteMessage =
      readerSelectedDetail.remote_uid > 0 &&
      (!readerSelectedDetail.body.trim() || isMessageBodyCorrupted(readerSelectedDetail.body)) &&
      (readerSelectedDetail.snippet.includes('远端邮件头已同步') || isMessageBodyCorrupted(readerSelectedDetail.body));
    if (!isHeaderOnlyRemoteMessage) return undefined;
    if (bodyFetchInFlightRef.current.has(readerSelectedDetail.id) || bodyFetchFailedRef.current.has(readerSelectedDetail.id)) return undefined;

    const selectedMessageId = readerSelectedDetail.id;
    const selectedAccountId = readerSelectedDetail.account_id;
    const selectedRemoteMailbox = readerSelectedDetail.remote_mailbox;
    const selectedRemoteUid = readerSelectedDetail.remote_uid;
    const activeThreadKey = activeThread?.thread_key ?? null;
    let cancelled = false;

    const cancelScheduledWork = scheduleReaderBackgroundWork(() => {
      bodyFetchInFlightRef.current.add(selectedMessageId);
      readerFlowLog('autoFetchBody start', {
        messageId: selectedMessageId,
        accountId: selectedAccountId,
        mailbox: selectedRemoteMailbox,
        uid: selectedRemoteUid,
      });
      invoke<Message>('fetch_message_body', { messageId: selectedMessageId })
        .then((updated) => {
          bodyFetchFailedRef.current.delete(updated.id);
          if (cancelled) return [];
          startTransition(() => {
            const { body, sanitized_html, ...summary } = updated;
            setMessages((current) => current.map((message) => (message.id === updated.id ? summary : message)));
            if (activeThreadKey) {
              setThreadMessages((current) => current.map((message) => (message.id === updated.id ? summary : message)));
            }
            if (selectedDetail && selectedDetail.id === updated.id) {
              setSelectedDetail(updated);
            }
            messageDetailCacheRef.current.set(updated.id, updated);
          });
          return invoke<Attachment[]>('list_attachments', { messageId: updated.id }).then((items) => {
            if (!cancelled) startTransition(() => setAttachments(items));
            readerFlowLog('autoFetchBody done', {
              messageId: updated.id,
              bodyLength: updated.body.length,
              htmlLength: updated.sanitized_html.length,
              attachments: items.length,
            });
            return items;
          });
        })
        .catch((error) => {
          bodyFetchFailedRef.current.add(selectedMessageId);
          const message = String(error).replace(/^Error:\s*/i, '');
          readerFlowWarn('autoFetchBody failed', {
            messageId: selectedMessageId,
            accountId: selectedAccountId,
            mailbox: selectedRemoteMailbox,
            uid: selectedRemoteUid,
            error: message,
          });
          if (!cancelled) setStatus(`正文拉取失败：${message}`);
        })
        .finally(() => {
          bodyFetchInFlightRef.current.delete(selectedMessageId);
        });
    }, readerBodyFetchDelayMs);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [readerSelectedDetail?.id, readerSelectedDetail?.remote_uid, activeThread?.thread_key]);

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

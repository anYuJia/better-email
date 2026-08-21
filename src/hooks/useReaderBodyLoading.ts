import { startTransition, useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { htmlHasRemoteVisualContent, isMessageBodyCorrupted } from '../mailUtils';
import type {
  Attachment,
  Message,
  MessageSummary,
  ThreadSummary,
} from '../app/types';
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
import { IPC } from '../ipc/commands';

type ReaderBodyLoadingOptions = {
  readerSelectedDetail: Message | null;
  selectedDetail: Message | null;
  selectedSenderTrusted: boolean;
  activeThread: ThreadSummary | null;
  messageDetailCacheRef: MutableRefObject<MessageDetailLRU>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setSelectedDetail: Dispatch<SetStateAction<Message | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
};

export type ReaderBodyFetchState = {
  messageId: number;
  status: 'loading' | 'error';
  error: string | null;
};

export default function useReaderBodyLoading({
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
}: ReaderBodyLoadingOptions) {
  const bodyFetchInFlightRef = useRef<Set<number>>(new Set());
  const bodyFetchFailedRef = useRef<Set<number>>(new Set());
  const [bodyFetchState, setBodyFetchState] = useState<ReaderBodyFetchState | null>(null);
  const trustedRemoteImageRenderRef = useRef<Set<number>>(new Set());
  /** 附件列表当前属于哪封邮件；解析结果只在与当前选中一致时才生效 */
  const attachmentsOwnerRef = useRef<number | null>(null);
  /** 附件列表是否已加载完成（或加载失败）——内嵌图片解析、快速回复框都要等它 */
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false);

  const markBodyFetchStarted = useCallback((messageId: number) => {
    setBodyFetchState({ messageId, status: 'loading', error: null });
  }, []);

  const markBodyFetchSucceeded = useCallback((messageId: number) => {
    setBodyFetchState((current) => current?.messageId === messageId ? null : current);
  }, []);

  const markBodyFetchFailed = useCallback((messageId: number, error: string) => {
    setBodyFetchState({ messageId, status: 'error', error });
  }, []);

  useEffect(() => {
    setAttachments([]);
    setAttachmentsLoaded(false);
    if (!readerSelectedDetail) {
      attachmentsOwnerRef.current = null;
      return undefined;
    }

    const selectedMessageId = readerSelectedDetail.id;
    attachmentsOwnerRef.current = selectedMessageId;
    let cancelled = false;
    const cancelScheduledWork = scheduleReaderBackgroundWork(() => {
      invoke<Attachment[]>(IPC.ListAttachments, { messageId: selectedMessageId })
        .then((items) => {
          if (cancelled) return;
          startTransition(() => setAttachments(items));
          if (attachmentsOwnerRef.current === selectedMessageId) {
            setAttachmentsLoaded(true);
          }
        })
        .catch((error) => {
          if (cancelled) return;
          setStatus(String(error));
          if (attachmentsOwnerRef.current === selectedMessageId) {
            setAttachmentsLoaded(true);
          }
        });
    }, readerAttachmentLoadDelayMs);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [readerSelectedDetail?.id, setAttachments, setStatus]);

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
      invoke<Message>(IPC.RenderMessageWithRemoteImagePolicy, { messageId: selectedMessageId })
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
    messageDetailCacheRef,
    readerSelectedDetail?.id,
    selectedDetail?.id,
    selectedSenderTrusted,
    setMessages,
    setSelectedDetail,
    setStatus,
    setThreadMessages,
  ]);

  useEffect(() => {
    if (!readerSelectedDetail) return undefined;
    const hasCachedBody = Boolean(
      readerSelectedDetail.body.trim() ||
        readerSelectedDetail.sanitized_html.trim(),
    );
    const isHeaderOnlyRemoteMessage =
      readerSelectedDetail.remote_uid > 0 &&
      (!hasCachedBody || isMessageBodyCorrupted(readerSelectedDetail.body));
    if (!isHeaderOnlyRemoteMessage) return undefined;
    if (bodyFetchInFlightRef.current.has(readerSelectedDetail.id) || bodyFetchFailedRef.current.has(readerSelectedDetail.id)) return undefined;

    const selectedMessageId = readerSelectedDetail.id;
    const selectedAccountId = readerSelectedDetail.account_id;
    const selectedRemoteMailbox = readerSelectedDetail.remote_mailbox;
    const selectedRemoteUid = readerSelectedDetail.remote_uid;
    const activeThreadKey = activeThread?.thread_key ?? null;
    let cancelled = false;
    markBodyFetchStarted(selectedMessageId);

    const cancelScheduledWork = scheduleReaderBackgroundWork(() => {
      bodyFetchInFlightRef.current.add(selectedMessageId);
      readerFlowLog('autoFetchBody start', {
        messageId: selectedMessageId,
        accountId: selectedAccountId,
        mailbox: selectedRemoteMailbox,
        uid: selectedRemoteUid,
      });
      invoke<Message>(IPC.FetchMessageBody, { messageId: selectedMessageId })
        .then((updated) => {
          bodyFetchFailedRef.current.delete(updated.id);
          markBodyFetchSucceeded(updated.id);
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
          return invoke<Attachment[]>(IPC.ListAttachments, { messageId: updated.id }).then((items) => {
            if (!cancelled) startTransition(() => setAttachments(items));
            if (attachmentsOwnerRef.current === updated.id) {
              setAttachmentsLoaded(true);
            }
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
          markBodyFetchFailed(selectedMessageId, message);
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
  }, [
    activeThread?.thread_key,
    messageDetailCacheRef,
    markBodyFetchFailed,
    markBodyFetchStarted,
    markBodyFetchSucceeded,
    readerSelectedDetail?.id,
    readerSelectedDetail?.remote_uid,
    selectedDetail?.id,
    setAttachments,
    setMessages,
    setSelectedDetail,
    setStatus,
    setThreadMessages,
  ]);

  return {
    attachmentsLoaded,
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
    bodyFetchState,
    markBodyFetchStarted,
    markBodyFetchSucceeded,
    markBodyFetchFailed,
  };
}

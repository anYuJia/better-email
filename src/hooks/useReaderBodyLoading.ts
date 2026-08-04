import { startTransition, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
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

type ReaderBodyLoadingOptions = {
  selected: MessageSummary | null;
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

export default function useReaderBodyLoading({
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
}: ReaderBodyLoadingOptions) {
  const bodyFetchInFlightRef = useRef<Set<number>>(new Set());
  const bodyFetchFailedRef = useRef<Set<number>>(new Set());
  const trustedRemoteImageRenderRef = useRef<Set<number>>(new Set());

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
  }, [selected?.id, setAttachments, setStatus]);

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
  }, [
    activeThread?.thread_key,
    messageDetailCacheRef,
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
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
  };
}

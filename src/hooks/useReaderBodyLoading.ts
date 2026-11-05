import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
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
import { CREDENTIALS_CHANGED_EVENT } from '../app/credentialEvents';
import { listen } from '../tauriBridge';
import { needsRemoteMessageBody, readerBodyErrorKind, readableBodyError } from './readerBodyState';

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
  errorKind?: 'credentials' | 'network' | 'invalid-content';
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
  const bodyFetchRequestsRef = useRef(new Map<number, Promise<Message>>());
  const bodyFetchErrorsRef = useRef(new Map<number, string>());
  // Empty bodies are valid successful results. Remember recent completions so
  // revisiting one does not show a new skeleton or fetch it on every selection.
  const bodyFetchCompletedRef = useRef(new Set<number>());
  // A user-requested refresh must survive an authentication repair even when
  // the cached body is already complete (including a legitimate empty body).
  const explicitBodyRefreshRef = useRef(new Set<number>());
  const currentMessageRef = useRef(readerSelectedDetail);
  currentMessageRef.current = readerSelectedDetail;
  const [bodyFetchState, setBodyFetchState] = useState<ReaderBodyFetchState | null>(null);
  const [credentialRevision, setCredentialRevision] = useState(0);
  const trustedRemoteImageRenderRef = useRef(new Map<number, Promise<Message>>());
  /** 附件列表当前属于哪封邮件；解析结果只在与当前选中一致时才生效 */
  const attachmentsOwnerRef = useRef<number | null>(null);
  /** 附件列表是否已加载完成（或加载失败）——内嵌图片解析、快速回复框都要等它 */
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false);

  const markBodyFetchStarted = useCallback((messageId: number, reason?: 'manual') => {
    if (reason === 'manual') explicitBodyRefreshRef.current.add(messageId);
    bodyFetchCompletedRef.current.delete(messageId);
    bodyFetchErrorsRef.current.delete(messageId);
    if (currentMessageRef.current?.id === messageId) setBodyFetchState({ messageId, status: 'loading', error: null });
  }, []);

  const markBodyFetchSucceeded = useCallback((messageId: number) => {
    explicitBodyRefreshRef.current.delete(messageId);
    bodyFetchCompletedRef.current.delete(messageId);
    bodyFetchCompletedRef.current.add(messageId);
    if (bodyFetchCompletedRef.current.size > 100) {
      bodyFetchCompletedRef.current.delete(bodyFetchCompletedRef.current.values().next().value!);
    }
    bodyFetchFailedRef.current.delete(messageId);
    bodyFetchErrorsRef.current.delete(messageId);
    setBodyFetchState((current) => current?.messageId === messageId ? null : current);
  }, []);

  const markBodyFetchFailed = useCallback((messageId: number, error: string) => {
    bodyFetchCompletedRef.current.delete(messageId);
    bodyFetchErrorsRef.current.set(messageId, error);
    if (currentMessageRef.current?.id === messageId) setBodyFetchState({ messageId, status: 'error', error, errorKind: readerBodyErrorKind(error) });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const changed = () => {
      const id = currentMessageRef.current?.id;
      if (!id || readerBodyErrorKind(bodyFetchErrorsRef.current.get(id) ?? '') !== 'credentials') return;
      bodyFetchErrorsRef.current.delete(id);
      bodyFetchFailedRef.current.delete(id);
      setBodyFetchState(null);
      setCredentialRevision((revision) => revision + 1);
    };
    window.addEventListener(CREDENTIALS_CHANGED_EVENT, changed);
    void Promise.resolve().then(() => listen(CREDENTIALS_CHANGED_EVENT, changed))
      .then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; }).catch(() => undefined);
    return () => { disposed = true; unlisten?.(); window.removeEventListener(CREDENTIALS_CHANGED_EVENT, changed); };
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

    const selectedMessageId = readerSelectedDetail.id;
    const selectedBody = readerSelectedDetail.body;
    const activeThreadKey = activeThread?.thread_key ?? null;
    let cancelled = false;
    const renderTrustedContent = () => {
      if (!htmlHasRemoteVisualContent(selectedBody)) return;
      let request = trustedRemoteImageRenderRef.current.get(selectedMessageId);
      if (!request) {
        request = invoke<Message>(IPC.RenderMessageWithRemoteImagePolicy, { messageId: selectedMessageId })
          .finally(() => trustedRemoteImageRenderRef.current.delete(selectedMessageId));
        trustedRemoteImageRenderRef.current.set(selectedMessageId, request);
      }
      request
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
            setSelectedDetail((current) => current?.id === updated.id && current.account_id === updated.account_id ? updated : current);
            // Only a still-trusted, active subscription may cache remote HTML.
            // A cancelled request can be retried instead of being marked done.
            messageDetailCacheRef.current.set(updated.id, updated);
          });
        })
        .catch((error) => {
          if (!cancelled) setStatus(String(error));
        });
    };
    let cancelScheduledWork: () => void = () => undefined;
    if (trustedRemoteImageRenderRef.current.has(selectedMessageId)) renderTrustedContent();
    else cancelScheduledWork = scheduleReaderBackgroundWork(renderTrustedContent, readerTrustedRemoteRenderDelayMs);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [
    activeThread?.thread_key,
    messageDetailCacheRef,
    readerSelectedDetail?.id,
    readerSelectedDetail?.body,
    selectedDetail?.id,
    selectedSenderTrusted,
    setMessages,
    setSelectedDetail,
    setStatus,
    setThreadMessages,
  ]);

  useEffect(() => {
    if (!readerSelectedDetail) return undefined;
    const explicitRefresh = explicitBodyRefreshRef.current.has(readerSelectedDetail.id);
    if ((!needsRemoteMessageBody(readerSelectedDetail) && !explicitRefresh) || bodyFetchCompletedRef.current.has(readerSelectedDetail.id)) return undefined;
    if (bodyFetchFailedRef.current.has(readerSelectedDetail.id)) {
      markBodyFetchFailed(readerSelectedDetail.id, bodyFetchErrorsRef.current.get(readerSelectedDetail.id) ?? '正文加载失败，请重试');
      return undefined;
    }
    // A return to this message subscribes to its existing automatic request.
    // Manual requests retain their own completion handler.
    if (bodyFetchInFlightRef.current.has(readerSelectedDetail.id) && !bodyFetchRequestsRef.current.has(readerSelectedDetail.id)) return undefined;

    const selectedMessageId = readerSelectedDetail.id;
    const selectedAccountId = readerSelectedDetail.account_id;
    const selectedRemoteMailbox = readerSelectedDetail.remote_mailbox;
    const selectedRemoteUid = readerSelectedDetail.remote_uid;
    const activeThreadKey = activeThread?.thread_key ?? null;
    let cancelled = false;
    markBodyFetchStarted(selectedMessageId);

    const fetchBody = () => {
      let request = bodyFetchRequestsRef.current.get(selectedMessageId);
      if (!request) {
        bodyFetchInFlightRef.current.add(selectedMessageId);
        readerFlowLog('autoFetchBody start', {
          messageId: selectedMessageId, accountId: selectedAccountId,
          mailbox: selectedRemoteMailbox, uid: selectedRemoteUid,
        });
        request = invoke<Message>(IPC.FetchMessageBody, { messageId: selectedMessageId })
          .then((updated) => {
            bodyFetchFailedRef.current.delete(updated.id);
            messageDetailCacheRef.current.set(updated.id, updated);
            // An active subscriber clears loading together with its body update
            // below. Clearing it here could expose the old empty header before
            // React commits a fetched large body that still needs approval.
            if (currentMessageRef.current?.id !== updated.id) markBodyFetchSucceeded(updated.id);
            return updated;
          }, (error) => {
            bodyFetchFailedRef.current.add(selectedMessageId);
            bodyFetchErrorsRef.current.set(selectedMessageId, String(error).replace(/^Error:\s*/i, ''));
            throw error;
          })
          .finally(() => {
            bodyFetchInFlightRef.current.delete(selectedMessageId);
            bodyFetchRequestsRef.current.delete(selectedMessageId);
          });
        bodyFetchRequestsRef.current.set(selectedMessageId, request);
      }
      request
        .then((updated) => {
          if (cancelled) return [];
          startTransition(() => {
            const { body, sanitized_html, ...summary } = updated;
            setMessages((current) => current.map((message) => (message.id === updated.id ? summary : message)));
            if (activeThreadKey) {
              setThreadMessages((current) => current.map((message) => (message.id === updated.id ? summary : message)));
            }
            setSelectedDetail((current) => current?.id === updated.id && current.account_id === updated.account_id ? updated : current);
            markBodyFetchSucceeded(updated.id);
          });
          return invoke<Attachment[]>(IPC.ListAttachments, { messageId: updated.id }).then((items) => {
            if (!cancelled) startTransition(() => setAttachments(items));
            if (!cancelled && attachmentsOwnerRef.current === updated.id) {
              setAttachmentsLoaded(true);
            }
            readerFlowLog('autoFetchBody done', {
              messageId: updated.id,
              bodyLength: updated.body.length,
              htmlLength: updated.sanitized_html.length,
              attachments: items.length,
            });
            return items;
          }, (error) => {
            if (!cancelled) {
              setAttachmentsLoaded(true);
              setStatus(`正文已加载，但附件列表刷新失败：${String(error).replace(/^Error:\s*/i, '')}`);
            }
            return [];
          });
        })
        .catch((error) => {
          const message = String(error).replace(/^Error:\s*/i, '');
          if (cancelled) return;
          markBodyFetchFailed(selectedMessageId, message);
          readerFlowWarn('autoFetchBody failed', {
            messageId: selectedMessageId,
            accountId: selectedAccountId,
            mailbox: selectedRemoteMailbox,
            uid: selectedRemoteUid,
            error: message,
          });
          setStatus(`正文拉取失败：${message}`);
        });
    };
    let cancelScheduledWork: () => void = () => undefined;
    if (bodyFetchRequestsRef.current.has(selectedMessageId)) fetchBody();
    else cancelScheduledWork = scheduleReaderBackgroundWork(fetchBody, readerBodyFetchDelayMs);

    return () => {
      cancelled = true;
      cancelScheduledWork();
    };
  }, [
    activeThread?.thread_key,
    credentialRevision,
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

  // Effects run after child layout/effects. Expose initial header-only loading
  // during render too, so a short/empty reader cannot complete reading first.
  const needsRemoteBody = useMemo(() => Boolean(readerSelectedDetail && needsRemoteMessageBody(readerSelectedDetail)),
    [readerSelectedDetail?.remote_uid, readerSelectedDetail?.remote_body_fetched, readerSelectedDetail?.body, readerSelectedDetail?.sanitized_html]);
  const currentMessageId = readerSelectedDetail?.id;
  let currentBodyFetchState = bodyFetchState?.messageId === currentMessageId ? bodyFetchState : null;
  if (!currentBodyFetchState && currentMessageId && (needsRemoteBody || explicitBodyRefreshRef.current.has(currentMessageId)) && !bodyFetchCompletedRef.current.has(currentMessageId)) {
    const error = bodyFetchErrorsRef.current.get(currentMessageId);
    currentBodyFetchState = error
      ? { messageId: currentMessageId, status: 'error', error: readableBodyError(error), errorKind: readerBodyErrorKind(error) }
      : { messageId: currentMessageId, status: 'loading', error: null };
  }
  if (!currentBodyFetchState && currentMessageId && readerSelectedDetail && isMessageBodyCorrupted(readerSelectedDetail.body)) {
    currentBodyFetchState = { messageId: currentMessageId, status: 'error', errorKind: 'invalid-content', error: '已保存的正文格式无法解析。邮件和附件仍保留在本机。' };
  }

  return {
    // Selection can synchronously reveal a cached body before the attachment
    // effect runs. Never expose the previous message's completion flag.
    attachmentsLoaded: attachmentsLoaded && attachmentsOwnerRef.current === currentMessageId,
    bodyFetchFailedRef,
    bodyFetchInFlightRef,
    bodyFetchState: currentBodyFetchState,
    markBodyFetchStarted,
    markBodyFetchSucceeded,
    markBodyFetchFailed,
  };
}

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '../app/types';
import { bodyLooksLikeHtml, isMessageBodyCorrupted } from '../mailUtils';

type IdleScheduler = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const readerBodyRenderDelayMs = 16;
const readerBodyRenderIdleTimeoutMs = 100;

type ReaderCompletionOptions = {
  selected: Message | null;
  selectedId: number | null;
  readTriggerKey: number;
  completionTriggerKey?: string;
  onReadComplete: (message: Message) => void;
};

export default function useReaderCompletion({
  selected,
  selectedId,
  readTriggerKey,
  onReadComplete,
}: ReaderCompletionOptions) {
  const [bodyRenderMessageId, setBodyRenderMessageId] = useState<number | null>(null);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const readerRef = useRef<HTMLElement | null>(null);
  const completedReadMessageIdsRef = useRef<Set<number>>(new Set());
  const prevIdRef = useRef<number | null>(null);

  useEffect(() => {
    const currentId = selected?.id ?? null;
    const isDifferentMessage = currentId !== prevIdRef.current;
    prevIdRef.current = currentId;

    if (bodyRenderMessageId === selectedId) {
      setShowPlaceholder(false);
    }

    if (!selectedId || !selected) return undefined;

    const isPlainText = !selected.sanitized_html?.trim() &&
                        !bodyLooksLikeHtml(selected.body) &&
                        selected.attachment_count === 0;
    const hasCachedBody = Boolean(selected.sanitized_html?.trim() || selected.body.trim());

    // 正文已在详情中（本地消息或已拉取过）：立即提交渲染，切换时不留骨架帧
    if (isPlainText || hasCachedBody) {
      setBodyRenderMessageId(selectedId);
      return undefined;
    }

    const scheduler = window as IdleScheduler;
    let idleHandle: number | null = null;
    let cancelled = false;

    if (bodyRenderMessageId !== selectedId) {
      if (isDifferentMessage) {
        setShowPlaceholder(true);
      }
      const timer = window.setTimeout(() => {
        const renderBody = () => {
          if (!cancelled) startTransition(() => setBodyRenderMessageId(selectedId));
        };
        if (scheduler.requestIdleCallback) {
          idleHandle = scheduler.requestIdleCallback(renderBody, { timeout: readerBodyRenderIdleTimeoutMs });
        } else {
          renderBody();
        }
      }, readerBodyRenderDelayMs);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        if (idleHandle !== null) scheduler.cancelIdleCallback?.(idleHandle);
      };
    }
  }, [selectedId, selected?.id, selected?.attachment_count, bodyRenderMessageId]);

  const isSelectedBodyCorrupted = Boolean(selected && isMessageBodyCorrupted(selected.body));
  const bodySelected = bodyRenderMessageId === selected?.id ? selected : null;
  const isBodyRenderReady = bodyRenderMessageId === selected?.id && Boolean(bodySelected) && !isSelectedBodyCorrupted;

  useEffect(() => {
    if (!selected?.id) return;
    if (selected.is_read) {
      completedReadMessageIdsRef.current.add(selected.id);
    } else {
      completedReadMessageIdsRef.current.delete(selected.id);
    }
  }, [selected?.id, selected?.is_read, readTriggerKey]);

  const maybeCompleteReading = useCallback(() => {
    if (!selected || selected.is_read || !isBodyRenderReady) return;
    if (completedReadMessageIdsRef.current.has(selected.id)) return;
    const readerElement = readerRef.current;
    if (!readerElement) return;
    const distanceToBottom = readerElement.scrollHeight - readerElement.scrollTop - readerElement.clientHeight;
    if (distanceToBottom > 48) return;
    completedReadMessageIdsRef.current.add(selected.id);
    onReadComplete(selected);
  }, [selected, isBodyRenderReady, onReadComplete]);

  useEffect(() => {
    if (!selected || selected.is_read || !isBodyRenderReady) return undefined;
    if (completedReadMessageIdsRef.current.has(selected.id)) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      if (completedReadMessageIdsRef.current.has(selected.id)) {
        return;
      }
      completedReadMessageIdsRef.current.add(selected.id);
      onReadComplete(selected);
    }, 2000);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [selected?.id, selected?.is_read, isBodyRenderReady, onReadComplete, readTriggerKey]);

  return {
    readerRef,
    bodySelected,
    isBodyRenderReady,
    showPlaceholder,
    maybeCompleteReading,
  };
}

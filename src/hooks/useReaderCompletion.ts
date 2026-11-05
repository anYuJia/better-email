import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Message } from '../app/types';
import { isMessageBodyCorrupted } from '../mailUtils';

type ReaderCompletionOptions = {
  selected: Message | null;
  selectedId: number | null;
  readTriggerKey: number;
  completionTriggerKey?: string;
  onReadComplete: (message: Message) => void;
  canRenderBody?: boolean;
  canCompleteReading?: boolean;
};

export default function useReaderCompletion({
  selected,
  selectedId,
  readTriggerKey,
  onReadComplete,
  canRenderBody = true,
  canCompleteReading = true,
}: ReaderCompletionOptions) {
  const readerRef = useRef<HTMLElement | null>(null);
  const completedReadMessageIdsRef = useRef<Set<number>>(new Set());

  const isSelectedBodyCorrupted = useMemo(
    () => canRenderBody && Boolean(selected && isMessageBodyCorrupted(selected.body)),
    [canRenderBody, selected?.body],
  );
  const bodySelected = selected?.id === selectedId ? selected : null;
  const isBodyRenderReady = canRenderBody && Boolean(bodySelected) && !isSelectedBodyCorrupted;

  useEffect(() => {
    if (!selected?.id) return;
    if (selected.is_read) {
      completedReadMessageIdsRef.current.add(selected.id);
    } else {
      completedReadMessageIdsRef.current.delete(selected.id);
    }
  }, [selected?.id, selected?.is_read, readTriggerKey]);

  const maybeCompleteReading = useCallback(() => {
    if (!selected || selected.id !== selectedId || selected.is_read || !isBodyRenderReady || !canCompleteReading) return;
    if (completedReadMessageIdsRef.current.has(selected.id)) return;
    const readerElement = readerRef.current;
    if (!readerElement) return;
    const distanceToBottom = readerElement.scrollHeight - readerElement.scrollTop - readerElement.clientHeight;
    if (distanceToBottom > 48) return;
    completedReadMessageIdsRef.current.add(selected.id);
    onReadComplete(selected);
  }, [selected, selectedId, isBodyRenderReady, canCompleteReading, onReadComplete]);

  useEffect(() => {
    if (!selected || selected.id !== selectedId || selected.is_read || !isBodyRenderReady || !canCompleteReading) return undefined;
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
  }, [selected?.id, selected?.is_read, selectedId, isBodyRenderReady, canCompleteReading, onReadComplete, readTriggerKey]);

  return {
    readerRef,
    bodySelected,
    isBodyRenderReady,
    showPlaceholder: !bodySelected,
    maybeCompleteReading,
  };
}

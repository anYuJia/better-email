import { useLayoutEffect, useRef, type RefObject } from 'react';

const MAX_REMEMBERED_MESSAGES = 80;
const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

/** Positions live in the mail workspace, so mobile reader unmounts do not lose
 * the user's place. Only small numeric offsets are retained, never mail bodies. */
export default function useReaderScrollPosition(
  readerRef: RefObject<HTMLElement>,
  messageKey: string | null,
  contentReady: boolean,
  sharedPositions?: Map<string, number>,
) {
  const localPositions = useRef(new Map<string, number>());
  const positions = sharedPositions ?? localPositions.current;
  const previousKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    const panel = readerRef.current;
    if (previousKey.current !== messageKey) {
      previousKey.current = messageKey;
      if (panel) panel.scrollTop = 0;
    }
    if (!panel || !messageKey || !contentReady) return undefined;

    // A body reload can temporarily shrink the same message. The saved
    // target stays intact until it is reached or the user takes control.
    let pendingOffset: number | null = positions.get(messageKey) ?? 0;
    let resizeObserver: ResizeObserver | undefined;
    const remember = () => {
      if (pendingOffset !== null) return;
      positions.delete(messageKey);
      positions.set(messageKey, Math.max(0, panel.scrollTop));
      while (positions.size > MAX_REMEMBERED_MESSAGES) positions.delete(positions.keys().next().value!);
    };
    const restore = () => {
      if (pendingOffset === null) return;
      panel.scrollTop = pendingOffset;
      if (Math.abs(panel.scrollTop - pendingOffset) <= 1) {
        pendingOffset = null;
        resizeObserver?.disconnect();
        remember();
      }
    };
    const takeControl = (event: Event) => {
      if (event instanceof KeyboardEvent && !scrollKeys.has(event.key)) return;
      pendingOffset = null;
      resizeObserver?.disconnect();
      remember();
    };
    restore();
    // Inline images can finish after the text. Restore the saved offset once
    // enough content exists, but never fight a user's scroll or key gesture.
    if (pendingOffset !== null && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(restore);
      resizeObserver.observe(panel);
      const article = panel.querySelector('.reader');
      if (article) resizeObserver.observe(article);
    }
    panel.addEventListener('scroll', remember, { passive: true });
    panel.addEventListener('wheel', takeControl, { passive: true });
    panel.addEventListener('touchstart', takeControl, { passive: true });
    panel.addEventListener('pointerdown', takeControl, { passive: true });
    panel.addEventListener('keydown', takeControl);
    return () => {
      resizeObserver?.disconnect();
      panel.removeEventListener('scroll', remember);
      panel.removeEventListener('wheel', takeControl);
      panel.removeEventListener('touchstart', takeControl);
      panel.removeEventListener('pointerdown', takeControl);
      panel.removeEventListener('keydown', takeControl);
    };
  }, [contentReady, messageKey, positions, readerRef]);
}

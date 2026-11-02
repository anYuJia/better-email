import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Reveal a newly selected, ready message once. Updates to flags, images and
 * reply text keep the same DOM and never replay the transition. */
export default function useReaderReveal(
  readerRef: RefObject<HTMLElement>,
  messageKey: string | null,
  ready: boolean,
) {
  const revealedKey = useRef<string | null>(null);
  const lastReadyAt = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!messageKey) {
      revealedKey.current = null;
    }
    if (!ready || !messageKey || revealedKey.current === messageKey) return undefined;
    const panel = readerRef.current;
    if (!panel) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    // Mobile already moves the whole reader surface; don't stack another
    // content transition onto that navigation or move the user's toolbar.
    if (reduced?.matches || window.matchMedia?.('(max-width: 720px)').matches) {
      revealedKey.current = messageKey;
      return undefined;
    }
    const tokens = getComputedStyle(document.documentElement);
    const duration = Number.parseFloat(tokens.getPropertyValue('--ui-motion-normal')) || 180;
    const easing = tokens.getPropertyValue('--ui-ease-emphasized').trim() || 'cubic-bezier(0.16, 1, 0.3, 1)';
    // During continuous browsing, show the next text at full opacity instead
    // of darkening it again. Keep the timestamp through brief empty/loading
    // selections; that intermediate state is part of the same browsing burst.
    const continuous = lastReadyAt.current !== null && performance.now() - lastReadyAt.current < duration;
    const animations = continuous ? [] : Array.from(panel.querySelectorAll<HTMLElement>(
      '.reader-title-block, .reader > .reader-html-container, .reader > .body-text',
    )).flatMap((element) => typeof element.animate === 'function' ? [element.animate(
      [{ opacity: 0.72, translate: '0 2px' }, { opacity: 1, translate: '0 0' }],
      { duration, easing },
    )] : []);
    // Mark it only after a paint: StrictMode's setup/cleanup probe must not
    // consume the reveal before the real surface has ever been displayed.
    const frame = window.requestAnimationFrame(() => {
      revealedKey.current = messageKey;
      lastReadyAt.current = performance.now();
    });
    const cancel = () => animations.forEach((animation) => animation.cancel());
    const preferenceChanged = () => { if (reduced?.matches) cancel(); };
    reduced?.addEventListener?.('change', preferenceChanged);
    return () => {
      window.cancelAnimationFrame(frame);
      cancel();
      reduced?.removeEventListener?.('change', preferenceChanged);
    };
  }, [messageKey, ready, readerRef]);
}

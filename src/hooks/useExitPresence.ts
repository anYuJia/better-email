import { useLayoutEffect, useState } from 'react';

/** Retain only the outgoing presentation; callers apply state/actions immediately.
 * The default matches --ui-motion-normal. Reopening cancels a pending removal.
 */
export default function useExitPresence(open: boolean, exitMs = 180): boolean {
  const [retained, setRetained] = useState(open);

  useLayoutEffect(() => {
    if (open) {
      setRetained(true);
      return undefined;
    }
    if (!retained) return undefined;
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!media || media.matches || exitMs <= 0) {
      setRetained(false);
      return undefined;
    }
    const finish = () => setRetained(false);
    const timer = window.setTimeout(finish, exitMs);
    const reduceMotion = () => { if (media.matches) finish(); };
    media.addEventListener?.('change', reduceMotion);
    return () => {
      window.clearTimeout(timer);
      media.removeEventListener?.('change', reduceMotion);
    };
  }, [exitMs, open, retained]);

  return open || retained;
}

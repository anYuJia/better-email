import { useCallback, useRef } from 'react';

export default function useCompositionGuard() {
  const active = useRef(false);
  const endedAt = useRef(-Infinity);
  const isComposing = useCallback((event?: { nativeEvent: { isComposing?: boolean; keyCode?: number } }) => (
    active.current || event?.nativeEvent.isComposing === true || event?.nativeEvent.keyCode === 229
    || performance.now() - endedAt.current < 80
  ), []);
  const onCompositionStart = useCallback(() => { active.current = true; }, []);
  const onCompositionEnd = useCallback(() => { active.current = false; endedAt.current = performance.now(); }, []);
  return { isComposing, onCompositionStart, onCompositionEnd };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchEvent, RefObject } from 'react';

export default function usePullToRefresh(
  target: RefObject<HTMLDivElement>,
  enabled: boolean,
  contextKey: string,
  onRefresh: () => Promise<void>,
) {
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number; identifier: number } | null>(null);
  const distance = useRef(0);
  const refreshing = useRef(false);
  const request = useRef(0);

  const resetGesture = useCallback(() => {
    start.current = null;
    distance.current = 0;
    if (!refreshing.current) setPullDistance(0);
  }, []);

  useEffect(() => {
    request.current += 1;
    refreshing.current = false;
    setPullRefreshing(false);
    setRefreshError(null);
    resetGesture();
    return () => { request.current += 1; };
  }, [contextKey, enabled, resetGesture]);

  const runRefresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const current = ++request.current;
    setPullRefreshing(true);
    setRefreshError(null);
    setPullDistance(44);
    try {
      await onRefresh();
    } catch (error) {
      if (current === request.current) setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      if (current === request.current) {
        refreshing.current = false;
        setPullRefreshing(false);
        setPullDistance(0);
      }
    }
  }, [onRefresh]);

  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    resetGesture();
    if (!enabled || refreshing.current || event.touches.length !== 1 || !target.current || target.current.scrollTop > 0) return;
    const touch = event.touches[0];
    start.current = { x: touch.clientX, y: touch.clientY, identifier: touch.identifier };
  }, [enabled, resetGesture, target]);

  const handleTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const origin = start.current;
    if (event.touches.length !== 1 || (origin && event.touches[0].identifier !== origin.identifier)) {
      resetGesture();
      return;
    }
    if (!origin || !enabled || refreshing.current) return;
    const touch = event.touches[0];
    const dy = touch.clientY - origin.y;
    if (Math.abs(touch.clientX - origin.x) > Math.max(12, dy)) { resetGesture(); return; }
    distance.current = dy > 0 && target.current && target.current.scrollTop <= 0
      ? Math.min(80, Math.pow(dy, 0.85)) : 0;
    setPullDistance(distance.current);
  }, [enabled, resetGesture, target]);

  const handleTouchEnd = useCallback(() => {
    const shouldRefresh = start.current !== null && enabled && distance.current >= 50
      && !refreshing.current && target.current !== null && target.current.scrollTop <= 0;
    resetGesture();
    if (shouldRefresh) void runRefresh();
  }, [enabled, resetGesture, runRefresh, target]);

  return { pullDistance, pullRefreshing, refreshError, runRefresh, handleTouchStart, handleTouchMove,
    handleTouchEnd, handleTouchCancel: resetGesture };
}

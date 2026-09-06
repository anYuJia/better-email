import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent, TouchEvent } from 'react';

type TouchOrigin = { x: number; y: number; identifier: number };

export default function useLongPress(
  enabled: boolean,
  identity: string | number,
  onLongPress: (x: number, y: number) => void,
) {
  const timer = useRef<number | null>(null);
  const origin = useRef<TouchOrigin | null>(null);
  const consumed = useRef(false);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;
  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);
  useEffect(() => {
    consumed.current = false;
    return stop;
  }, [enabled, identity, stop]);

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    stop();
    consumed.current = false;
    if (!enabled || event.touches.length !== 1) return;
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[data-no-long-press]')) return;
    const touch = event.touches[0];
    const point = { x: touch.clientX, y: touch.clientY, identifier: touch.identifier };
    origin.current = point;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      consumed.current = true;
      callback.current(point.x, point.y);
    }, 480);
  }, [enabled, stop]);

  const onTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const point = origin.current;
    if (!point) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch || touch.identifier !== point.identifier
      || Math.abs(touch.clientX - point.x) > 8 || Math.abs(touch.clientY - point.y) > 8) {
      consumed.current = true;
      stop();
    }
  }, [stop]);

  const onTouchCancel = useCallback(() => {
    consumed.current = true;
    stop();
  }, [stop]);

  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (consumed.current && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    consumed.current = false;
  }, []);

  return { onTouchStart, onTouchMove, onTouchEnd: stop, onTouchCancel, onClickCapture,
    consumeContextGesture: onTouchCancel };
}

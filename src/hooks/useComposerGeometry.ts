import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent, type RefObject } from 'react';

const STORAGE_KEY = 'better-email-composer-geometry-v1';
const MARGIN = 16;
type Geometry = { x: number; y: number; width?: number; height?: number };
type Gesture = {
  mode: 'move' | 'resize'; startX: number; startY: number; origin: Geometry;
  rect: DOMRect; target: HTMLElement; pointerId: number;
};

function loadGeometry(): Geometry {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      return { x: value.x, y: value.y,
        width: Number.isFinite(value.width) && value.width > 0 ? value.width : undefined,
        height: Number.isFinite(value.height) && value.height > 0 ? value.height : undefined };
    }
  } catch { /* Storage can be unavailable in private profiles. */ }
  return { x: 0, y: 0 };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

/** Pointer movement only paints once per frame. React and storage receive the
 * final geometry, keeping rich text and contact suggestions off the drag path. */
export default function useComposerGeometry(ref: RefObject<HTMLElement>, enabled: boolean, active: boolean) {
  const [geometry, setGeometry] = useState<Geometry>(loadGeometry);
  const current = useRef(geometry);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);

  const paint = useCallback((value: Geometry) => {
    const panel = ref.current;
    if (!panel) return;
    panel.style.transform = `translate(${value.x}px, ${value.y}px)`;
    if (value.width) panel.style.width = `${value.width}px`;
    if (value.height) panel.style.height = `${value.height}px`;
  }, [ref]);

  const commit = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const previous = gesture.current;
    gesture.current = null;
    if (previous?.target.hasPointerCapture?.(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId);
    ref.current?.removeAttribute('data-geometry-active');
    paint(current.current);
    setGeometry({ ...current.current });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current.current)); } catch { /* Best effort. */ }
  }, [paint, ref]);

  useLayoutEffect(() => {
    if (!enabled) {
      if (gesture.current) commit();
      for (const property of ['transform', 'width', 'height']) ref.current?.style.removeProperty(property);
      return;
    }
    if (!active) {
      if (gesture.current) commit();
      return;
    }
    const fit = () => {
      if (gesture.current) commit();
      const panel = ref.current;
      if (!panel) return;
      const value = { ...current.current };
      if (value.width) value.width = clamp(value.width, Math.min(560, innerWidth - MARGIN * 2), innerWidth - MARGIN * 2);
      if (value.height) value.height = clamp(value.height, Math.min(400, innerHeight - MARGIN * 2), innerHeight - MARGIN * 2);
      paint(value);
      const rect = panel.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Individual translate belongs to the surface animation; bounds are
      // derived from layout so an in-flight reveal cannot move the workspace.
      const left = panel.offsetLeft + value.x;
      const top = panel.offsetTop + value.y;
      value.x += clamp(left, MARGIN, innerWidth - MARGIN - panel.offsetWidth) - left;
      value.y += clamp(top, MARGIN, innerHeight - MARGIN - panel.offsetHeight) - top;
      current.current = value;
      paint(value);
      setGeometry(value);
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('blur', commit);
    return () => { window.removeEventListener('resize', fit); window.removeEventListener('blur', commit); };
  }, [active, commit, enabled, paint, ref]);

  useLayoutEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    if (gesture.current) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current.current)); } catch { /* Best effort. */ }
    }
  }, []);

  const begin = (event: PointerEvent<HTMLElement>, mode: Gesture['mode']) => {
    if (!enabled || !active || event.button !== 0) return;
    if (mode === 'move' && (event.target as HTMLElement).closest('button, input, textarea, select, label, a, [role="button"]')) return;
    const panel = ref.current;
    if (!panel) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = { mode, startX: event.clientX, startY: event.clientY, origin: { ...current.current },
      rect: panel.getBoundingClientRect(), target: event.currentTarget, pointerId: event.pointerId };
    panel.dataset.geometryActive = mode;
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current;
    if (!start || (event.pointerId !== undefined && event.pointerId !== start.pointerId)) return;
    const dx = event.clientX - start.startX;
    const dy = event.clientY - start.startY;
    const { origin, rect } = start;
    if (start.mode === 'move') {
      current.current = { ...origin,
        x: origin.x + clamp(rect.left + dx, MARGIN, innerWidth - MARGIN - rect.width) - rect.left,
        y: origin.y + clamp(rect.top + dy, MARGIN, innerHeight - MARGIN - rect.height) - rect.top };
    } else {
      const width = clamp(rect.width + dx, 560, innerWidth - MARGIN - rect.left);
      const height = clamp(rect.height + dy, 400, innerHeight - MARGIN - rect.top);
      // The floating surface is bottom/right aligned. Compensate that anchor
      // while resizing so the top-left corner remains stationary.
      current.current = { x: origin.x + width - rect.width, y: origin.y + height - rect.height, width, height };
    }
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; paint(current.current); });
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!enabled || !active || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    const panel = ref.current;
    if (!panel) return;
    if (event.key === 'Home') {
      current.current = { x: 0, y: 0 };
      panel.style.removeProperty('width'); panel.style.removeProperty('height');
    } else {
      const rect = panel.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 16;
      const width = clamp(rect.width + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), 560, innerWidth - MARGIN - rect.left);
      const height = clamp(rect.height + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), 400, innerHeight - MARGIN - rect.top);
      current.current = { x: current.current.x + width - rect.width, y: current.current.y + height - rect.height, width, height };
    }
    commit();
  };

  return {
    style: enabled ? { transform: `translate(${geometry.x}px, ${geometry.y}px)`, width: geometry.width, height: geometry.height } as CSSProperties : undefined,
    beginDrag: (event: PointerEvent<HTMLElement>) => begin(event, 'move'),
    beginResize: (event: PointerEvent<HTMLElement>) => begin(event, 'resize'),
    move, end: () => { if (gesture.current) commit(); }, resizeWithKeyboard,
  };
}

export type ScrollbarAxis = 'vertical' | 'horizontal';

export type ScrollbarDragMetrics = {
  viewportLength: number;
  contentLength: number;
  scrollOffset: number;
  thumbLength: number;
  thumbTravel: number;
};

type ScrollbarThumbDragOptions = {
  thumb: HTMLElement;
  axis: ScrollbarAxis;
  getTarget: () => HTMLElement | null;
  getMetrics: () => ScrollbarDragMetrics;
  onDragStart?: () => void;
  onDrag?: (scrollOffset: number) => void;
  onDragEnd?: () => void;
};

const coordinateFor = (event: PointerEvent, axis: ScrollbarAxis) => (
  axis === 'vertical' ? event.clientY : event.clientX
);

/**
 * Installs the pointer interaction for a scrollbar thumb. The thumb itself is
 * only a visual overlay; this helper maps its travel directly to the target's
 * scroll range and keeps all listeners scoped to the active drag.
 */
export function installScrollbarThumbDrag({
  thumb,
  axis,
  getTarget,
  getMetrics,
  onDragStart,
  onDrag,
  onDragEnd,
}: ScrollbarThumbDragOptions): () => void {
  let pointerId: number | null = null;
  let activeTarget: HTMLElement | null = null;
  let startCoordinate = 0;
  let startScrollOffset = 0;
  let scrollRange = 0;
  let thumbTravel = 0;
  let frame: number | null = null;
  let latestCoordinate = 0;
  let previousUserSelect = '';

  const applyScroll = () => {
    frame = null;
    if (!activeTarget) return;
    const delta = latestCoordinate - startCoordinate;
    const ratio = thumbTravel > 0 ? delta / thumbTravel : 0;
    const nextOffset = Math.min(
      scrollRange,
      Math.max(0, startScrollOffset + ratio * scrollRange),
    );
    if (axis === 'vertical') activeTarget.scrollTop = nextOffset;
    else activeTarget.scrollLeft = nextOffset;
    onDrag?.(nextOffset);
  };

  const stopDrag = () => {
    if (!activeTarget) return;
    if (frame !== null) {
      window.cancelAnimationFrame(frame);
      frame = null;
      applyScroll();
    }
    const target = activeTarget;
    const releasedPointerId = pointerId;
    activeTarget = null;
    pointerId = null;
    thumb.classList.remove('is-dragging');
    document.body.style.userSelect = previousUserSelect;
    document.removeEventListener('pointermove', handlePointerMove, true);
    document.removeEventListener('pointerup', handlePointerUp, true);
    document.removeEventListener('pointercancel', handlePointerCancel, true);
    document.removeEventListener('lostpointercapture', handlePointerCancel, true);
    try {
      if (releasedPointerId !== null && thumb.hasPointerCapture?.(releasedPointerId)) {
        thumb.releasePointerCapture(releasedPointerId);
      }
    } catch {
      // Pointer capture can already be released by the browser on cancellation.
    }
    onDragEnd?.();
    if (!target.isConnected) return;
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!activeTarget || (pointerId !== null && event.pointerId !== pointerId)) return;
    event.preventDefault();
    latestCoordinate = coordinateFor(event, axis);
    if (frame === null) frame = window.requestAnimationFrame(applyScroll);
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (pointerId !== null && event.pointerId !== pointerId) return;
    event.preventDefault();
    stopDrag();
  };

  const handlePointerCancel = (event: Event) => {
    if ('pointerId' in event && pointerId !== null && event.pointerId !== pointerId) return;
    stopDrag();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || activeTarget) return;
    const target = getTarget();
    const metrics = getMetrics();
    if (
      !target
      || !target.isConnected
      || metrics.thumbTravel <= 0
      || metrics.contentLength <= metrics.viewportLength
    ) return;
    event.preventDefault();
    event.stopPropagation();
    activeTarget = target;
    pointerId = event.pointerId;
    startCoordinate = coordinateFor(event, axis);
    latestCoordinate = startCoordinate;
    startScrollOffset = metrics.scrollOffset;
    scrollRange = Math.max(0, metrics.contentLength - metrics.viewportLength);
    thumbTravel = metrics.thumbTravel;
    previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    thumb.classList.add('is-dragging');
    try {
      thumb.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is optional in older embedded webviews.
    }
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerCancel, true);
    document.addEventListener('lostpointercapture', handlePointerCancel, true);
    onDragStart?.();
  };

  thumb.addEventListener('pointerdown', handlePointerDown);
  return () => {
    thumb.removeEventListener('pointerdown', handlePointerDown);
    stopDrag();
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}

type ContainableWheelEvent = {
  target: EventTarget | null;
  deltaX: number;
  deltaY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
};

function canScrollInDirection(
  element: HTMLElement,
  delta: number,
  axis: 'x' | 'y',
) {
  if (delta === 0) return false;

  if (axis === 'y') {
    if (element.scrollHeight <= element.clientHeight + 1) return false;
    if (delta < 0) return element.scrollTop > 0;
    return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  }

  if (element.scrollWidth <= element.clientWidth + 1) return false;
  if (delta < 0) return element.scrollLeft > 0;
  return element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
}

/**
 * Keep a wheel gesture inside a transient surface.
 *
 * The nearest nested scroller that can still move receives the gesture. Once
 * every scroller reaches its boundary, cancel the gesture so it cannot move
 * the message list, reader, settings page, or composer behind the surface.
 */
export function containWheelWithin(
  surface: HTMLElement,
  event: ContainableWheelEvent,
) {
  let target = event.target instanceof Element ? event.target : null;
  while (target && !(target instanceof HTMLElement)) {
    target = target.parentElement;
  }
  if (!target || !surface.contains(target)) return;

  const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
  const axis = vertical ? 'y' : 'x';
  const delta = vertical ? event.deltaY : event.deltaX;
  let candidate: HTMLElement | null = target;
  let hasScrollableTarget = false;

  while (candidate && surface.contains(candidate)) {
    if (canScrollInDirection(candidate, delta, axis)) {
      hasScrollableTarget = true;
      break;
    }
    if (candidate === surface) break;
    candidate = candidate.parentElement;
  }

  if (!hasScrollableTarget) event.preventDefault();
  event.stopPropagation();
}

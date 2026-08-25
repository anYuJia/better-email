import { useEffect, useRef } from 'react';

const SCROLLBAR_HIDE_DELAY_MS = 1200;
const SCROLLBAR_THUMB_SIZE_PX = 6;
const SCROLLBAR_THUMB_MIN_LENGTH_PX = 32;
const SCROLLABLE_OVERFLOW_VALUES = new Set(['auto', 'overlay', 'scroll']);
const SCROLLBAR_STATE_ATTRIBUTE = 'data-scrollbar-scrolling';
const SCROLLBAR_THUMB_CLASS = 'auto-scrollbar-thumb';
const SCROLLBAR_THUMB_VISIBLE_CLASS = 'auto-scrollbar-thumb--visible';

type ScrollbarOverlay = {
  vertical: HTMLDivElement;
  horizontal: HTMLDivElement;
  timer: number | null;
};

function hasScrollableOverflow(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  const hasVerticalOverflow = SCROLLABLE_OVERFLOW_VALUES.has(style.overflowY)
    && element.scrollHeight > element.clientHeight;
  const hasHorizontalOverflow = SCROLLABLE_OVERFLOW_VALUES.has(style.overflowX)
    && element.scrollWidth > element.clientWidth;
  return hasVerticalOverflow || hasHorizontalOverflow;
}

function usesLocalScrollbar(element: HTMLElement): boolean {
  return element.dataset.localScrollbar === 'true';
}

function createThumb(axis: 'vertical' | 'horizontal'): HTMLDivElement {
  const thumb = document.createElement('div');
  thumb.className = `${SCROLLBAR_THUMB_CLASS} ${SCROLLBAR_THUMB_CLASS}--${axis}`;
  thumb.setAttribute('aria-hidden', 'true');
  thumb.setAttribute('role', 'presentation');
  return thumb;
}

function createOverlay(): ScrollbarOverlay {
  const overlay: ScrollbarOverlay = {
    vertical: createThumb('vertical'),
    horizontal: createThumb('horizontal'),
    timer: null,
  };
  document.body.append(overlay.vertical, overlay.horizontal);
  return overlay;
}

function hideThumb(thumb: HTMLDivElement) {
  thumb.classList.remove(SCROLLBAR_THUMB_VISIBLE_CLASS);
}

function updateThumb(
  thumb: HTMLDivElement,
  axis: 'vertical' | 'horizontal',
  element: HTMLElement,
  rect: DOMRect,
) {
  const isVertical = axis === 'vertical';
  const viewportLength = isVertical ? element.clientHeight : element.clientWidth;
  const contentLength = isVertical ? element.scrollHeight : element.scrollWidth;
  const scrollOffset = isVertical ? element.scrollTop : element.scrollLeft;
  const scrollRange = contentLength - viewportLength;

  if (
    viewportLength <= 0
    || contentLength <= viewportLength
    || scrollRange <= 0
    || rect.width <= 0
    || rect.height <= 0
  ) {
    hideThumb(thumb);
    return;
  }

  const thumbLength = Math.min(
    viewportLength,
    Math.max(SCROLLBAR_THUMB_MIN_LENGTH_PX, Math.round((viewportLength * viewportLength) / contentLength)),
  );
  const thumbTravel = Math.max(0, viewportLength - thumbLength);
  const scrollRatio = Math.min(1, Math.max(0, scrollOffset / scrollRange));
  const offset = Math.round(thumbTravel * scrollRatio);

  if (isVertical) {
    thumb.style.top = `${Math.round(rect.top + offset)}px`;
    thumb.style.left = `${Math.round(rect.right - SCROLLBAR_THUMB_SIZE_PX - 3)}px`;
    thumb.style.width = `${SCROLLBAR_THUMB_SIZE_PX}px`;
    thumb.style.height = `${Math.round(thumbLength)}px`;
  } else {
    thumb.style.top = `${Math.round(rect.bottom - SCROLLBAR_THUMB_SIZE_PX - 3)}px`;
    thumb.style.left = `${Math.round(rect.left + offset)}px`;
    thumb.style.width = `${Math.round(thumbLength)}px`;
    thumb.style.height = `${SCROLLBAR_THUMB_SIZE_PX}px`;
  }
  thumb.classList.add(SCROLLBAR_THUMB_VISIBLE_CLASS);
}

function updateOverlay(element: HTMLElement, overlay: ScrollbarOverlay) {
  const rect = element.getBoundingClientRect();
  updateThumb(overlay.vertical, 'vertical', element, rect);
  updateThumb(overlay.horizontal, 'horizontal', element, rect);
}

function findScrollableAncestor(target: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let element = target instanceof HTMLElement ? target : null;
  while (element && element !== root) {
    if (hasScrollableOverflow(element)) return element;
    element = element.parentElement;
  }
  return null;
}

/**
 * Replaces platform scrollbar tracks with small, viewport-fixed thumb overlays.
 * The overlay never becomes a child of the scroll surface, so it cannot change
 * the list width or scroll with the content. New dialogs and portals inherit
 * the same behaviour through the document-level capture listener.
 */
export default function useAutoHideScrollbars() {
  const timersRef = useRef<Map<HTMLElement, number>>(new Map());
  const overlaysRef = useRef<Map<HTMLElement, ScrollbarOverlay>>(new Map());

  useEffect(() => {
    const appDocument = document.body;
    if (!appDocument) return undefined;

    const disposeOverlay = (element: HTMLElement) => {
      const overlay = overlaysRef.current.get(element);
      if (!overlay) return;
      if (overlay.timer !== null) window.clearTimeout(overlay.timer);
      overlay.vertical.remove();
      overlay.horizontal.remove();
      overlaysRef.current.delete(element);
      timersRef.current.delete(element);
      element.removeAttribute(SCROLLBAR_STATE_ATTRIBUTE);
    };

    const hideOverlay = (element: HTMLElement) => {
      const overlay = overlaysRef.current.get(element);
      if (!overlay) return;
      hideThumb(overlay.vertical);
      hideThumb(overlay.horizontal);
      element.removeAttribute(SCROLLBAR_STATE_ATTRIBUTE);
      timersRef.current.delete(element);
      overlay.timer = null;
    };

    const showOverlay = (target: HTMLElement) => {
      if (!appDocument.contains(target)) return;
      if (usesLocalScrollbar(target)) return;
      if (!hasScrollableOverflow(target)) return;

      let overlay = overlaysRef.current.get(target);
      if (!overlay) {
        overlay = createOverlay();
        overlaysRef.current.set(target, overlay);
      }

      target.setAttribute(SCROLLBAR_STATE_ATTRIBUTE, 'true');
      updateOverlay(target, overlay);

      if (overlay.timer !== null) window.clearTimeout(overlay.timer);
      overlay.timer = window.setTimeout(() => {
        if (!appDocument.contains(target)) {
          disposeOverlay(target);
          return;
        }
        hideOverlay(target);
      }, SCROLLBAR_HIDE_DELAY_MS);
      timersRef.current.set(target, overlay.timer);
    };

    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      showOverlay(target);
    };

    const handleWheelOrTouchMove = (event: Event) => {
      const target = findScrollableAncestor(event.target, appDocument);
      if (!target) return;
      window.requestAnimationFrame(() => showOverlay(target));
    };

    const handleResize = () => {
      for (const [element, overlay] of overlaysRef.current) {
        if (!appDocument.contains(element)) {
          disposeOverlay(element);
        } else if (element.hasAttribute(SCROLLBAR_STATE_ATTRIBUTE)) {
          updateOverlay(element, overlay);
        }
      }
    };

    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('wheel', handleWheelOrTouchMove, { capture: true, passive: true });
    document.addEventListener('touchmove', handleWheelOrTouchMove, { capture: true, passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('wheel', handleWheelOrTouchMove, true);
      document.removeEventListener('touchmove', handleWheelOrTouchMove, true);
      window.removeEventListener('resize', handleResize);
      for (const element of overlaysRef.current.keys()) disposeOverlay(element);
      timersRef.current.clear();
      overlaysRef.current.clear();
    };
  }, []);
}

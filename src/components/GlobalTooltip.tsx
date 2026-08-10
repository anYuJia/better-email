import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type TooltipState = {
  text: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
  targetLeft: number;
  targetTop: number;
  targetWidth: number;
  targetHeight: number;
  targetBottom: number;
};

const TOOLTIP_SELECTOR = [
  'button[title]',
  'summary[title]',
  '[role="button"][title]',
  'button.icon-button[aria-label]',
  'button.icon-only-action[aria-label]',
  'summary.icon-only-summary[aria-label]',
  '.settings-button[aria-label]',
].join(',');

const OPEN_OVERLAY_SELECTOR = [
  'details[open]',
  '.context-menu',
  '.context-submenu',
  '.search-suggestion-panel',
  '.custom-select-dropdown',
  '.settings-mobile-menu',
].join(',');

const TOOLTIP_BOUNDARY_SELECTOR = [
  '.settings-backdrop',
  '.settings-modal',
  '.contact-import-dialog',
  '.dialog-card',
  '.snooze-dialog',
  '[role="dialog"]',
].join(',');

const TOOLTIP_ID = 'global-tooltip';

const TOOLTIP_DELAY_MS = 60;
const TOOLTIP_GAP = 8;

export function isTextOnlyTooltipButton(element: HTMLElement) {
  const text = element.textContent?.trim() ?? '';
  return text.length > 0 && element.querySelector('svg') === null;
}

export function getTooltipText(element: HTMLElement) {
  return (
    element.getAttribute('title')
    || element.getAttribute('data-native-title')
    || element.getAttribute('aria-label')
    || ''
  ).trim();
}

export function shouldShowGlobalTooltip(target: HTMLElement) {
  // The settings sidebar carries its own persistent labels; hover hints
  // there are redundant and visually noisy.
  if (target.closest('.settings-nav')) return false;
  const text = getTooltipText(target);
  if (
    !text
    || target.hasAttribute('disabled')
    || target.getAttribute('aria-disabled') === 'true'
    || target.hasAttribute('data-no-tooltip')
    || isInsideOpenOverlay(target)
  ) {
    return false;
  }

  return !(
    target.tagName === 'BUTTON'
    && isTextOnlyTooltipButton(target)
    && !target.classList.contains('primary-action')
  );
}

function targetFromEvent(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest<HTMLElement>(TOOLTIP_SELECTOR) ?? null;
}

function isInsideOpenOverlay(element: HTMLElement) {
  return element.closest(OPEN_OVERLAY_SELECTOR) !== null;
}

/**
 * The tooltip must stay inside the nearest modal/dialog boundary, not just
 * the viewport, so a tooltip near a dialog edge is never clipped or pushed
 * behind the overlay.
 */
function getTooltipBoundary(target: HTMLElement | null) {
  const container = target?.closest<HTMLElement>(TOOLTIP_BOUNDARY_SELECTOR);
  if (container) {
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export default function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!tooltip) {
      setCoords(null);
      return;
    }
    const elem = tooltipRef.current;
    if (!elem) return;

    const width = elem.offsetWidth;
    const height = elem.offsetHeight;
    const boundary = getTooltipBoundary(activeTargetRef.current);
    const padding = 10;
    const maxLeft = boundary.right - width - padding;
    const maxTop = boundary.bottom - height - padding;
    const minLeft = boundary.left + padding;
    const minTop = boundary.top + padding;

    const fits = (left: number, top: number) =>
      left >= minLeft && left <= maxLeft && top >= minTop && top <= maxTop;

    const target = tooltip;
    const above = target.targetTop - boundary.top;
    const below = boundary.bottom - target.targetBottom;
    const right = boundary.right - (target.targetLeft + target.targetWidth);
    const leftOf = target.targetLeft - boundary.left;

    let left = target.targetLeft + target.targetWidth / 2 - width / 2;
    let top = 0;
    let placement: TooltipState['placement'] = 'top';

    const preferred: Array<[TooltipState['placement'], number, number]> = [
      ['top', target.targetLeft + target.targetWidth / 2 - width / 2, target.targetTop - height - TOOLTIP_GAP],
      ['bottom', target.targetLeft + target.targetWidth / 2 - width / 2, target.targetBottom + TOOLTIP_GAP],
      ['right', target.targetLeft + target.targetWidth + TOOLTIP_GAP, target.targetTop + target.targetHeight / 2 - height / 2],
      ['left', target.targetLeft - width - TOOLTIP_GAP, target.targetTop + target.targetHeight / 2 - height / 2],
    ];

    const spaceFor: Record<TooltipState['placement'], number> = {
      top: above,
      bottom: below,
      right,
      left: leftOf,
    };

    // Pick the placement with the most room first, then fall back through
    // the rest so the tooltip is never placed outside the dialog.
    const ordered = [...preferred].sort((a, b) => spaceFor[b[0]] - spaceFor[a[0]]);
    const chosen = ordered.find(([, l, t]) => fits(l, t)) ?? ordered[0];
    placement = chosen[0];
    left = chosen[1];
    top = chosen[2];

    left = Math.round(Math.max(minLeft, Math.min(left, maxLeft)));
    top = Math.round(Math.max(minTop, Math.min(top, maxTop)));

    setCoords({ left, top });
    if (placement !== tooltip.placement) {
      // Keep the state in sync with the chosen placement for later bounds
      // calculations. The tooltip intentionally has no decorative arrow.
      setTooltip({ ...tooltip, placement });
    }
  }, [tooltip]);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const restoreNativeTitle = (element: HTMLElement | null) => {
      if (!element) return;
      element.removeAttribute('aria-describedby');
      const nativeTitle = element.getAttribute('data-native-title');
      if (nativeTitle !== null) {
        element.setAttribute('title', nativeTitle);
        element.removeAttribute('data-native-title');
      }
    };

    const hideTooltip = () => {
      clearTimer();
      restoreNativeTitle(activeTargetRef.current);
      activeTargetRef.current = null;
      setTooltip(null);
    };

    const showTooltip = (target: HTMLElement) => {
      if (!shouldShowGlobalTooltip(target)) {
        hideTooltip();
        return;
      }
      const text = getTooltipText(target);

      clearTimer();
      restoreNativeTitle(activeTargetRef.current);
      activeTargetRef.current = target;

      const nativeTitle = target.getAttribute('title');
      if (nativeTitle) {
        target.setAttribute('data-native-title', nativeTitle);
        target.removeAttribute('title');
      }
      target.setAttribute('aria-describedby', TOOLTIP_ID);

      timerRef.current = window.setTimeout(() => {
        if (activeTargetRef.current !== target) return;
        const rect = target.getBoundingClientRect();
        setTooltip({
          text,
          placement: 'top',
          targetLeft: rect.left,
          targetTop: rect.top,
          targetWidth: rect.width,
          targetHeight: rect.height,
          targetBottom: rect.bottom,
        });
      }, TOOLTIP_DELAY_MS);
    };

    const handlePointerOver = (event: PointerEvent) => {
      const target = targetFromEvent(event);
      if (!target || target === activeTargetRef.current) return;
      showTooltip(target);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const target = activeTargetRef.current;
      if (!target) return;
      const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (relatedTarget && target.contains(relatedTarget)) return;
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = targetFromEvent(event);
      if (target) showTooltip(target);
    };

    const handleFocusOut = () => hideTooltip();
    const handleImmediateHide = () => hideTooltip();

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('pointerdown', handleImmediateHide, true);
    document.addEventListener('click', handleImmediateHide, true);
    document.addEventListener('keydown', handleImmediateHide, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('blur', hideTooltip);
    window.addEventListener('resize', hideTooltip);

    return () => {
      hideTooltip();
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('pointerdown', handleImmediateHide, true);
      document.removeEventListener('click', handleImmediateHide, true);
      document.removeEventListener('keydown', handleImmediateHide, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('scroll', hideTooltip, true);
      window.removeEventListener('blur', hideTooltip);
      window.removeEventListener('resize', hideTooltip);
    };
  }, []);

  if (!tooltip) return null;

  return (
    <div
      id={TOOLTIP_ID}
      ref={tooltipRef}
      className={`global-tooltip is-${tooltip.placement}`}
      role="tooltip"
      style={{
        left: coords ? coords.left : -9999,
        top: coords ? coords.top : -9999,
        visibility: coords ? 'visible' : 'hidden',
      }}
    >
      {tooltip.text}
    </div>
  );
}

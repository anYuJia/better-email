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
  '.context-menu-surface',
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

const TOOLTIP_DELAY_MS = 350;
const TOOLTIP_WARM_DELAY_MS = 100;
const TOOLTIP_WARM_WINDOW_MS = 1000;
const TOOLTIP_GAP = 8;
const TOOLTIP_MAX_CHARACTERS = 120;
const TOOLTIP_GROUP_SELECTOR = [
  '[data-tooltip-group]', '[role="toolbar"]', '.reader-actions',
  '.composer-header-actions', '.composer-rich-toolbar', '.composer-footer-tool-group',
  '.settings-header-actions', '.narrow-reader-navigation', '.mobile-header-actions',
].join(',');

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

export function summarizeTooltipText(text: string) {
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.length > TOOLTIP_MAX_CHARACTERS
    ? `${characters.slice(0, TOOLTIP_MAX_CHARACTERS - 1).join('')}…`
    : characters.join('');
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
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const right = left + (viewport?.width ?? window.innerWidth);
  const bottom = top + (viewport?.height ?? window.innerHeight);
  const container = target?.closest<HTMLElement>(TOOLTIP_BOUNDARY_SELECTOR);
  if (container) {
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return {
      left: Math.max(left, rect.left), top: Math.max(top, rect.top),
      right: Math.min(right, rect.right), bottom: Math.min(bottom, rect.bottom),
    };
  }
  return { left, top, right, bottom };
}

export default function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<{
    element: Element; placement: TooltipState['placement']; shown: boolean; warmUntil: number;
  } | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!tooltip) {
      setCoords(null);
      return;
    }
    const elem = tooltipRef.current;
    if (!elem) return;

    const boundary = getTooltipBoundary(activeTargetRef.current);
    const padding = 10;
    const availableHeight = Math.max(0, boundary.bottom - boundary.top - padding * 2);
    elem.style.maxWidth = `${Math.max(0, Math.min(300, boundary.right - boundary.left - padding * 2))}px`;
    elem.style.maxHeight = `${availableHeight}px`;
    const style = window.getComputedStyle(elem);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const chromeHeight = [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth]
      .reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
    if (lineHeight > 0) {
      const lines = Math.max(1, Math.min(5, Math.floor((availableHeight - chromeHeight) / lineHeight)));
      elem.style.setProperty('--tooltip-visible-lines', String(lines));
    }
    const width = elem.offsetWidth;
    const height = elem.offsetHeight;
    const maxLeft = boundary.right - width - padding;
    const maxTop = boundary.bottom - height - padding;
    const minLeft = boundary.left + padding;
    const minTop = boundary.top + padding;

    const target = tooltip;
    const candidates: Array<[TooltipState['placement'], number, number]> = [
      ['top', target.targetLeft + target.targetWidth / 2 - width / 2, target.targetTop - height - TOOLTIP_GAP],
      ['bottom', target.targetLeft + target.targetWidth / 2 - width / 2, target.targetBottom + TOOLTIP_GAP],
      ['right', target.targetLeft + target.targetWidth + TOOLTIP_GAP, target.targetTop + target.targetHeight / 2 - height / 2],
      ['left', target.targetLeft - width - TOOLTIP_GAP, target.targetTop + target.targetHeight / 2 - height / 2],
    ];

    // Keep one direction while exploring a toolbar. At an edge slide along
    // that side instead of jumping from above the button to its left/right.
    const ordered = [...candidates].sort((a, b) =>
      Number(b[0] === target.placement) - Number(a[0] === target.placement));
    const chosen = ordered.find(([side, l, t]) => side === 'top' || side === 'bottom'
      ? t >= minTop && t <= maxTop
      : l >= minLeft && l <= maxLeft) ?? ordered[0];
    const placement = chosen[0];
    const left = Math.round(Math.max(minLeft, Math.min(chosen[1], maxLeft)));
    const top = Math.round(Math.max(minTop, Math.min(chosen[2], maxTop)));
    if (groupRef.current) groupRef.current.placement = placement;

    setCoords({ left, top });
    if (placement !== tooltip.placement) {
      // Keep the state in sync with the chosen placement for later bounds
      // calculations. The tooltip intentionally has no decorative arrow.
      setTooltip({ ...tooltip, placement });
    }
  }, [tooltip]);

  useEffect(() => {
    let pointerFocus = false;
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const restoreNativeTitle = (element: HTMLElement | null) => {
      if (!element) return;
      const descriptions = (element.getAttribute('aria-describedby') ?? '')
        .split(/\s+/).filter((id) => id && id !== TOOLTIP_ID);
      if (descriptions.length) element.setAttribute('aria-describedby', descriptions.join(' '));
      else element.removeAttribute('aria-describedby');
      const nativeTitle = element.getAttribute('data-native-title');
      if (nativeTitle !== null) {
        if (!element.hasAttribute('title')) element.setAttribute('title', nativeTitle);
        element.removeAttribute('data-native-title');
      }
    };

    const hideTooltip = () => {
      clearTimer();
      if (groupRef.current?.shown) {
        groupRef.current.warmUntil = Date.now() + TOOLTIP_WARM_WINDOW_MS;
        groupRef.current.shown = false;
      }
      restoreNativeTitle(activeTargetRef.current);
      activeTargetRef.current = null;
      setTooltip(null);
    };

    const showTooltip = (target: HTMLElement) => {
      if (!shouldShowGlobalTooltip(target)) {
        hideTooltip();
        return;
      }
      const text = summarizeTooltipText(getTooltipText(target));
      const group = target.closest(TOOLTIP_GROUP_SELECTOR) ?? target.parentElement ?? target;
      const previous = groupRef.current;
      const warm = previous?.element === group && (previous.shown || previous.warmUntil > Date.now());
      groupRef.current = warm ? previous : { element: group, placement: 'top', shown: false, warmUntil: 0 };

      clearTimer();
      restoreNativeTitle(activeTargetRef.current);
      activeTargetRef.current = target;
      setTooltip(null);

      const nativeTitle = target.getAttribute('title');
      if (nativeTitle) {
        target.setAttribute('data-native-title', nativeTitle);
        target.removeAttribute('title');
      }
      const descriptions = (target.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      target.setAttribute('aria-describedby', [...new Set([...descriptions, TOOLTIP_ID])].join(' '));

      timerRef.current = window.setTimeout(() => {
        if (activeTargetRef.current !== target) return;
        if (!target.isConnected || target.closest('[hidden], [inert], [aria-hidden="true"]')
          || !shouldShowGlobalTooltip(target)) {
          hideTooltip();
          return;
        }
        const rect = target.getBoundingClientRect();
        if (groupRef.current) groupRef.current.shown = true;
        setTooltip({
          text,
          placement: groupRef.current?.placement ?? 'top',
          targetLeft: rect.left,
          targetTop: rect.top,
          targetWidth: rect.width,
          targetHeight: rect.height,
          targetBottom: rect.bottom,
        });
      }, warm ? TOOLTIP_WARM_DELAY_MS : TOOLTIP_DELAY_MS);
    };

    const handlePointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons > 0) return;
      const target = targetFromEvent(event);
      if (!target || target === activeTargetRef.current) return;
      showTooltip(target);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const target = activeTargetRef.current;
      if (!target || !(event.target instanceof Node) || !target.contains(event.target)) return;
      const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (relatedTarget && target.contains(relatedTarget)) return;
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (pointerFocus) return;
      const target = targetFromEvent(event);
      if (target) showTooltip(target);
    };

    const handleFocusOut = () => hideTooltip();
    const handlePointerDown = () => { pointerFocus = true; hideTooltip(); };
    const handleKeyDown = () => { pointerFocus = false; hideTooltip(); };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('click', hideTooltip, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    document.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('blur', hideTooltip);
    window.addEventListener('resize', hideTooltip);
    window.visualViewport?.addEventListener('resize', hideTooltip);
    window.visualViewport?.addEventListener('scroll', hideTooltip);

    return () => {
      hideTooltip();
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('click', hideTooltip, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      document.removeEventListener('scroll', hideTooltip, true);
      window.removeEventListener('blur', hideTooltip);
      window.removeEventListener('resize', hideTooltip);
      window.visualViewport?.removeEventListener('resize', hideTooltip);
      window.visualViewport?.removeEventListener('scroll', hideTooltip);
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
      <span className="global-tooltip-text">{tooltip.text}</span>
    </div>
  );
}

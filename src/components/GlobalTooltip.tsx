import { useEffect, useRef, useState } from 'react';

type TooltipState = {
  text: string;
  x: number;
  y: number;
  placement: 'top' | 'bottom';
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
  '.composer-select-menu',
  '.settings-mobile-menu',
].join(',');

function isTextOnlyButton(element: HTMLElement) {
  const text = element.textContent?.trim() ?? '';
  return text.length > 0 && element.querySelector('svg') === null;
}

function getTooltipText(element: HTMLElement) {
  return (
    element.getAttribute('title')
    || element.getAttribute('data-native-title')
    || element.getAttribute('aria-label')
    || ''
  ).trim();
}

function targetFromEvent(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest<HTMLElement>(TOOLTIP_SELECTOR) ?? null;
}

function isInsideOpenOverlay(element: HTMLElement) {
  return element.closest(OPEN_OVERLAY_SELECTOR) !== null;
}

export default function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const restoreNativeTitle = (element: HTMLElement | null) => {
      if (!element) return;
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
      const text = getTooltipText(target);
      if (
        !text
        || target.hasAttribute('disabled')
        || target.getAttribute('aria-disabled') === 'true'
        || isInsideOpenOverlay(target)
      ) {
        hideTooltip();
        return;
      }

      if (target.tagName === 'BUTTON' && isTextOnlyButton(target) && !target.classList.contains('primary-action')) {
        hideTooltip();
        return;
      }

      clearTimer();
      restoreNativeTitle(activeTargetRef.current);
      activeTargetRef.current = target;

      const nativeTitle = target.getAttribute('title');
      if (nativeTitle) {
        target.setAttribute('data-native-title', nativeTitle);
        target.removeAttribute('title');
      }

      timerRef.current = window.setTimeout(() => {
        if (activeTargetRef.current !== target) return;
        const rect = target.getBoundingClientRect();
        const placement = rect.top > 48 ? 'top' : 'bottom';
        setTooltip({
          text,
          x: rect.left + rect.width / 2,
          y: placement === 'top' ? rect.top - 8 : rect.bottom + 8,
          placement,
        });
      }, 120);
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
      className={`global-tooltip is-${tooltip.placement}`}
      role="tooltip"
      style={{
        left: tooltip.x,
        top: tooltip.y,
      }}
    >
      {tooltip.text}
    </div>
  );
}

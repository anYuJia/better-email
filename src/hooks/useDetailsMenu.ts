import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import { containWheelWithin } from '../app/wheelContainment';

type UseDetailsMenuOptions = {
  floating?: boolean;
  align?: 'start' | 'end';
};

const VIEWPORT_GAP = 8;
const ANCHOR_GAP = 6;

type PopoverPanel = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

function getFloatingPanel(menu: HTMLElement) {
  return menu.querySelector<PopoverPanel>(
    ':scope > [data-floating-menu-panel="true"], :scope > div',
  );
}

function syncSummaryDisclosureState(menu: HTMLElement) {
  const summary = menu.querySelector<HTMLElement>(':scope > summary');
  if (!summary) return;

  // WebKit does not expose every styled <summary> as an actionable button in
  // the accessibility tree. Keep all shared details menus explicit and make
  // their disclosure state observable to assistive technology.
  summary.setAttribute('role', 'button');
  summary.setAttribute('aria-expanded', menu.hasAttribute('open') ? 'true' : 'false');
}

function showInTopLayer(panel: PopoverPanel) {
  if (typeof panel.showPopover !== 'function') return;
  if (!panel.hasAttribute('popover')) panel.setAttribute('popover', 'manual');
  try {
    if (!panel.matches(':popover-open')) panel.showPopover();
  } catch {
    // Older DOM implementations may expose showPopover without supporting
    // :popover-open in matches(). Calling showPopover is still safe; an
    // already-open popover simply stays open.
    try {
      panel.showPopover();
    } catch {
      // Keep the fixed-position fallback when the native top layer is not
      // available in the host WebView.
    }
  }
}

function hideFromTopLayer(panel: PopoverPanel | null) {
  if (!panel || typeof panel.hidePopover !== 'function') return;
  try {
    if (panel.matches(':popover-open')) panel.hidePopover();
  } catch {
    try {
      panel.hidePopover();
    } catch {
      // The panel is already closed or the host only partially implements
      // the Popover API. The details/fixed-position fallback remains valid.
    }
  }
}

/**
 * 原生 <details> 菜单的统一行为辅助：
 *
 * - 外部 pointerdown、Escape、resize/scroll 时关闭菜单，并把焦点恢复到
 *   summary，保持键盘可访问性。
 * - 返回 closeMenu：命令型菜单（筛选/排序/批量/阅读器更多）在选中命令后调用，
 *   单次命令选择后即关闭。
 * - 需要连续选择/编辑的菜单（如标签菜单）不调用 closeMenu，但仍受外部点击与
 *   Escape 关闭约束。
 */
function clearPanelFloatingStyles(panel: HTMLElement | null) {
  if (!panel) return;
  panel.style.removeProperty('position');
  panel.style.removeProperty('inset');
  panel.style.removeProperty('top');
  panel.style.removeProperty('left');
  panel.style.removeProperty('right');
  panel.style.removeProperty('bottom');
  panel.style.removeProperty('margin');
  panel.style.removeProperty('height');
  panel.style.removeProperty('max-height');
}

export function useDetailsMenu(
  ref: RefObject<HTMLElement>,
  { floating = false, align = 'end' }: UseDetailsMenuOptions = {},
) {
  const closeMenu = useCallback(() => {
    const details = ref.current;
    if (!details) return;
    const panel = getFloatingPanel(details);
    hideFromTopLayer(panel);
    clearPanelFloatingStyles(panel);
    if (details.hasAttribute('open')) {
      details.removeAttribute('open');
    }
    syncSummaryDisclosureState(details);
    details.removeAttribute('data-menu-positioned');
    const summary = details.querySelector('summary');
    if (summary && document.activeElement !== summary) {
      (summary as HTMLElement).focus({ preventScroll: true });
    }
  }, [ref]);

  useEffect(() => {
    const details = ref.current;
    if (!details) return undefined;
    const menu: HTMLElement = details;
    let positionFrame: number | null = null;

    function clearPositionFrame() {
      if (positionFrame === null) return;
      window.cancelAnimationFrame(positionFrame);
      positionFrame = null;
    }

    function positionFloatingMenu() {
      if (!floating || !menu.hasAttribute('open')) return;
      const summary = menu.querySelector<HTMLElement>('summary');
      const panel = getFloatingPanel(menu);
      if (!summary || !panel) return;

      // A native popover participates in the browser top layer, so pane
      // containment, overflow clipping and local stacking contexts cannot
      // cover it. Set explicit sizing properties to avoid user-agent inset:0 stretching.
      panel.style.setProperty('position', 'fixed');
      panel.style.setProperty('inset', 'unset');
      panel.style.setProperty('bottom', 'auto');
      panel.style.setProperty('right', 'auto');
      panel.style.setProperty('margin', '0');
      panel.style.setProperty('height', 'max-content');

      showInTopLayer(panel);

      const summaryRect = summary.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const maximumViewportWidth = Math.max(0, window.innerWidth - VIEWPORT_GAP * 2);
      const maximumViewportHeight = Math.max(0, window.innerHeight - VIEWPORT_GAP * 2);
      const panelWidth = Math.min(panelRect.width, maximumViewportWidth);
      const measuredHeight = Math.min(panel.scrollHeight, maximumViewportHeight);
      const roomBelow = Math.max(
        0,
        window.innerHeight - summaryRect.bottom - ANCHOR_GAP - VIEWPORT_GAP,
      );
      const roomAbove = Math.max(0, summaryRect.top - ANCHOR_GAP - VIEWPORT_GAP);
      const placeBelow = roomBelow >= Math.min(measuredHeight, 220) || roomBelow >= roomAbove;
      const availableHeight = placeBelow ? roomBelow : roomAbove;
      const panelHeight = Math.min(measuredHeight, availableHeight);
      const preferredLeft = align === 'start'
        ? summaryRect.left
        : summaryRect.right - panelWidth;
      const left = Math.min(
        Math.max(preferredLeft, VIEWPORT_GAP),
        window.innerWidth - panelWidth - VIEWPORT_GAP,
      );
      const top = placeBelow
        ? summaryRect.bottom + ANCHOR_GAP
        : Math.max(VIEWPORT_GAP, summaryRect.top - ANCHOR_GAP - panelHeight);

      panel.style.setProperty('left', `${Math.round(left)}px`);
      panel.style.setProperty('top', `${Math.round(top)}px`);
      panel.style.setProperty('max-height', `${Math.floor(availableHeight)}px`);

      menu.style.setProperty('--floating-menu-left', `${Math.round(left)}px`);
      menu.style.setProperty('--floating-menu-top', `${Math.round(top)}px`);
      menu.style.setProperty('--floating-menu-max-height', `${Math.floor(availableHeight)}px`);
      menu.setAttribute('data-menu-positioned', 'true');
    }

    function scheduleFloatingPosition() {
      if (!floating) return;
      clearPositionFrame();
      menu.removeAttribute('data-menu-positioned');
      positionFrame = window.requestAnimationFrame(() => {
        positionFrame = null;
        positionFloatingMenu();
      });
    }

    function handleToggle() {
      syncSummaryDisclosureState(menu);
      if (!menu.hasAttribute('open')) {
        clearPositionFrame();
        menu.removeAttribute('data-menu-positioned');
        const panel = getFloatingPanel(menu);
        hideFromTopLayer(panel);
        clearPanelFloatingStyles(panel);
        return;
      }
      scheduleFloatingPosition();
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menu.hasAttribute('open')) return;
      const target = event.target as Node;
      if (menu.contains(target)) return;
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const target = event.target as Node;
      // 只关闭自己菜单内的 Escape；stopPropagation 让嵌套 modal/其它菜单拥有
      // 各自的第一个 Escape。
      if (menu.contains(target) && menu.hasAttribute('open')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeMenu();
      }
    }

    function handleViewportChange(event: Event) {
      if (event.type === 'scroll' && event.target instanceof Node && menu.contains(event.target)) {
        return;
      }
      if (menu.hasAttribute('open')) closeMenu();
    }

    function handleWheel(event: WheelEvent) {
      if (!menu.hasAttribute('open')) return;
      const panel = getFloatingPanel(menu);
      if (panel) containWheelWithin(panel, event);
    }

    menu.addEventListener('toggle', handleToggle);
    document.addEventListener('pointerdown', handlePointerDown, true);
    // Capture phase prevents the same Escape from reaching application-level
    // selection/modal handlers after this menu has already consumed it.
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    menu.addEventListener('wheel', handleWheel, { passive: false });
    syncSummaryDisclosureState(menu);
    if (menu.hasAttribute('open')) scheduleFloatingPosition();
    return () => {
      clearPositionFrame();
      menu.removeEventListener('toggle', handleToggle);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
      menu.removeEventListener('wheel', handleWheel);
    };
  // Intentionally attach after every render. Some owners keep this hook
  // mounted while conditionally rendering the actual <details> node (the
  // bulk toolbar is one); a RefObject change does not itself trigger an
  // effect, so a dependency-only effect would miss that first visible menu.
  });

  return { closeMenu };
}

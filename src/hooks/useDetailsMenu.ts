import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { containWheelWithin } from '../app/wheelContainment';
import { focusMenuItem, focusPastMenu, getMenuFocusTargets } from '../app/menuFocus';
import { enterMenu, exitMenu, finishMenuEnter, pauseMenuExit } from '../app/transientMenuMotion';

type UseDetailsMenuOptions = {
  floating?: boolean;
  align?: 'start' | 'end';
  /** Combobox-like owners can keep their own selected-option keyboard policy. */
  manageFocus?: boolean;
  /** Selected-option owners choose the first target after floating placement. */
  initialFocus?: () => HTMLElement | null;
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
  { floating = false, align = 'end', manageFocus = true, initialFocus }: UseDetailsMenuOptions = {},
) {
  const openingFocusRef = useRef<'first' | 'last' | null>(null);
  const needsInitialFocusRef = useRef(false);
  const motionOpenRef = useRef(false);
  const lastPanelRef = useRef<HTMLElement | null>(null);
  useEffect(() => () => finishMenuEnter(lastPanelRef.current), []);
  const closeMenu = useCallback(({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
    const details = ref.current;
    if (!details) return;
    const panel = getFloatingPanel(details);
    if (details.hasAttribute('open')) exitMenu(panel, details);
    motionOpenRef.current = false;
    hideFromTopLayer(panel);
    clearPanelFloatingStyles(panel);
    if (details.hasAttribute('open')) {
      details.removeAttribute('open');
    }
    syncSummaryDisclosureState(details);
    details.removeAttribute('data-menu-positioned');
    const summary = details.querySelector('summary');
    openingFocusRef.current = null;
    needsInitialFocusRef.current = false;
    if (restoreFocus && summary && document.activeElement !== summary) {
      (summary as HTMLElement).focus({ preventScroll: true });
    }
  }, [ref]);

  useEffect(() => {
    const details = ref.current;
    if (!details) return undefined;
    const menu: HTMLElement = details;
    menu.setAttribute('data-menu-managed', 'true');
    let positionFrame: number | null = null;

    function preparePanel(panel: HTMLElement) {
      if (lastPanelRef.current !== panel) {
        finishMenuEnter(lastPanelRef.current);
        motionOpenRef.current = false;
      }
      lastPanelRef.current = panel;
      if (!motionOpenRef.current) pauseMenuExit(menu);
      panel.removeAttribute('inert');
      panel.removeAttribute('aria-hidden');
      panel.style.removeProperty('pointer-events');
    }

    function startMenuMotion(panel: HTMLElement, summary: HTMLElement, below = true) {
      if (motionOpenRef.current) return;
      motionOpenRef.current = true;
      const panelBounds = panel.getBoundingClientRect();
      const triggerBounds = summary.getBoundingClientRect();
      enterMenu(panel, menu,
        Math.max(0, Math.min((triggerBounds.left + triggerBounds.right) / 2 - panelBounds.left, panelBounds.width)),
        below ? 0 : panelBounds.height, below);
    }

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
      preparePanel(panel);

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
      const panelWidth = Math.min(panel.offsetWidth || panelRect.width, maximumViewportWidth);
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
      startMenuMotion(panel, summary, placeBelow);
    }

    function focusOpenedMenu() {
      needsInitialFocusRef.current = false;
      if (!manageFocus) return;
      const panel = getFloatingPanel(menu);
      const targets = panel ? getMenuFocusTargets(panel) : [];
      // Pointer-opened form popovers keep the keyboard closed on touch.
      const isForm = Boolean(panel?.querySelector('input, textarea, select, [contenteditable="true"]'));
      if (!isForm || openingFocusRef.current) {
        focusMenuItem(openingFocusRef.current === 'last' ? targets[targets.length - 1]
          : openingFocusRef.current === 'first' ? targets[0] : initialFocus?.() ?? targets[0]);
      }
      openingFocusRef.current = null;
    }

    function scheduleFloatingPosition() {
      if (!floating) return;
      clearPositionFrame();
      // Keep an already positioned form visible while its contents rerender.
      // Hiding it for the next measurement blurs WebKit's active input on
      // every keystroke. Opening/closing still owns the initial hidden state.
      positionFrame = window.requestAnimationFrame(() => {
        positionFrame = null;
        positionFloatingMenu();
        if (needsInitialFocusRef.current && menu.hasAttribute('open')) focusOpenedMenu();
      });
    }

    function handleToggle() {
      syncSummaryDisclosureState(menu);
      if (!menu.hasAttribute('open')) {
        motionOpenRef.current = false;
        needsInitialFocusRef.current = false;
        clearPositionFrame();
        menu.removeAttribute('data-menu-positioned');
        const panel = getFloatingPanel(menu);
        finishMenuEnter(panel);
        hideFromTopLayer(panel);
        clearPanelFloatingStyles(panel);
        return;
      }
      needsInitialFocusRef.current = true;
      const panel = getFloatingPanel(menu);
      const summary = menu.querySelector<HTMLElement>(':scope > summary');
      if (panel) preparePanel(panel);
      if (floating) scheduleFloatingPosition();
      else {
        if (panel && summary) startMenuMotion(panel, summary);
        focusOpenedMenu();
      }
    }

    function handleSummaryClick(event: MouseEvent) {
      const summary = menu.querySelector(':scope > summary');
      if (!(event.target instanceof Node) || !summary?.contains(event.target)) return;
      if (!menu.hasAttribute('open')) {
        const panel = getFloatingPanel(menu);
        if (panel) preparePanel(panel);
        return;
      }
      // Capture the visible panel before native <details> removes it from
      // layout. Disclosure semantics still close in this same event turn.
      event.preventDefault();
      closeMenu();
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menu.hasAttribute('open')) return;
      const target = event.target as Node;
      if (menu.contains(target)) return;
      const focusableTarget = target instanceof Element
        && target.closest('button, a[href], input, select, textarea, summary, [tabindex]');
      closeMenu({ restoreFocus: !focusableTarget });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
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

    function handleMenuNavigation(event: KeyboardEvent) {
      if (event.defaultPrevented || !manageFocus || !(event.target instanceof Node) || !menu.contains(event.target)) return;
      const summary = menu.querySelector<HTMLElement>(':scope > summary');
      const panel = getFloatingPanel(menu);
      if (!summary || !panel) return;
      if (summary.contains(event.target) && ['Enter', ' '].includes(event.key) && !menu.hasAttribute('open')) {
        openingFocusRef.current = 'first';
      } else if (summary.contains(event.target) && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        openingFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
        menu.setAttribute('open', '');
        syncSummaryDisclosureState(menu);
        positionFloatingMenu();
        const targets = getMenuFocusTargets(panel);
        focusMenuItem(event.key === 'ArrowUp' ? targets[targets.length - 1] : targets[0]);
      } else if (menu.hasAttribute('open') && panel.contains(event.target)
        && event.target instanceof HTMLElement
        && !event.target.matches('input, textarea, select, [contenteditable="true"]')
        && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const targets = getMenuFocusTargets(panel);
        if (!targets.length) return;
        event.preventDefault();
        const current = targets.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + targets.length) % targets.length;
        focusMenuItem(targets[next]);
      } else if (menu.hasAttribute('open') && event.key === 'Tab' && !panel.querySelector('input, textarea, select, [contenteditable="true"]')) {
        closeMenu({ restoreFocus: false });
        if (focusPastMenu(summary, panel, event.shiftKey)) event.preventDefault();
        else summary.focus({ preventScroll: true });
      }
    }

    function handleFocusOut(event: FocusEvent) {
      if (event.relatedTarget instanceof Node && !menu.contains(event.relatedTarget) && menu.hasAttribute('open')) {
        closeMenu({ restoreFocus: false });
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
    menu.addEventListener('click', handleSummaryClick, true);
    document.addEventListener('pointerdown', handlePointerDown, true);
    // Capture phase prevents the same Escape from reaching application-level
    // selection/modal handlers after this menu has already consumed it.
    document.addEventListener('keydown', handleKeyDown, true);
    // Bubble after React handlers so CompactDropdown and nested menus can
    // implement their own navigation before this shared trigger fallback.
    document.addEventListener('keydown', handleMenuNavigation);
    menu.addEventListener('focusout', handleFocusOut);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    menu.addEventListener('wheel', handleWheel, { passive: false });
    syncSummaryDisclosureState(menu);
    if (menu.hasAttribute('open')) scheduleFloatingPosition();
    return () => {
      clearPositionFrame();
      menu.removeEventListener('toggle', handleToggle);
      menu.removeEventListener('click', handleSummaryClick, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keydown', handleMenuNavigation);
      menu.removeEventListener('focusout', handleFocusOut);
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

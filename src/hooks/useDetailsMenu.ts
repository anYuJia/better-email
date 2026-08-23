import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';

type UseDetailsMenuOptions = {
  floating?: boolean;
};

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
export function useDetailsMenu(
  ref: RefObject<HTMLElement>,
  { floating = false }: UseDetailsMenuOptions = {},
) {
  const closeMenu = useCallback(() => {
    const details = ref.current;
    if (!details) return;
    if (details.hasAttribute('open')) {
      details.removeAttribute('open');
    }
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
      const panel = menu.querySelector<HTMLElement>(':scope > div');
      if (!summary || !panel) return;

      const viewportGap = 8;
      const anchorGap = 6;
      const summaryRect = summary.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = Math.min(panelRect.width, window.innerWidth - viewportGap * 2);
      const measuredHeight = Math.min(panel.scrollHeight, 320);
      const roomBelow = window.innerHeight - summaryRect.bottom - anchorGap - viewportGap;
      const roomAbove = summaryRect.top - anchorGap - viewportGap;
      const placeBelow = roomBelow >= Math.min(measuredHeight, 220) || roomBelow >= roomAbove;
      const availableHeight = Math.max(120, placeBelow ? roomBelow : roomAbove);
      const panelHeight = Math.min(measuredHeight, availableHeight);
      const left = Math.min(
        Math.max(summaryRect.right - panelWidth, viewportGap),
        window.innerWidth - panelWidth - viewportGap,
      );
      const top = placeBelow
        ? summaryRect.bottom + anchorGap
        : Math.max(viewportGap, summaryRect.top - anchorGap - panelHeight);

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
      if (!menu.hasAttribute('open')) {
        clearPositionFrame();
        menu.removeAttribute('data-menu-positioned');
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

    menu.addEventListener('toggle', handleToggle);
    document.addEventListener('pointerdown', handlePointerDown, true);
    // Capture phase prevents the same Escape from reaching application-level
    // selection/modal handlers after this menu has already consumed it.
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    if (menu.hasAttribute('open')) scheduleFloatingPosition();
    return () => {
      clearPositionFrame();
      menu.removeEventListener('toggle', handleToggle);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  // Intentionally attach after every render. Some owners keep this hook
  // mounted while conditionally rendering the actual <details> node (the
  // bulk toolbar is one); a RefObject change does not itself trigger an
  // effect, so a dependency-only effect would miss that first visible menu.
  });

  return { closeMenu };
}

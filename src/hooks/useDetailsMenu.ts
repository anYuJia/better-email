import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';

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
export function useDetailsMenu(ref: RefObject<HTMLElement>) {
  const closeMenu = useCallback(() => {
    const details = ref.current;
    if (!details) return;
    if (details.hasAttribute('open')) {
      details.removeAttribute('open');
    }
    const summary = details.querySelector('summary');
    if (summary && document.activeElement !== summary) {
      (summary as HTMLElement).focus({ preventScroll: true });
    }
  }, [ref]);

  useEffect(() => {
    const details = ref.current;
    if (!details) return undefined;
    const menu: HTMLElement = details;

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
        closeMenu();
      }
    }

    function handleViewportChange() {
      if (menu.hasAttribute('open')) closeMenu();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [ref, closeMenu]);

  return { closeMenu };
}

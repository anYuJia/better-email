import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import { useWheelContainment } from '../hooks/useWheelContainment';
import './context-menu.css';

export type ContextMenuItem = {
  id: string;
  label: string;
  detail?: string;
  tooltip?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  selectionRole?: 'checkbox' | 'radio';
  separatorBefore?: boolean;
  children?: ContextMenuItem[];
  onSelect?: () => void;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  className?: string;
  closeIgnoreRef?: React.RefObject<HTMLElement>;
  ariaLabel?: string;
  title?: string;
  detail?: string;
  note?: string;
};

type ContextMenuContentProps = Pick<
  ContextMenuProps,
  'items' | 'onClose' | 'ariaLabel' | 'title' | 'detail' | 'note'
>;

function positionSubmenuForBranch(branch: HTMLElement) {
  const submenu = branch.querySelector<HTMLElement>(':scope > .context-submenu');
  const trigger = branch.querySelector<HTMLElement>(':scope > button');
  if (!submenu || !trigger) return;

  const margin = 8;
  const gap = 6;
  const triggerBounds = trigger.getBoundingClientRect();
  const previousDisplay = submenu.style.display;
  const previousVisibility = submenu.style.visibility;

  submenu.style.display = 'block';
  submenu.style.visibility = 'hidden';
  const width = Math.min(submenu.offsetWidth || 232, window.innerWidth - margin * 2);
  const height = Math.min(submenu.offsetHeight || submenu.scrollHeight || 0, window.innerHeight - margin * 2);

  let left = triggerBounds.right + gap;
  if (left + width > window.innerWidth - margin) {
    left = triggerBounds.left - width - gap;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  let top = triggerBounds.top - 5;
  if (top + height > window.innerHeight - margin) {
    top = window.innerHeight - height - margin;
  }
  top = Math.max(margin, top);

  submenu.style.setProperty('--context-submenu-left', `${left}px`);
  submenu.style.setProperty('--context-submenu-top', `${top}px`);
  submenu.style.setProperty('--context-submenu-max-height', `${Math.max(140, window.innerHeight - top - margin)}px`);
  submenu.style.display = previousDisplay;
  submenu.style.visibility = previousVisibility;
}

function MenuItems({
  items,
  onClose,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const [pointerOpenId, setPointerOpenId] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const detailIdPrefix = useId();
  const reserveLeadingSlot = items.some((item) => item.icon || item.checked !== undefined);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  function cancelScheduledClose() {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function positionSubmenu(event: React.PointerEvent<HTMLDivElement>) {
    cancelScheduledClose();
    setPointerOpenId(
      event.currentTarget.querySelector(':scope > button')?.getAttribute('data-context-item') ?? null,
    );
    positionSubmenuForBranch(event.currentTarget);
  }

  function scheduleSubmenuClose(itemId: string) {
    cancelScheduledClose();
    // Leave enough time to cross the small visual gap between two fixed
    // surfaces. Entering the submenu cancels this timer through the branch.
    closeTimerRef.current = window.setTimeout(() => {
      setPointerOpenId((current) => current === itemId ? null : current);
      closeTimerRef.current = null;
    }, 260);
  }

  return items.map((item, index) => {
    const detailId = item.detail ? `${detailIdPrefix}-detail-${index}` : undefined;
    return (
    <React.Fragment key={item.id}>
      {item.separatorBefore && <div className="context-menu-separator" role="separator" />}
      <div
        className={item.children?.length
          ? `context-menu-branch${pointerOpenId === item.id ? ' is-pointer-open' : ''}`
          : undefined}
        onPointerEnter={item.children?.length ? positionSubmenu : undefined}
        onPointerLeave={item.children?.length ? () => scheduleSubmenuClose(item.id) : undefined}
      >
        <button
          type="button"
          role={item.selectionRole === 'radio'
            ? 'menuitemradio'
            : item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
          aria-label={item.label}
          aria-describedby={detailId}
          aria-checked={item.selectionRole || item.checked !== undefined ? Boolean(item.checked) : undefined}
          data-context-item={item.id}
          className={[
            item.danger ? 'danger' : '',
            item.detail ? 'has-detail' : '',
            reserveLeadingSlot ? '' : 'without-leading-slot',
          ].filter(Boolean).join(' ') || undefined}
          disabled={item.disabled}
          aria-haspopup={item.children?.length ? 'menu' : undefined}
          title={item.tooltip}
          onClick={(event) => {
            if (item.children?.length) {
              const branch = event.currentTarget.parentElement;
              if (branch) positionSubmenuForBranch(branch);
              cancelScheduledClose();
              setPointerOpenId(item.id);
              return;
            }
            if (!item.onSelect) return;
            item.onSelect();
            onClose();
          }}
        >
          {reserveLeadingSlot && (
            <span className="context-menu-icon" aria-hidden="true">
              {item.checked ? <Check size={14} /> : item.icon}
            </span>
          )}
          <span className="context-menu-copy">
            <span className="context-menu-label">{item.label}</span>
            {item.detail && <small id={detailId}>{item.detail}</small>}
          </span>
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
          {item.children?.length ? <ChevronRight className="context-menu-chevron" size={14} /> : null}
        </button>
        {item.children?.length ? (
          <div className="context-submenu" role="menu" aria-label={item.label}>
            <MenuItems items={item.children} onClose={onClose} />
          </div>
        ) : null}
      </div>
    </React.Fragment>
    );
  });
}

export function ContextMenuItems({
  items,
  onClose,
  ariaLabel = '快捷操作',
}: Pick<ContextMenuContentProps, 'items' | 'onClose' | 'ariaLabel'>) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const activeButton = event.target instanceof HTMLButtonElement
      ? event.target
      : document.activeElement instanceof HTMLButtonElement
        ? document.activeElement
        : null;
    const activeMenu = activeButton?.closest<HTMLElement>('[role="menu"]') ?? event.currentTarget;
    const buttons = Array.from(activeMenu.querySelectorAll<HTMLButtonElement>(
      ':scope > div > button:not(:disabled)',
    ));
    if (!buttons.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const currentIndex = buttons.indexOf(activeButton as HTMLButtonElement);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + direction + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus({ preventScroll: true });
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus({ preventScroll: true });
      return;
    }

    if (event.key === 'ArrowRight') {
      const branch = activeButton?.parentElement?.classList.contains('context-menu-branch')
        ? activeButton.parentElement
        : null;
      const submenu = branch?.querySelector<HTMLElement>(':scope > .context-submenu') ?? null;
      const firstChild = submenu?.querySelector<HTMLButtonElement>(
        ':scope > div > button:not(:disabled)',
      );
      if (branch && firstChild) {
        event.preventDefault();
        positionSubmenuForBranch(branch);
        branch.classList.add('is-keyboard-open');
        firstChild.focus({ preventScroll: true });
      }
      return;
    }

    if (event.key === 'ArrowLeft' && activeMenu.classList.contains('context-submenu')) {
      const parentButton = activeMenu.parentElement?.querySelector<HTMLButtonElement>(':scope > button');
      if (parentButton) {
        event.preventDefault();
        activeMenu.parentElement?.classList.remove('is-keyboard-open');
        parentButton.focus({ preventScroll: true });
      }
    }
  }

  return (
    <div
      className="context-menu-items"
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}

export function ContextMenuContent({
  items,
  onClose,
  ariaLabel = '快捷操作',
  title,
  detail,
  note,
}: ContextMenuContentProps) {
  return (
    <>
      {(title || detail) && (
        <div className="context-menu-heading">
          {title && <strong>{title}</strong>}
          {detail && <span>{detail}</span>}
        </div>
      )}
      <ContextMenuItems items={items} onClose={onClose} ariaLabel={ariaLabel} />
      {note && <p className="context-menu-note">{note}</p>}
    </>
  );
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
  className,
  closeIgnoreRef,
  ariaLabel = '快捷操作',
  title,
  detail,
  note,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useWheelContainment(menuRef);
  const [position, setPosition] = useState({ x, y });
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // Tab 关闭时浏览器已把焦点移到下一个自然目标，不能再把焦点拉回触发元素。
  const skipFocusRestoreRef = useRef(false);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const width = Math.min(menu.offsetWidth || menu.getBoundingClientRect().width, window.innerWidth - margin * 2);
    const height = Math.min(menu.scrollHeight || menu.getBoundingClientRect().height, window.innerHeight - margin * 2);
    menu.style.setProperty('--context-menu-max-height', `${window.innerHeight - margin * 2}px`);
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    // 记录打开菜单前的焦点（右键目标或触发按钮），关闭时按规则恢复。
    // 不用“只执行一次”标记：React StrictMode 会先执行一次
    // setup/cleanup 探测。如果跳过第二次 setup，菜单将保留在背景焦点。
    skipFocusRestoreRef.current = false;
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    menuRef.current
      ?.querySelector<HTMLButtonElement>(
        '.context-menu-items > div > button:not(:disabled)',
      )
      ?.focus({ preventScroll: true });
    return () => {
      if (skipFocusRestoreRef.current) return;
      const target = previousFocusRef.current;
      // 触发元素可能已被卸载：安全降级为不恢复。
      if (target && target.isConnected && typeof target.focus === 'function') {
        try {
          target.focus({ preventScroll: true });
        } catch {
          // 忽略不可聚焦的恢复目标。
        }
      }
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || closeIgnoreRef?.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        skipFocusRestoreRef.current = true;
        onClose();
        return;
      }

    }

    function handleViewportChange(event: Event) {
      if (
        event.type === 'scroll'
        && event.target instanceof Node
        && menuRef.current?.contains(event.target)
      ) {
        return;
      }
      onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    // 菜单是当前顶层交互：在捕获阶段先于应用级快捷键处理 Escape。
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeIgnoreRef, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={[
        'context-menu',
        'context-menu-surface',
        className ?? '',
      ].filter(Boolean).join(' ')}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ContextMenuContent
        items={items}
        onClose={onClose}
        ariaLabel={ariaLabel}
        title={title}
        detail={detail}
        note={note}
      />
    </div>,
    document.body,
  );
}

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import './context-menu.css';

export type ContextMenuItem = {
  id: string;
  label: string;
  detail?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
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
};

function MenuItems({
  items,
  onClose,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
}) {
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
    const width = Math.min(submenu.offsetWidth || 226, window.innerWidth - margin * 2);
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

  function positionSubmenu(event: React.PointerEvent<HTMLDivElement>) {
    positionSubmenuForBranch(event.currentTarget);
  }

  return items.map((item) => (
    <React.Fragment key={item.id}>
      {item.separatorBefore && <div className="context-menu-separator" role="separator" />}
      <div
        className={item.children?.length ? 'context-menu-branch' : undefined}
        onPointerEnter={item.children?.length ? positionSubmenu : undefined}
      >
        <button
          type="button"
          role="menuitem"
          data-context-item={item.id}
          className={[
            item.danger ? 'danger' : '',
            item.detail ? 'has-detail' : '',
          ].filter(Boolean).join(' ') || undefined}
          disabled={item.disabled}
          aria-haspopup={item.children?.length ? 'menu' : undefined}
          onClick={() => {
            if (item.children?.length || !item.onSelect) return;
            item.onSelect();
            onClose();
          }}
        >
          <span className="context-menu-icon" aria-hidden="true">
            {item.checked ? <Check size={14} /> : item.icon}
          </span>
          <span className="context-menu-copy">
            <span className="context-menu-label">{item.label}</span>
            {item.detail && <small>{item.detail}</small>}
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
  ));
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
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

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
    const menu = menuRef.current;
    menu
      ?.querySelector<HTMLButtonElement>(
        '.context-menu-items > div > button:not(:disabled)',
      )
      ?.focus();

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || closeIgnoreRef?.current?.contains(target)) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        onClose();
        return;
      }

      const eventButton = event.target instanceof HTMLButtonElement ? event.target : null;
      const activeButton = eventButton
        ?? (document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
      const activeMenu = activeButton?.closest<HTMLElement>('[role="menu"]')
        ?? menuRef.current?.querySelector<HTMLElement>('.context-menu-items')
        ?? null;
      const buttons = Array.from(activeMenu?.querySelectorAll<HTMLButtonElement>(
        ':scope > div > button:not(:disabled)',
      ) ?? []);
      if (!buttons.length) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const currentIndex = buttons.indexOf(activeButton as HTMLButtonElement);
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = currentIndex < 0
          ? 0
          : (currentIndex + direction + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
        return;
      }

      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
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
        if (firstChild) {
          event.preventDefault();
          branch?.classList.add('is-keyboard-open');
          firstChild.focus();
        }
        return;
      }

      if (event.key === 'ArrowLeft' && activeMenu?.classList.contains('context-submenu')) {
        const parentButton = activeMenu.parentElement?.querySelector<HTMLButtonElement>(':scope > button');
        if (parentButton) {
          event.preventDefault();
          activeMenu.parentElement?.classList.remove('is-keyboard-open');
          parentButton.focus();
        }
      }
    }

    function handleViewportChange() {
      onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('blur', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('blur', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeIgnoreRef, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={[
        'context-menu',
        className ?? '',
      ].filter(Boolean).join(' ')}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {(title || detail) && (
        <div className="context-menu-heading">
          {title && <strong>{title}</strong>}
          {detail && <span>{detail}</span>}
        </div>
      )}
      <div className="context-menu-items" role="menu" aria-label={ariaLabel}>
        <MenuItems items={items} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

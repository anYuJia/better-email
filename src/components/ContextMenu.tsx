import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';
import './context-menu.css';

export type ContextMenuItem = {
  id: string;
  label: string;
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
  return items.map((item) => (
    <React.Fragment key={item.id}>
      {item.separatorBefore && <div className="context-menu-separator" role="separator" />}
      <div className={item.children?.length ? 'context-menu-branch' : undefined}>
        <button
          type="button"
          role="menuitem"
          data-context-item={item.id}
          className={item.danger ? 'danger' : undefined}
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
          <span className="context-menu-label">{item.label}</span>
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
  ariaLabel = '快捷操作',
  title,
  detail,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [alignSubmenuLeft, setAlignSubmenuLeft] = useState(false);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    const margin = 8;
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - bounds.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - bounds.height - margin)),
    });
    setAlignSubmenuLeft(x > window.innerWidth - 500);
  }, [x, y]);

  useEffect(() => {
    const menu = menuRef.current;
    menu
      ?.querySelector<HTMLButtonElement>(
        '.context-menu-items > button:not(:disabled), .context-menu-items > .context-menu-branch > button:not(:disabled)',
      )
      ?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
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
        ':scope > button:not(:disabled), :scope > .context-menu-branch > button:not(:disabled)',
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
          'button:not(:disabled)',
        );
        if (firstChild) {
          event.preventDefault();
          firstChild.focus();
        }
        return;
      }

      if (event.key === 'ArrowLeft' && activeMenu?.classList.contains('context-submenu')) {
        const parentButton = activeMenu.parentElement?.querySelector<HTMLButtonElement>(':scope > button');
        if (parentButton) {
          event.preventDefault();
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
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={alignSubmenuLeft ? 'context-menu align-submenu-left' : 'context-menu'}
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

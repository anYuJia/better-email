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
    menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      if (!buttons.length) return;
      event.preventDefault();
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = currentIndex < 0
        ? 0
        : (currentIndex + direction + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
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
      role="menu"
      aria-label={ariaLabel}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuItems items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

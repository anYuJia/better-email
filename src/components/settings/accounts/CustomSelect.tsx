import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

type Option = {
  value: string;
  label: string;
  meta?: string;
};

type CustomSelectProps = {
  value: string;
  options: readonly Option[] | Option[];
  onChange: (val: string) => void;
  className?: string;
  ariaLabel?: string;
};

type MenuPlacement = {
  top: number;
  left: number;
  width: number;
};

/**
 * Shared dropdown control used across the settings workspace and the
 * composer. The option list renders through a portal with fixed positioning
 * so it is never clipped or covered by surrounding cards, sections or dialogs.
 */
export function CustomSelect({
  value,
  options,
  onChange,
  className = '',
  ariaLabel,
}: CustomSelectProps) {
  const activeOption = options.find((o) => o.value === value) || options[0];
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setPlacement({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const menu = open && placement
    ? createPortal(
        <div
          ref={menuRef}
          className="custom-select-dropdown"
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'fixed',
            top: placement.top,
            left: placement.left,
            width: placement.width,
          }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={active ? 'active' : ''}
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.meta && <small>{option.meta}</small>}
                </span>
                {active && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`custom-select-menu ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-summary"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <strong>{activeOption?.label ?? '未选择'}</strong>
          {activeOption?.meta && <small>{activeOption.meta}</small>}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}

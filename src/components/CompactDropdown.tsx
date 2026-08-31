import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useDetailsMenu } from '../hooks/useDetailsMenu';

export type CompactDropdownOption<Value extends string> = {
  id: Value;
  label: string;
};

type CompactDropdownProps<Value extends string> = {
  className?: string;
  label: string;
  currentLabel: string;
  ariaLabel: string;
  value: Value;
  options: readonly CompactDropdownOption<Value>[];
  onChange: (value: Value) => void;
};

/**
 * A small, keyboard-friendly product dropdown. The trigger keeps the
 * semantic label and current value visible; the menu owns only the choices
 * for that one concept, so filter and sort cannot collapse back into a vague
 * "view" command.
 */
export default function CompactDropdown<Value extends string>({
  className = '',
  label,
  currentLabel,
  ariaLabel,
  value,
  options,
  onChange,
}: CompactDropdownProps<Value>) {
  const menuRef = React.useRef<HTMLDetailsElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [isOpen, setIsOpen] = React.useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));
  const menu = useDetailsMenu(menuRef, {
    floating: true,
    align: className.split(/\s+/).includes('sort-menu') ? 'end' : 'start',
  });

  const focusOption = React.useCallback((index: number) => {
    const nextIndex = Math.max(0, Math.min(index, options.length - 1));
    optionRefs.current[nextIndex]?.focus({ preventScroll: true });
  }, [options.length]);

  const openMenuAt = React.useCallback((index: number) => {
    const details = menuRef.current;
    if (!details) return;
    details.open = true;
    setIsOpen(true);
    window.requestAnimationFrame(() => focusOption(index));
  }, [focusOption]);

  const closeMenu = React.useCallback(() => {
    menu.closeMenu();
    setIsOpen(false);
  }, [menu]);

  const handleSummaryKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      openMenuAt((selectedIndex + direction + options.length) % options.length);
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      closeMenu();
    }
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (index + direction + options.length) % options.length;
      window.requestAnimationFrame(() => focusOption(nextIndex));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      window.requestAnimationFrame(() => focusOption(event.key === 'Home' ? 0 : options.length - 1));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onChange(options[index].id);
      closeMenu();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === 'Tab') {
      // Let the browser move focus normally, but do not leave a closed-over
      // menu item in the tab order after the user tabs away.
      closeMenu();
    }
  };

  return (
    <details
      className={`compact-dropdown ${className}`.trim()}
      ref={menuRef}
      data-floating-menu="true"
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setIsOpen(nextOpen);
        if (nextOpen) {
          window.requestAnimationFrame(() => focusOption(selectedIndex));
        }
      }}
    >
      <summary
        role="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onKeyDown={handleSummaryKeyDown}
        onClick={() => {
          window.requestAnimationFrame(() => {
            if (menuRef.current?.open) focusOption(selectedIndex);
          });
        }}
      >
        <span className="compact-dropdown-label">{label}</span>
        <strong>{currentLabel}</strong>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div role="menu" aria-label={`${label}选项`}>
        {options.map((option, index) => {
          const selected = option.id === value;
          return (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              className={selected ? 'active' : ''}
              key={option.id}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onClick={() => {
                onChange(option.id);
                closeMenu();
              }}
            >
              <span className="compact-dropdown-check" aria-hidden="true">
                {selected && <Check size={14} strokeWidth={2} />}
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </details>
  );
}

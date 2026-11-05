import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useDetailsMenu } from '../hooks/useDetailsMenu';
import { focusMenuItem } from '../app/menuFocus';

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
  triggerIcon?: React.ReactNode;
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
  triggerIcon,
}: CompactDropdownProps<Value>) {
  const menuRef = React.useRef<HTMLDetailsElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const openingIndexRef = React.useRef<number | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));
  const menu = useDetailsMenu(menuRef, {
    floating: true,
    initialFocus: () => optionRefs.current[openingIndexRef.current ?? selectedIndex] ?? null,
  });

  const focusOption = React.useCallback((index: number) => {
    const nextIndex = Math.max(0, Math.min(index, options.length - 1));
    focusMenuItem(optionRefs.current[nextIndex]);
  }, [options.length]);

  const openMenuAt = React.useCallback((index: number) => {
    const details = menuRef.current;
    if (!details) return;
    openingIndexRef.current = index;
    details.open = true;
    setIsOpen(true);
  }, []);

  const closeMenu = React.useCallback(() => {
    menu.closeMenu();
    openingIndexRef.current = null;
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
      focusOption(nextIndex);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusOption(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (options[index].id !== value) onChange(options[index].id);
      closeMenu();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    // The shared menu owns Tab: dismiss without stealing focus, then resume
    // next to the trigger even when the panel is in the browser top layer.
  };

  return (
    <details
      className={`compact-dropdown ${className}`.trim()}
      ref={menuRef}
      data-floating-menu="true"
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setIsOpen(nextOpen);
        if (!nextOpen) openingIndexRef.current = null;
      }}
    >
      <summary
        role="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onKeyDown={handleSummaryKeyDown}
      >
        {triggerIcon && <span className="compact-dropdown-trigger-icon" aria-hidden="true">{triggerIcon}</span>}
        <span className="compact-dropdown-label">{label}</span>
        <strong>{currentLabel}</strong>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div
        role="menu"
        aria-label={`${label}选项`}
        data-floating-menu-panel="true"
      >
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
                if (!selected) onChange(option.id);
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

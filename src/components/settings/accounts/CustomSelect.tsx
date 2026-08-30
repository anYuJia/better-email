import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
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
  disabled?: boolean;
  disabledValues?: readonly string[];
  dense?: boolean;
  /**
   * Menus are rendered in document.body. Consumers inside a modal must opt
   * into a layer above that modal instead of inheriting the ordinary settings
   * dropdown layer.
   */
  portalZIndex?: number;
  /**
   * Optional focus-scope owner for a body-portal menu. A modal that owns the
   * select can use this marker to include the menu in its focus trap even
   * though the menu is not a DOM descendant of the modal.
   */
  portalOwnerId?: string;
};

/** Shared portal layers used by CustomSelect consumers that live in modals. */
export const customSelectPortalLayers = {
  default: 1000,
  accountLogin: 2050,
  onboarding: 2550,
  contactImport: 2650,
} as const;

type MenuPlacement = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  opensAbove: boolean;
};

const TYPEAHEAD_RESET_MS = 700;
const MENU_GAP = 4;
const VIEWPORT_GUTTER = 12;
const MENU_MAX_HEIGHT = 280;
const MENU_EXIT_MS = 120;

function prefersReducedMotion() {
  return typeof window === 'undefined'
    || typeof window.matchMedia !== 'function'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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
  disabled = false,
  disabledValues = [],
  dense = false,
  portalZIndex = customSelectPortalLayers.default,
  portalOwnerId,
}: CustomSelectProps) {
  // An unmatched value is a real empty state. Falling back to the first
  // option can silently present another account while the selected value is
  // still loading or has just been removed.
  const activeOption = options.find((o) => o.value === value);
  const [open, setOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const comboboxId = useId();
  const listboxId = useId();
  const typeaheadRef = useRef({ query: '', updatedAt: 0 });
  const closeTimerRef = useRef<number | null>(null);

  const isOptionDisabled = (option: Option) => disabledValues.includes(option.value);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const requestedActiveIndex = activeValue === null
    ? -1
    : options.findIndex((option) => option.value === activeValue);
  const firstEnabledIndex = options.findIndex((option) => !isOptionDisabled(option));
  const lastEnabledIndex = (() => {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!isOptionDisabled(options[index])) return index;
    }
    return -1;
  })();
  const activeIndex = requestedActiveIndex >= 0 && !isOptionDisabled(options[requestedActiveIndex])
    ? requestedActiveIndex
    : selectedIndex >= 0 && !isOptionDisabled(options[selectedIndex])
      ? selectedIndex
      : firstEnabledIndex;

  function getOptionId(index: number) {
    return `${listboxId}-option-${index}`;
  }

  function resetTypeahead() {
    typeaheadRef.current = { query: '', updatedAt: 0 };
  }

  function finishMenuClose() {
    setMenuMounted(false);
    setActiveValue(null);
    setPlacement(null);
    closeTimerRef.current = null;
  }

  function closeMenu({ restoreFocus = false } = {}) {
    setOpen(false);
    setMenuVisible(false);
    resetTypeahead();
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    if (prefersReducedMotion()) {
      finishMenuClose();
    } else {
      closeTimerRef.current = window.setTimeout(finishMenuClose, MENU_EXIT_MS);
    }
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }

  function prepareMenuOpen() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!open) {
      if (!menuMounted) setPlacement(null);
      setMenuVisible(false);
    }
    setMenuMounted(true);
    setOpen(true);
  }

  function openMenu(index = selectedIndex >= 0 && !isOptionDisabled(options[selectedIndex])
    ? selectedIndex
    : firstEnabledIndex) {
    setActiveValue(index >= 0 ? options[index].value : null);
    prepareMenuOpen();
  }

  function moveActive(direction: 1 | -1) {
    const boundary = direction === 1 ? options.length : -1;
    for (let index = activeIndex + direction; index !== boundary; index += direction) {
      if (!isOptionDisabled(options[index])) {
        setActiveValue(options[index].value);
        return;
      }
    }
  }

  function commitActiveOption({ restoreFocus = true } = {}) {
    const option = options[activeIndex];
    if (option && !isOptionDisabled(option)) {
      onChange(option.value);
    }
    closeMenu({ restoreFocus });
  }

  function handleTypeahead(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (
      event.key.length !== 1
      || event.key === ' '
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) {
      return false;
    }

    event.preventDefault();
    const now = Date.now();
    const normalizedKey = event.key.normalize('NFKC').toLocaleLowerCase();
    const continuing = now - typeaheadRef.current.updatedAt <= TYPEAHEAD_RESET_MS;
    const query = `${continuing ? typeaheadRef.current.query : ''}${normalizedKey}`;
    typeaheadRef.current = { query, updatedAt: now };
    prepareMenuOpen();

    const repeatedCharacter = query.length > 1
      && Array.from(query).every((character) => character === Array.from(query)[0]);
    const lookup = repeatedCharacter ? normalizedKey : query;
    const continueCurrentMatch = continuing && !repeatedCharacter && query.length > normalizedKey.length;
    const startIndex = activeIndex < 0
      ? 0
      : continueCurrentMatch
        ? activeIndex
        : activeIndex + 1;

    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (startIndex + offset) % options.length;
      const option = options[index];
      if (
        !isOptionDisabled(option)
        && option.label.normalize('NFKC').toLocaleLowerCase().startsWith(lookup)
      ) {
        setActiveValue(option.value);
        return true;
      }
    }

    resetTypeahead();
    return true;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          openMenu();
        } else if (!event.altKey) {
          moveActive(1);
        }
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (event.altKey && open) {
          commitActiveOption();
        } else if (open) {
          moveActive(-1);
        } else {
          openMenu(selectedIndex >= 0 && !isOptionDisabled(options[selectedIndex])
            ? selectedIndex
            : lastEnabledIndex);
        }
        return;
      case 'Home':
        event.preventDefault();
        openMenu(firstEnabledIndex);
        return;
      case 'End':
        event.preventDefault();
        openMenu(lastEnabledIndex);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) {
          commitActiveOption();
        } else {
          openMenu();
        }
        return;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          closeMenu({ restoreFocus: true });
        }
        return;
      case 'Tab':
        if (open) {
          commitActiveOption({ restoreFocus: false });
        }
        return;
      default:
        handleTypeahead(event);
    }
  }

  const optionContentSignature = options
    .map((option) => `${option.label}\u0000${option.meta ?? ''}`)
    .join('\u0001');

  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = Math.max(window.innerWidth, VIEWPORT_GUTTER * 2);
      const viewportHeight = Math.max(window.innerHeight, VIEWPORT_GUTTER * 2);
      const availableWidth = Math.max(viewportWidth - VIEWPORT_GUTTER * 2, 1);
      const menu = menuRef.current;
      const previousWidth = menu?.style.width ?? '';
      if (menu) menu.style.width = 'max-content';
      const contentWidth = menu?.getBoundingClientRect().width ?? 0;
      if (menu) menu.style.width = previousWidth;
      const width = Math.min(
        Math.max(rect.width, contentWidth, 1),
        availableWidth,
      );
      const left = Math.min(
        Math.max(rect.left, VIEWPORT_GUTTER),
        Math.max(VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER),
      );
      const rowHeight = dense ? 34 : 42;
      const estimatedHeight = Math.min(
        MENU_MAX_HEIGHT,
        Math.max(120, options.length * rowHeight + 8),
      );
      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - VIEWPORT_GUTTER);
      const spaceAbove = Math.max(0, rect.top - VIEWPORT_GUTTER);
      const opensAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
      const availableHeight = opensAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(
        120,
        Math.min(MENU_MAX_HEIGHT, availableHeight - MENU_GAP),
      );
      const bottomTop = rect.bottom + MENU_GAP;
      const top = opensAbove
        ? Math.max(VIEWPORT_GUTTER, rect.top - maxHeight - MENU_GAP)
        : Math.min(
          bottomTop,
          Math.max(VIEWPORT_GUTTER, viewportHeight - VIEWPORT_GUTTER - maxHeight),
        );
      setPlacement({
        top,
        left,
        width,
        maxHeight,
        opensAbove,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [dense, open, optionContentSignature]);

  useEffect(() => {
    if (!open || !menuMounted || !placement) return undefined;
    const show = () => setMenuVisible(true);
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(show);
      return () => window.cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(show, 0);
    return () => window.clearTimeout(timer);
  }, [menuMounted, open, placement]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (disabled && open) {
      closeMenu();
    }
  }, [disabled, open]);

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
      // Clicking away is cancellation, not selection. In particular, a
      // pointer may have only hovered an option and moved virtual focus there;
      // committing that option here would silently change the setting.
      closeMenu();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        // A select opened inside a portal modal owns the first Escape. Without
        // this, the parent SettingsFrame / import dialog may close as well.
        event.stopPropagation();
        closeMenu({ restoreFocus: true });
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [activeIndex, disabledValues, onChange, open, options]);

  useEffect(() => {
    if (!open || !placement || activeIndex < 0) return;
    const option = document.getElementById(getOptionId(activeIndex));
    if (typeof option?.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, listboxId, open, placement]);

  const menu = menuMounted
    ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          className={`custom-select-dropdown${dense ? ' dense' : ''}${menuVisible ? ' is-open' : ''}`}
          role="listbox"
          aria-hidden={!open}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : comboboxId}
          data-portal-layer={portalZIndex}
          data-portal-owner={portalOwnerId}
          data-side={placement?.opensAbove ? 'top' : 'bottom'}
          style={{
            position: 'fixed',
            top: placement?.top ?? -10000,
            left: placement?.left ?? -10000,
            width: placement?.width ?? 'max-content',
            maxHeight: placement?.maxHeight,
            zIndex: portalZIndex,
            visibility: placement ? 'visible' : 'hidden',
            pointerEvents: placement && open ? undefined : 'none',
          }}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            const optionDisabled = disabledValues.includes(option.value);
            return (
              <button
                id={getOptionId(index)}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={optionDisabled || undefined}
                disabled={optionDisabled}
                tabIndex={-1}
                className={active ? 'active' : ''}
                key={option.value}
                onMouseEnter={() => {
                  if (!optionDisabled) setActiveValue(option.value);
                }}
                onPointerDown={(event) => {
                  // DOM focus stays on the combobox; aria-activedescendant
                  // carries the virtual focus into this portalled listbox.
                  event.preventDefault();
                }}
                onClick={() => {
                  onChange(option.value);
                  closeMenu({ restoreFocus: true });
                }}
              >
                <span>
                  <strong>{option.label}</strong>
                  {option.meta && <small>{option.meta}</small>}
                </span>
                {selected && <Check size={13} aria-hidden="true" />}
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
        id={comboboxId}
        type="button"
        role="combobox"
        className={`custom-select-summary ${dense ? 'dense' : ''}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? getOptionId(activeIndex) : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onBlur={() => {
          // Tab commits explicitly in handleKeyDown. Any other focus loss is
          // treated like an outside dismissal and preserves the saved value.
          if (open) closeMenu();
        }}
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleKeyDown}
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

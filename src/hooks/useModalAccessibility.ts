import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

type BackgroundState = {
  element: Element;
  inert: boolean;
  ariaHidden: string | null;
};

type UseModalAccessibilityOptions = {
  open?: boolean;
  dialogRef: RefObject<HTMLElement>;
  backdropRef: RefObject<HTMLElement>;
  initialFocusRef?: RefObject<HTMLElement>;
  onEscape?: () => void;
  escapeDisabled?: boolean;
  focusTrapDisabled?: boolean;
};

function isAvailableFocusTarget(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return !element.hasAttribute('disabled')
    && !element.hidden
    && element.getAttribute('aria-hidden') !== 'true'
    && !element.closest('[inert]')
    && style.display !== 'none'
    && style.visibility !== 'hidden';
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isAvailableFocusTarget);
}

/**
 * Applies the shared keyboard and screen-reader contract for modal surfaces.
 *
 * The backdrop may live inside the application tree or in a body portal. At
 * every ancestor level we isolate its siblings, so nested composer dialogs and
 * body-level confirmation portals both keep only the active modal exposed.
 */
export default function useModalAccessibility({
  open = true,
  dialogRef,
  backdropRef,
  initialFocusRef,
  onEscape,
  escapeDisabled = false,
  focusTrapDisabled = false,
}: UseModalAccessibilityOptions) {
  const onEscapeRef = useRef(onEscape);
  const escapeDisabledRef = useRef(escapeDisabled);
  const focusTrapDisabledRef = useRef(focusTrapDisabled);

  onEscapeRef.current = onEscape;
  escapeDisabledRef.current = escapeDisabled;
  focusTrapDisabledRef.current = focusTrapDisabled;

  useEffect(() => {
    if (!open) return undefined;

    const dialog = dialogRef.current;
    const backdrop = backdropRef.current;
    if (!dialog || !backdrop) return undefined;
    const modalDialog: HTMLElement = dialog;

    // The topmost modal must never inherit stale direct inert/aria-hidden
    // attributes. An underlying modal, however, remains inert while a later
    // sibling modal owns focus.
    const hasLaterModal = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'))
      .some((candidate) => (
        !backdrop.contains(candidate)
        && !candidate.contains(backdrop)
        && Boolean(backdrop.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
      ));
    if (!hasLaterModal) {
      backdrop.removeAttribute('inert');
      backdrop.removeAttribute('aria-hidden');
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const preferredFocus = initialFocusRef?.current;
    const initialFocus = preferredFocus && isAvailableFocusTarget(preferredFocus)
      ? preferredFocus
      : getFocusableElements(modalDialog)[0] ?? modalDialog;

    // Move focus before applying aria-hidden so the browser never observes a
    // focused descendant inside the background accessibility subtree.
    initialFocus.focus({ preventScroll: true });

    const backgroundStates: BackgroundState[] = [];
    const isolatedElements = new Set<Element>();
    let activeBranch: Element = backdrop;

    while (activeBranch.parentElement) {
      const parent = activeBranch.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === activeBranch || isolatedElements.has(sibling)) continue;
        const containsLaterModal = (
          sibling.matches('[aria-modal="true"]')
          || sibling.querySelector('[aria-modal="true"]') !== null
        ) && Boolean(
          activeBranch.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
        // A later modal is visually/topologically above this one. Leave it
        // active; its own hook will isolate this modal in the opposite pass.
        if (containsLaterModal) continue;
        isolatedElements.add(sibling);
        backgroundStates.push({
          element: sibling,
          inert: sibling.hasAttribute('inert'),
          ariaHidden: sibling.getAttribute('aria-hidden'),
        });
        sibling.setAttribute('inert', '');
        sibling.setAttribute('aria-hidden', 'true');
      }
      if (parent === document.body) break;
      activeBranch = parent;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;

      if (event.key === 'Escape') {
        if (escapeDisabledRef.current || !onEscapeRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }

      if (event.key !== 'Tab' || focusTrapDisabledRef.current) return;
      const activeModal = document.activeElement instanceof Element
        ? document.activeElement.closest<HTMLElement>('[aria-modal="true"]')
        : null;
      // A parent may carry aria-modal while its inner panel owns the hook
      // (the composer does this). A separate modal that does not contain this
      // dialog is newer/topmost and must own the keyboard event instead.
      if (activeModal && activeModal !== modalDialog && !activeModal.contains(modalDialog)) return;
      const focusable = getFocusableElements(modalDialog);
      if (focusable.length === 0) {
        event.preventDefault();
        modalDialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusIsInside = active instanceof HTMLElement && modalDialog.contains(active);

      if (!focusIsInside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    // Bubble phase lets an open combobox or other nested control consume the
    // first Escape before the containing modal sees it.
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);

      for (const state of backgroundStates.reverse()) {
        // Restore only attributes that still carry the value this hook set.
        // A lower modal may unmount in the same React commit and remove its
        // own inert state first; blindly re-applying the captured value here
        // would leave the application permanently inert after both close.
        if (state.element.hasAttribute('inert')) {
          if (state.inert) {
            state.element.setAttribute('inert', '');
          } else {
            state.element.removeAttribute('inert');
          }
        }
        if (state.element.getAttribute('aria-hidden') === 'true') {
          if (state.ariaHidden === null) {
            state.element.removeAttribute('aria-hidden');
          } else {
            state.element.setAttribute('aria-hidden', state.ariaHidden);
          }
        }
      }

      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [backdropRef, dialogRef, initialFocusRef, open]);
}

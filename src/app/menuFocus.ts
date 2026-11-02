const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'a[href]',
  'summary',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

export function isAvailableMenuFocusTarget(element: HTMLElement): boolean {
  if (element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      const summary = ancestor.querySelector(':scope > summary');
      if (!summary?.contains(element)) return false;
    }
  }
  return true;
}

export function getMenuFocusTargets(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isAvailableMenuFocusTarget);
}

/** Reveal the focused item inside its menu, without scrolling the mail workspace. */
export function focusMenuItem(target: HTMLElement | null | undefined) {
  if (!target) return;
  target.focus({ preventScroll: true });
  const boundary = target.closest<HTMLElement>(
    '.context-submenu, .context-menu-surface, [data-floating-menu-panel="true"]',
  );
  if (!boundary) return;
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    if (['auto', 'scroll', 'overlay'].includes(style.overflowY) && parent.scrollHeight > parent.clientHeight) {
      const itemBounds = target.getBoundingClientRect();
      const viewportTop = parent.getBoundingClientRect().top + parent.clientTop;
      const viewportBottom = viewportTop + parent.clientHeight;
      if (itemBounds.top < viewportTop) parent.scrollTop += itemBounds.top - viewportTop;
      else if (itemBounds.bottom > viewportBottom) parent.scrollTop += itemBounds.bottom - viewportBottom;
    }
    if (parent === boundary) break;
  }
}

/** A portaled menu's Tab order resumes beside its trigger, not at the end of body. */
export function focusPastMenu(trigger: HTMLElement | null, menu: HTMLElement, backwards: boolean): boolean {
  if (!trigger?.isConnected) return false;
  const targets = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && !menu.contains(element) && isAvailableMenuFocusTarget(element));
  const triggerIndex = targets.indexOf(trigger);
  if (triggerIndex < 0) return false;
  const target = targets[triggerIndex + (backwards ? -1 : 1)];
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

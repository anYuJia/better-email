/** Menus and dialogs share one temporary history entry over their originating
 * screen. Back dismisses the foremost layer, including when its close request
 * opens a draft confirmation. Permanent navigation can reuse that entry. */
const overlayKey = 'betterEmailOverlay';
const layers = new Map<HTMLElement, () => void>();
let reconcile: (() => void) | undefined;
let ownsEntry = false;

export function registerMobileOverlay(owner: HTMLElement, dismiss: () => void) {
  layers.set(owner, dismiss);
  reconcile?.();
  return () => {
    if (layers.get(owner) === dismiss) layers.delete(owner);
    reconcile?.();
  };
}

export function pushMobileDestination(state: Record<string, unknown>) {
  const { [overlayKey]: _overlay, ...destination } = state;
  if (window.history.state?.[overlayKey]) {
    ownsEntry = false;
    window.history.replaceState(destination, '');
  } else window.history.pushState(destination, '');
}

export function installMobileOverlayHistory() {
  let active = true;
  let returning = false;
  let scheduled = false;
  function update() {
    if (!active || returning) return;
    if (layers.size && !window.history.state?.[overlayKey]) {
      window.history.pushState({ ...window.history.state, [overlayKey]: true }, '');
      ownsEntry = true;
    } else if (!layers.size && window.history.state?.[overlayKey]) {
      returning = true;
      window.history.back();
    }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    // A selection can replace a row menu with a new composer or a dialog in
    // the same React commit. Reconcile once after all their effects settle.
    queueMicrotask(() => { scheduled = false; update(); });
  }
  function handleBack(event: PopStateEvent) {
    if (event.state?.[overlayKey]) {
      // A closed overlay cannot be restored by the browser Forward button.
      if (!layers.size) { event.stopImmediatePropagation(); update(); }
      return;
    }
    if (!ownsEntry && !returning) return;
    event.stopImmediatePropagation();
    ownsEntry = false;
    const fromUiClose = returning;
    returning = false;
    if (!fromUiClose) {
      const top = Array.from(layers.entries()).reverse().find(([element]) =>
        element.isConnected && !element.closest('[inert], [hidden], [aria-hidden="true"]'));
      if (top) {
        const [owner, dismiss] = top;
        const expanded = owner.matches('details, .context-menu')
          ? Array.from(owner.querySelectorAll<HTMLButtonElement>('.context-menu-branch > button[aria-expanded="true"]')).pop()
          : null;
        if (expanded) { expanded.click(); expanded.focus({ preventScroll: true }); }
        else dismiss();
      }
    }
    schedule();
  }
  reconcile = () => { if (layers.size) update(); else schedule(); };
  window.addEventListener('popstate', handleBack, true);
  schedule();
  return () => {
    active = false;
    reconcile = undefined;
    window.removeEventListener('popstate', handleBack, true);
    if (window.history.state?.[overlayKey] && !returning) window.history.back();
    ownsEntry = false;
  };
}

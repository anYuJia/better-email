const editableSelector = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
  'textarea',
  '[contenteditable="true"]',
].join(',');

let installed = false;

function disableWritingAssistance(element: Element) {
  if (!element.matches(editableSelector)) return;
  element.setAttribute('spellcheck', 'false');
  element.setAttribute('autocorrect', 'off');
  element.setAttribute('autocapitalize', 'off');
  element.setAttribute('data-gramm', 'false');
  element.setAttribute('data-gramm_editor', 'false');
  element.setAttribute('data-enable-grammarly', 'false');
}

/** Touch browsers can defer :active until they distinguish a tap from a scroll.
 * Give opted-in actions immediate feedback without claiming the gesture. */
export function installControlPressFeedback() {
  let pressed: { element: HTMLElement; pointerId: number; x: number; y: number; rect: DOMRect } | null = null;
  let releaseFrame: number | null = null;

  const clear = () => {
    if (releaseFrame !== null) cancelAnimationFrame(releaseFrame);
    releaseFrame = null;
    pressed?.element.removeAttribute('data-ui-pressed');
    pressed = null;
  };
  const cancel = () => {
    // Keep ownership until this gesture ends. Removing the attribute here
    // would let the browser's delayed :active press the cancelled action again.
    pressed?.element.setAttribute('data-ui-pressed', 'false');
  };
  const handleDown = (event: PointerEvent) => {
    if (event.isPrimary === false) {
      cancel();
      return;
    }
    clear();
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (event.button !== 0) return;
    const element = event.target instanceof Element
      ? event.target.closest<HTMLElement>('button, summary')
      : null;
    if (!element || element.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]')
      || element.closest('[inert]')) return;
    // The shared CSS owns this opt-in, including prefers-reduced-motion.
    if (getComputedStyle(element).getPropertyValue('--ui-control-feedback').trim() !== 'tactile') return;
    pressed = {
      element,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rect: element.getBoundingClientRect(),
    };
    element.setAttribute('data-ui-pressed', 'true');
  };
  const handleMove = (event: PointerEvent) => {
    if (!pressed || event.pointerId !== pressed.pointerId) return;
    const { rect, x, y } = pressed;
    if (!pressed.element.isConnected
      || Math.hypot(event.clientX - x, event.clientY - y) > 8
      || event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) cancel();
  };
  const handleEnd = (event: PointerEvent) => {
    if (event.pointerId !== pressed?.pointerId) return;
    cancel();
    if (releaseFrame !== null) cancelAnimationFrame(releaseFrame);
    // Native :active is released after pointerup dispatch. Retire our guard
    // on the next frame, after the browser has completed that input update.
    releaseFrame = requestAnimationFrame(clear);
  };
  const handleCancel = (event: PointerEvent) => {
    if (event.pointerId === pressed?.pointerId) cancel();
  };
  const handleVisibility = () => {
    if (document.hidden) cancel();
  };
  // Capture observes even controls whose component stops bubbling; passive
  // listeners never prevent scrolling, focus, selection, or the eventual click.
  const passiveCapture = { capture: true, passive: true };
  document.addEventListener('pointerdown', handleDown, passiveCapture);
  document.addEventListener('pointermove', handleMove, passiveCapture);
  document.addEventListener('pointerup', handleEnd, passiveCapture);
  document.addEventListener('pointercancel', handleCancel, passiveCapture);
  document.addEventListener('lostpointercapture', handleCancel, passiveCapture);
  document.addEventListener('scroll', cancel, passiveCapture);
  document.addEventListener('keydown', clear, true);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('blur', cancel);

  return () => {
    clear();
    document.removeEventListener('pointerdown', handleDown, true);
    document.removeEventListener('pointermove', handleMove, true);
    document.removeEventListener('pointerup', handleEnd, true);
    document.removeEventListener('pointercancel', handleCancel, true);
    document.removeEventListener('lostpointercapture', handleCancel, true);
    document.removeEventListener('scroll', cancel, true);
    document.removeEventListener('keydown', clear, true);
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('blur', cancel);
  };
}

export function installInputPolicy() {
  if (typeof document === 'undefined' || installed) return;
  installed = true;
  document.documentElement.setAttribute('spellcheck', 'false');
  document.body?.setAttribute('spellcheck', 'false');
  document.body?.setAttribute('autocorrect', 'off');
  document.body?.setAttribute('autocapitalize', 'off');

  document.querySelectorAll(editableSelector).forEach(disableWritingAssistance);
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element) disableWritingAssistance(event.target);
  }, true);
  installControlPressFeedback();
}

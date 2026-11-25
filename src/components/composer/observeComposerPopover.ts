type Position = { top: number; left: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/** Keep composer tools and the calendar anchored above an on-screen keyboard. */
export function observeComposerPopover(
  anchor: HTMLElement | null | undefined,
  panel: HTMLElement | null,
  align: 'start' | 'end',
  setPosition: (position: Position) => void,
) {
  if (!anchor || !panel) return;
  const viewport = window.visualViewport;
  let frame: number | null = null;
  let previous: Position | undefined;
  const update = () => {
    const trigger = anchor.getBoundingClientRect();
    const { width, height } = panel.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const x = viewport?.offsetLeft ?? 0;
    const y = viewport?.offsetTop ?? 0;
    const right = x + (viewport?.width ?? window.innerWidth) - margin;
    const bottom = y + (viewport?.height ?? window.innerHeight) - margin;
    const below = trigger.bottom + gap;
    const above = trigger.top - gap - height;
    const fitsAbove = above >= y + margin && below + height > bottom;
    const left = clamp(align === 'start' ? trigger.left : trigger.right - width, x + margin, right - width);
    const top = clamp(fitsAbove ? above : below, y + margin, bottom - height);
    if (previous?.left === left && previous.top === top) return;
    previous = { left, top };
    setPosition(previous);
  };
  // Read the trigger after the compose surface has followed the keyboard.
  const onViewportChange = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; update(); });
  };
  update();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  observer?.observe(anchor);
  observer?.observe(panel);
  window.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('scroll', onViewportChange);
  document.addEventListener('scroll', update, true);
  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener('resize', onViewportChange);
    viewport?.removeEventListener('resize', onViewportChange);
    viewport?.removeEventListener('scroll', onViewportChange);
    document.removeEventListener('scroll', update, true);
  };
}

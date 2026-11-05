/** Visual lifetime is separate from menu ownership. Callers dismiss commands,
 * focus and native <details>/popover state synchronously; the same outgoing DOM
 * is inert, inaccessible and cannot intercept the next pointer gesture. */
type RunningMotion = { cancel: () => void; pause: () => void };
type PaintedFrame = { opacity: string; transform: string; origin: string };
type ExitMotion = RunningMotion & { element: HTMLElement; sample: () => (PaintedFrame & { bounds: DOMRect }) | null };
const entering = new WeakMap<HTMLElement, RunningMotion>();
const exits = new Map<object, ExitMotion>();
function paintedFrame(element: HTMLElement): PaintedFrame {
  const style = getComputedStyle(element);
  return { opacity: style.opacity || '1', transform: style.transform || 'none', origin: style.transformOrigin };
}

function motionDuration(element: HTMLElement, property: string, fallback: number) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !element.animate) return 0;
  const token = getComputedStyle(element).getPropertyValue(property).trim();
  const value = Number.parseFloat(token);
  return Number.isFinite(value) ? Math.max(0, value * (token.endsWith('ms') ? 1 : 1000)) : fallback;
}

function play(element: HTMLElement, frames: Keyframe[], duration: number, done: () => void): RunningMotion {
  let finished = false;
  let paused = false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const animation = element.animate(frames, {
    duration,
    easing: getComputedStyle(element).getPropertyValue('--ui-ease-control').trim() || 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'both',
  });
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    if (reducedMotion?.removeEventListener) reducedMotion.removeEventListener('change', handleMotionPreference);
    else reducedMotion?.removeListener?.(handleMotionPreference);
    animation.onfinish = null;
    animation.cancel();
    done();
  };
  // Animation finish is authoritative; the timer also cleans up in a hidden
  // WebView where animation frames may be suspended.
  const timer = window.setTimeout(finish, duration + 50);
  function handleMotionPreference(event: MediaQueryListEvent) {
    if (event.matches) finish();
  }
  if (reducedMotion?.addEventListener) reducedMotion.addEventListener('change', handleMotionPreference);
  else reducedMotion?.addListener?.(handleMotionPreference);
  animation.onfinish = finish;
  return {
    cancel: finish,
    pause: () => {
      if (finished || paused) return;
      paused = true;
      const heldTime = animation.currentTime;
      animation.pause();
      // pause() may remain pending until the next animation frame. Pin its
      // hold time now, before floating placement samples the outgoing visual.
      animation.currentTime = heldTime ?? 0;
    },
  };
}

export function finishMenuEnter(element: HTMLElement | null) {
  if (element) entering.get(element)?.cancel();
}

export function cancelMenuExit(owner: object) {
  exits.get(owner)?.cancel();
}

export function pauseMenuExit(owner: object) {
  // Floating panels are positioned in the next frame. Stop the outgoing
  // visual as soon as a reopen is requested, before that measurement delay.
  // Its existing cleanup deadline still bounds an abandoned reopen.
  exits.get(owner)?.pause();
}

export function enterMenu(element: HTMLElement, owner: object, x: number, y: number, fromAbove = true) {
  // Sample before removing the inert exit surface. A quick reopen continues
  // its painted frame rather than briefly disappearing at opacity zero.
  const outgoing = exits.get(owner)?.sample();
  const bounds = outgoing ? element.getBoundingClientRect() : null;
  const samePlacement = exits.get(owner)?.element === element || outgoing && bounds && (['left', 'top', 'width', 'height'] as const).every((property) => (
    Math.abs(bounds[property] - outgoing.bounds[property]) <= 1
  ));
  const from = samePlacement ? outgoing : entering.has(element) ? paintedFrame(element) : null;
  cancelMenuExit(owner);
  element.removeAttribute('inert');
  element.removeAttribute('aria-hidden');
  element.style.removeProperty('pointer-events');
  finishMenuEnter(element);
  const duration = motionDuration(element, '--ui-motion-menu-enter', 180);
  element.style.transformOrigin = from?.origin || `${Math.round(x)}px ${Math.round(y)}px`;
  element.style.setProperty('--menu-motion-offset', fromAbove ? '-3px' : '3px');
  if (!duration) return;
  const remaining = from ? Math.max(0, Math.min(1, 1 - Number.parseFloat(from.opacity))) : 1;
  if (remaining < 0.001) return;
  element.setAttribute('data-menu-motion', 'entering');
  const motion = play(element, [
    from ? { opacity: from.opacity, transform: from.transform }
      : { opacity: 0, transform: `translateY(${fromAbove ? -3 : 3}px) scale(0.985)` },
    { opacity: 1, transform: 'none' },
  ], duration * remaining, () => {
    element.removeAttribute('data-menu-motion');
    entering.delete(element);
  });
  entering.set(element, motion);
}

/** The owner retains this exact DOM until onExited. No cloned subtree, style
 * snapshot or per-descendant layout work belongs on a command's close path. */
export function exitMenu(element: HTMLElement | null, owner: object, onExited: () => void = () => undefined) {
  if (!element?.isConnected) { onExited(); return; }
  const duration = motionDuration(element, '--ui-motion-menu-exit', 120);
  const current = paintedFrame(element);
  const bounds = element.getBoundingClientRect();
  const offset = getComputedStyle(element).getPropertyValue('--menu-motion-offset').trim() || '-3px';
  finishMenuEnter(element);
  cancelMenuExit(owner);
  element.setAttribute('inert', '');
  element.setAttribute('aria-hidden', 'true');
  element.style.pointerEvents = 'none';
  if (!duration || !bounds.width || !bounds.height) { onExited(); return; }
  element.setAttribute('data-transient-exit', '');
  // A fixed flyout must stay in viewport coordinates while its parent exits.
  // Opacity does not establish a new containing block as transform would.
  const hasFlyout = Boolean(element.querySelector('.context-submenu'));
  let cancelled = false;
  const motion = play(element, [
    { opacity: current.opacity, ...(hasFlyout ? {} : { transform: current.transform }) },
    { opacity: 0, ...(hasFlyout ? {} : { transform: `translateY(${offset}) scale(0.985)` }) },
  ], duration, () => {
    element.removeAttribute('data-transient-exit');
    exits.delete(owner);
    if (!cancelled) onExited();
  });
  exits.set(owner, {
    element,
    sample: () => element.isConnected ? { ...paintedFrame(element), bounds } : null,
    cancel: () => { cancelled = true; motion.cancel(); },
    pause: motion.pause,
  });
}

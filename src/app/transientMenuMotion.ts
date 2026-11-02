/** Visual lifetime is separate from menu ownership. Callers dismiss commands,
 * focus and native <details>/popover state synchronously; the short exit copy
 * is inert, inaccessible and cannot intercept the next pointer gesture. */
type RunningMotion = { cancel: () => void; pause: () => void };
type PaintedFrame = { opacity: string; transform: string; origin: string };
type ExitMotion = RunningMotion & { sample: () => (PaintedFrame & { bounds: DOMRect }) | null };
const entering = new WeakMap<HTMLElement, RunningMotion>();
const exits = new Map<object, ExitMotion>();
// Copying computed styles is synchronous. Large label lists must never hold
// up their command merely to preserve a short decorative exit.
const MAX_EXIT_ELEMENTS = 200;

function paintedFrame(element: HTMLElement): PaintedFrame {
  const style = getComputedStyle(element);
  return { opacity: style.opacity || '1', transform: style.transform || 'none', origin: style.transformOrigin };
}

const visualProperties = [
  'display', 'box-sizing', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'padding', 'border', 'border-radius', 'box-shadow', 'background',
  'color', 'font', 'line-height', 'letter-spacing', 'text-align', 'text-transform',
  'text-decoration', 'white-space', 'overflow', 'overflow-wrap', 'text-overflow',
  'flex', 'flex-direction', 'flex-wrap', 'align-items', 'align-self', 'justify-content',
  'grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'gap',
  'visibility', 'opacity', 'vertical-align', 'fill', 'stroke', 'stroke-width',
] as const;

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
  const samePlacement = outgoing && bounds && (['left', 'top', 'width', 'height'] as const).every((property) => (
    Math.abs(bounds[property] - outgoing.bounds[property]) <= 1
  ));
  const from = samePlacement ? outgoing : entering.has(element) ? paintedFrame(element) : null;
  cancelMenuExit(owner);
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

export function exitMenu(element: HTMLElement | null, owner: object) {
  if (!element?.isConnected) return;
  const duration = motionDuration(element, '--ui-motion-menu-exit', 120);
  if (!duration) {
    finishMenuEnter(element);
    cancelMenuExit(owner);
    return;
  }
  const sources: (HTMLElement | SVGElement)[] = [element];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (sources.length >= MAX_EXIT_ELEMENTS) {
      finishMenuEnter(element);
      cancelMenuExit(owner);
      return;
    }
    sources.push(node as HTMLElement | SVGElement);
  }
  const current = getComputedStyle(element);
  const opacity = current.opacity;
  const transform = current.transform;
  const origin = current.transformOrigin;
  const offset = current.getPropertyValue('--menu-motion-offset').trim() || '-3px';
  finishMenuEnter(element);
  cancelMenuExit(owner);
  const bounds = element.getBoundingClientRect();
  if (!bounds.width || !bounds.height || current.visibility === 'hidden') return;

  const visual = element.cloneNode(true) as HTMLElement;
  const copies = [visual, ...visual.querySelectorAll<HTMLElement | SVGElement>('*')];
  const surfaces = [{ visual, bounds, opacity, transform, origin }];
  sources.forEach((source, index) => {
    const copy = copies[index];
    const style = getComputedStyle(source);
    // Preserve contextual menu styling without retaining selectors, duplicate
    // IDs or the original event/focus targets in the document.
    for (const attribute of [...copy.attributes]) {
      if (attribute.name === 'id' || attribute.name === 'class' || attribute.name === 'popover'
        || attribute.name.startsWith('data-') || attribute.name.startsWith('aria-')
        || attribute.name === 'role' || attribute.name === 'autofocus') copy.removeAttribute(attribute.name);
    }
    for (const property of visualProperties) copy.style.setProperty(property, style.getPropertyValue(property));
    copy.style.setProperty('animation', 'none');
    copy.style.setProperty('transition', 'none');
    copy.style.setProperty('pointer-events', 'none');
    copy.setAttribute('tabindex', '-1');
    if (source instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
      copy.value = source.value;
      copy.checked = source.checked;
    } else if (source instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) copy.value = source.value;
    if (index > 0 && source instanceof HTMLElement && copy instanceof HTMLElement && style.position === 'fixed') {
      const childBounds = source.getBoundingClientRect();
      if (childBounds.width && childBounds.height && style.visibility !== 'hidden' && style.display !== 'none') {
        // A fixed flyout escapes both the branch's relative positioning and
        // its parent's scroll clipping. Keep that same viewport coordinate
        // system in a separate exit surface instead of turning it absolute.
        surfaces.push({ visual: copy, bounds: childBounds, opacity: style.opacity,
          transform: style.transform, origin: style.transformOrigin });
      }
    }
  });
  surfaces.forEach(({ visual: surface, bounds: rect, origin: transformOrigin }) => {
    surface.setAttribute('data-transient-exit', '');
    surface.setAttribute('aria-hidden', 'true');
    surface.setAttribute('inert', '');
    Object.assign(surface.style, {
      position: 'fixed', inset: 'auto', left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: '0',
      maxWidth: 'none', maxHeight: 'none', transformOrigin, zIndex: '2500',
    });
    document.body.appendChild(surface);
    // A menu may originate inside a native top-layer dialog. The inert
    // visual stays in that same paint layer after its semantic owner closes.
    if (typeof surface.showPopover === 'function') {
      surface.setAttribute('popover', 'manual');
      try { surface.showPopover(); } catch { /* Fixed positioning remains usable. */ }
    }
  });
  copies.forEach((copy, index) => {
    copy.scrollTop = sources[index].scrollTop;
    copy.scrollLeft = sources[index].scrollLeft;
  });
  let remaining = surfaces.length;
  const motions = surfaces.map(({ visual: surface, opacity: startOpacity, transform: startTransform }) => play(surface, [
    { opacity: startOpacity, transform: startTransform },
    { opacity: 0, transform: `translateY(${offset}) scale(0.985)` },
  ], duration, () => {
    surface.remove();
    remaining -= 1;
    if (!remaining) exits.delete(owner);
  }));
  exits.set(owner, {
    sample: () => visual.isConnected ? { ...paintedFrame(visual), bounds } : null,
    cancel: () => motions.forEach((motion) => motion.cancel()),
    pause: () => motions.forEach((motion) => motion.pause()),
  });
}

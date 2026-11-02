import { useLayoutEffect, useRef, type RefObject } from 'react';

type Options = {
  axis?: 'x' | 'y' | 'none';
  distance?: number;
  enabled?: boolean;
  getOffset?: () => { x: number; y: number };
  durationToken?: '--ui-motion-normal' | '--ui-motion-menu-enter' | '--ui-motion-menu-exit';
};

/** Animate from the currently painted position, including when navigation
 * reverses mid-flight. Presence/inert remain the caller's responsibility. */
export default function useSurfaceMotion(
  ref: RefObject<HTMLElement>,
  active: boolean,
  { axis = 'y', distance = 4, enabled = true, getOffset, durationToken = '--ui-motion-normal' }: Options = {},
) {
  const motionRef = useRef<{ element: HTMLElement; animation: Animation | null } | null>(null);

  useLayoutEffect(() => () => {
    motionRef.current?.animation?.cancel();
    motionRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    const previous = motionRef.current;
    if (!enabled) {
      previous?.animation?.cancel();
      if (previous) {
        previous.element.style.removeProperty('opacity');
        previous.element.style.removeProperty('translate');
      }
      motionRef.current = null;
      return undefined;
    }
    if (!element) {
      previous?.animation?.cancel();
      motionRef.current = null;
      return undefined;
    }
    const sameSurface = previous?.element === element;
    // Read before cancelling: cancelling first would expose the endpoint and
    // make a quick reversal visibly jump to the end of the previous motion.
    const painted = sameSurface ? getComputedStyle(element) : null;
    const sampledOpacity = painted ? Number.parseFloat(painted.opacity) : active ? 0 : 1;
    const fromOpacity = Number.isFinite(sampledOpacity) ? sampledOpacity : active ? 0 : 1;
    const vector = getOffset?.();
    const offset = vector ? `${vector.x}px ${vector.y}px`
      : axis === 'x' ? `${distance}px 0px` : axis === 'y' ? `0px ${distance}px` : 'none';
    const fromTranslate = painted?.translate || (active ? offset : 'none');
    previous?.animation?.cancel();
    const targetOpacity = active ? '1' : '0';
    const targetTranslate = active ? 'none' : offset;
    element.style.opacity = targetOpacity;
    // Avoid a persistent containing block for descendant fixed popovers.
    if (axis !== 'none') element.style.translate = targetTranslate;
    const state = { element, animation: null as Animation | null };
    motionRef.current = state;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const settle = () => {
      state.animation?.cancel();
      state.animation = null;
    };
    if (!preference?.matches && typeof element.animate === 'function') {
      const tokens = getComputedStyle(document.documentElement);
      const duration = Number.parseFloat(tokens.getPropertyValue(durationToken))
        || (durationToken === '--ui-motion-menu-exit' ? 120 : 180);
      const easing = tokens.getPropertyValue('--ui-ease-standard').trim() || 'cubic-bezier(0.2, 0, 0, 1)';
      const remaining = Math.min(1, Math.abs(Number(targetOpacity) - fromOpacity));
      if (remaining > 0.001) {
        state.animation = element.animate([
          { opacity: fromOpacity, ...(axis === 'none' ? {} : { translate: fromTranslate }) },
          { opacity: targetOpacity, ...(axis === 'none' ? {} : { translate: targetTranslate }) },
        ], { duration: duration * remaining, easing, fill: 'both' });
        state.animation.onfinish = settle;
      }
    }
    const preferenceChanged = () => { if (preference?.matches) settle(); };
    preference?.addEventListener?.('change', preferenceChanged);
    return () => preference?.removeEventListener?.('change', preferenceChanged);
  }, [active, axis, distance, durationToken, enabled, getOffset, ref]);
}

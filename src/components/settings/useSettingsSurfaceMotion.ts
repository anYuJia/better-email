import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Relative left preserves viewport positioning for fixed account menus and
 * dialogs. Sample before cancellation so a quick Back reverses the live frame. */
export default function useSettingsSurfaceMotion(
  ref: RefObject<HTMLElement>,
  active: boolean,
  { enabled, onExited }: { enabled: boolean; onExited: () => void },
) {
  const motionRef = useRef<{ element: HTMLElement; animation: Animation | null } | null>(null);

  useLayoutEffect(() => () => {
    motionRef.current?.animation?.cancel();
    motionRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const previous = motionRef.current;
    const element = ref.current;
    if (!enabled || !element) {
      previous?.animation?.cancel();
      previous?.element.style.removeProperty('left');
      previous?.element.style.removeProperty('opacity');
      motionRef.current = null;
      return undefined;
    }
    const painted = previous?.element === element ? getComputedStyle(element) : null;
    const sampledLeft = painted ? Number.parseFloat(painted.left) : active ? 12 : 0;
    const sampledOpacity = painted ? Number.parseFloat(painted.opacity) : active ? 0.84 : 1;
    const fromLeft = Number.isFinite(sampledLeft) ? sampledLeft : 0;
    const fromOpacity = Number.isFinite(sampledOpacity) ? sampledOpacity : 1;
    previous?.animation?.cancel();
    const left = active ? 0 : 12;
    const opacity = active ? 1 : 0;
    element.style.left = `${left}px`;
    element.style.opacity = `${opacity}`;
    const state = { element, animation: null as Animation | null };
    motionRef.current = state;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let finished = false;
    const finish = () => {
      if (finished || motionRef.current !== state) return;
      finished = true;
      state.animation?.cancel();
      state.animation = null;
      if (!active) onExited();
    };
    if (!preference?.matches && typeof element.animate === 'function') {
      const tokens = getComputedStyle(document.documentElement);
      const duration = Number.parseFloat(tokens.getPropertyValue('--ui-motion-normal')) || 180;
      const easing = tokens.getPropertyValue('--ui-ease-standard').trim() || 'cubic-bezier(0.2, 0, 0, 1)';
      const remaining = Math.min(1, Math.max(Math.abs(left - fromLeft) / 12, Math.abs(opacity - fromOpacity)));
      if (remaining > 0.001) {
        state.animation = element.animate([
          { left: `${fromLeft}px`, opacity: fromOpacity },
          { left: `${left}px`, opacity },
        ], { duration: duration * remaining, easing, fill: 'both' });
        state.animation.onfinish = finish;
      } else finish();
    } else if (preference?.matches) finish();
    // SettingsFrame retains its exit timer as the no-WAAPI fallback.
    const preferenceChanged = () => { if (preference?.matches) finish(); };
    preference?.addEventListener?.('change', preferenceChanged);
    return () => preference?.removeEventListener?.('change', preferenceChanged);
  }, [active, enabled, onExited, ref]);
}

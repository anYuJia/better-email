import { useEffect } from 'react';

export default function useMobileVisualViewport(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const heightProperty = '--mobile-viewport-height';
    const topProperty = '--mobile-viewport-top';
    const previousHeight = root.style.getPropertyValue(heightProperty);
    const previousTop = root.style.getPropertyValue(topProperty);
    let frame: number | null = null;
    const update = () => {
      frame = null;
      if (!viewport || Math.abs(viewport.scale - 1) < 0.05) {
        root.style.setProperty(heightProperty, `${Math.round(viewport?.height ?? window.innerHeight)}px`);
        root.style.setProperty(topProperty, `${Math.max(0, Math.round(viewport?.offsetTop ?? 0))}px`);
      }
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      root.style.setProperty(heightProperty, previousHeight);
      root.style.setProperty(topProperty, previousTop);
    };
  }, [enabled]);
}

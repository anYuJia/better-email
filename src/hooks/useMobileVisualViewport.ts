import { useEffect } from 'react';

export default function useMobileVisualViewport(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--mobile-viewport-height');
    let frame: number | null = null;
    const update = () => {
      frame = null;
      if (!viewport || Math.abs(viewport.scale - 1) < 0.05) {
        root.style.setProperty('--mobile-viewport-height', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
      }
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener('resize', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      window.removeEventListener('resize', schedule);
      if (previous) root.style.setProperty('--mobile-viewport-height', previous);
      else root.style.removeProperty('--mobile-viewport-height');
    };
  }, [enabled]);
}

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import useSurfaceMotion from '../../hooks/useSurfaceMotion';

type Props = {
  active: boolean;
  persistent?: boolean;
  kind: 'mail' | 'reader' | 'mailbox' | 'settings';
  children: ReactNode;
};

/** Keep the outgoing screen visible briefly, but remove it from interaction
 * immediately. The inbox stays mounted so back navigation preserves its place. */
export default function MobileScreenSurface({ active, persistent = false, kind, children }: Props) {
  const [presence, setPresence] = useState({ active, present: active });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const savedFocusRef = useRef<HTMLElement | null>(null);
  const wasActiveRef = useRef(active);
  const needsFocusRef = useRef(false);
  if (presence.active !== active) {
    setPresence({ active, present: active || presence.present });
  }

  // The mailbox is the stationary base of the stack. Reader/Settings arrive
  // from the trailing edge and uncover that same base when returning.
  useSurfaceMotion(surfaceRef, active, { axis: 'x', distance: 16, enabled: kind === 'reader' || kind === 'settings' });

  useEffect(() => {
    if (active || !presence.present) return undefined;
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const finish = () => setPresence({ active: false, present: false });
    const timer = window.setTimeout(finish, preference?.matches ? 0 : 180);
    const preferenceChanged = () => { if (preference?.matches) finish(); };
    preference?.addEventListener?.('change', preferenceChanged);
    return () => {
      window.clearTimeout(timer);
      preference?.removeEventListener?.('change', preferenceChanged);
    };
  }, [active, presence.present]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (!active) {
      if (document.activeElement instanceof HTMLElement && surface.contains(document.activeElement)) {
        savedFocusRef.current = document.activeElement;
      }
      surface.setAttribute('inert', '');
    } else {
      surface.removeAttribute('inert');
      needsFocusRef.current = !wasActiveRef.current && kind !== 'mailbox';
    }
    wasActiveRef.current = active;
  }, [active, kind]);

  // Modal cleanup restores the previous background attributes in passive
  // effects. Reassert navigation ownership afterwards if a drawer exited
  // directly into a different screen rather than back to the inbox.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (!active) {
      surface.setAttribute('inert', '');
      surface.setAttribute('aria-hidden', 'true');
    } else if (needsFocusRef.current) {
      needsFocusRef.current = false;
      const focused = document.activeElement;
      const modal = focused instanceof Element ? focused.closest('[aria-modal="true"]') : null;
      if (modal && !surface.contains(modal)) return;
      const previous = savedFocusRef.current;
      const target = previous?.isConnected && surface.contains(previous)
        ? previous
        : surface.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? surface;
      target.focus({ preventScroll: true });
    }
  }, [active, kind]);

  if (!presence.present && !persistent) return null;
  return <div
    ref={surfaceRef}
    tabIndex={-1}
    hidden={!presence.present}
    aria-hidden={!active || undefined}
    className={`mobile-screen-layer mobile-screen-layer--${kind}${active ? ' is-active' : ' is-exiting'}`}
  >{children}</div>;
}

import { useEffect } from 'react';
import type { RefObject } from 'react';
import { containWheelWithin } from '../app/wheelContainment';

/** Attach a non-passive wheel guard to a transient surface. */
export function useWheelContainment(
  ref: RefObject<HTMLElement | null>,
  active = true,
) {
  useEffect(() => {
    if (!active) return undefined;
    const surface = ref.current;
    if (!surface) return undefined;
    const wheelSurface: HTMLElement = surface;

    function handleWheel(event: WheelEvent) {
      containWheelWithin(wheelSurface, event);
    }

    wheelSurface.addEventListener('wheel', handleWheel, { passive: false });
    return () => wheelSurface.removeEventListener('wheel', handleWheel);
  }, [active, ref]);
}

import type { RefObject } from 'react';
import useExitPresence from './useExitPresence';
import useSurfaceMotion from './useSurfaceMotion';

/** Retain a form popover's own DOM through its short exit, avoiding the cost
 * of cloning calendar/form descendants. Callers disable semantics immediately. */
export default function usePopoverPresence(ref: RefObject<HTMLElement>, open: boolean) {
  const present = useExitPresence(open, 120);
  useSurfaceMotion(ref, open, {
    enabled: present,
    distance: 3,
    durationToken: open ? '--ui-motion-menu-enter' : '--ui-motion-menu-exit',
  });
  return present;
}

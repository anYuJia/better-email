import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { AppLayout } from '../app/types';
import {
  appLayoutStorageKey,
  appLayoutBounds,
  clampNumber,
  getDefaultAppLayout,
} from '../app/appConfig';
import { fitAppLayout, loadAppLayoutPreference, removeAppStorage } from '../app/storageConfig';

type ResizablePane = 'sidebar' | 'list';

export const APP_LAYOUT_BOUNDS = appLayoutBounds;

type LayoutResize = {
  pane: ResizablePane;
  startX: number;
  origin: AppLayout;
  captureTarget: HTMLButtonElement | null;
  pointerId: number | null;
  surface: HTMLElement | null;
};

export default function useAppLayout() {
  const [preferredLayout, setPreferredLayout] = useState<AppLayout | null>(loadAppLayoutPreference);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const appLayout = fitAppLayout(preferredLayout ?? getDefaultAppLayout(viewportWidth), viewportWidth);
  const preferenceChangedRef = useRef(false);
  const resizeRef = useRef<LayoutResize | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizeActiveRef = useRef(false);
  const latestClientXRef = useRef(0);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (resizeActiveRef.current || !preferenceChangedRef.current) return;
    try {
      if (preferredLayout) {
        window.localStorage.setItem(appLayoutStorageKey, JSON.stringify({ ...preferredLayout, version: 3 }));
      } else {
        removeAppStorage(appLayoutStorageKey);
      }
    } catch {
      // Resizing remains usable when browser storage is unavailable.
    }
  }, [preferredLayout]);

  const resizedLayout = useCallback((resize: LayoutResize, clientX: number) => {
    const delta = clientX - resize.startX;
    const bounds = APP_LAYOUT_BOUNDS[resize.pane];
    return fitAppLayout({
      ...resize.origin,
      [resize.pane]: clampNumber(resize.origin[resize.pane] + delta, bounds.min, bounds.max),
    }, window.innerWidth);
  }, []);

  const paintResize = useCallback((resize: LayoutResize, clientX: number) => {
    const next = resizedLayout(resize, clientX);
    resize.surface?.style.setProperty('--app-sidebar-width-preferred', `${next.sidebar}px`);
    resize.surface?.style.setProperty('--app-list-width-preferred', `${next.list}px`);
    resize.captureTarget?.setAttribute('aria-valuenow', String(next[resize.pane]));
    resize.captureTarget?.setAttribute('aria-valuetext', `${next[resize.pane]} 像素`);
  }, [resizedLayout]);

  const adjustAppLayout = useCallback((pane: ResizablePane, delta: number) => {
    preferenceChangedRef.current = true;
    const bounds = APP_LAYOUT_BOUNDS[pane];
    setPreferredLayout((current) => {
      const visible = fitAppLayout(current ?? getDefaultAppLayout(), window.innerWidth);
      return { ...visible, [pane]: clampNumber(visible[pane] + delta, bounds.min, bounds.max) };
    });
  }, []);

  const resetAppLayoutPane = useCallback((pane: ResizablePane) => {
    preferenceChangedRef.current = true;
    const responsiveDefault = getDefaultAppLayout();
    setPreferredLayout((current) => ({
      ...(current ?? responsiveDefault),
      [pane]: responsiveDefault[pane],
    }));
  }, []);

  const finishResize = useCallback(() => {
    const resize = resizeRef.current;
    if (!resize) return;
    resizeRef.current = null;
    resizeActiveRef.current = false;
    if (resizeRafRef.current !== null) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
    preferenceChangedRef.current = true;
    paintResize(resize, latestClientXRef.current);
    setPreferredLayout(resizedLayout(resize, latestClientXRef.current));
    document.body.classList.remove('pane-resizing');
    document.dispatchEvent(new Event('better-email:pane-resize-end'));
    if (
      resize.captureTarget
      && resize.pointerId !== null
      && resize.captureTarget.hasPointerCapture(resize.pointerId)
    ) {
      resize.captureTarget.releasePointerCapture(resize.pointerId);
    }
  }, [paintResize, resizedLayout]);

  useEffect(() => {
    window.addEventListener('blur', finishResize);
    return () => {
      window.removeEventListener('blur', finishResize);
      finishResize();
      document.body.classList.remove('pane-resizing');
    };
  }, [finishResize]);

  const beginResize = useCallback((
    pane: ResizablePane,
    clientX: number,
    captureTarget: HTMLButtonElement | null = null,
    pointerId: number | null = null,
  ) => {
    latestClientXRef.current = clientX;
    resizeRef.current = {
      pane,
      startX: clientX,
      origin: appLayout,
      captureTarget,
      pointerId,
      surface: captureTarget?.closest<HTMLElement>('.app-shell') ?? null,
    };
    resizeActiveRef.current = true;
    document.body.classList.add('pane-resizing');
  }, [appLayout]);

  const beginLayoutResize = useCallback((
    pane: ResizablePane,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginResize(pane, event.clientX, event.currentTarget, event.pointerId);
  }, [beginResize]);

  const beginLayoutMouseResize = useCallback((
    pane: ResizablePane,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    if (resizeRef.current) return;
    beginResize(pane, event.clientX, event.currentTarget);
  }, [beginResize]);

  const moveResize = useCallback((clientX: number) => {
    const resize = resizeRef.current;
    if (!resize) return;
    latestClientXRef.current = clientX;
    if (resizeRafRef.current !== null) return;
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null;
      const currentResize = resizeRef.current;
      if (currentResize) {
        paintResize(currentResize, latestClientXRef.current);
      }
    });
  }, [paintResize]);

  const moveLayoutResize = useCallback((event: PointerEvent<HTMLElement>) => {
    moveResize(event.clientX);
  }, [moveResize]);

  const moveLayoutMouseResize = useCallback((event: MouseEvent<HTMLElement>) => {
    moveResize(event.clientX);
  }, [moveResize]);

  const endLayoutResize = useCallback((_event: PointerEvent<HTMLElement>) => {
    finishResize();
  }, [finishResize]);

  const endLayoutMouseResize = useCallback(() => {
    finishResize();
  }, [finishResize]);

  const resetAppLayout = useCallback(() => {
    preferenceChangedRef.current = true;
    setPreferredLayout(null);
  }, []);

  return {
    appLayout,
    beginLayoutResize,
    beginLayoutMouseResize,
    moveLayoutResize,
    moveLayoutMouseResize,
    endLayoutResize,
    endLayoutMouseResize,
    adjustAppLayout,
    resetAppLayoutPane,
    resetAppLayout,
  };
}

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
  clampNumber,
  defaultAppLayout,
  legacyAppLayoutStorageKey,
  loadAppLayout,
} from '../app/appConfig';

type ResizablePane = 'sidebar' | 'list';

export const APP_LAYOUT_BOUNDS = {
  sidebar: { min: 228, max: 320 },
  list: { min: 340, max: 500 },
} as const;

type LayoutResize = {
  pane: ResizablePane;
  startX: number;
  origin: AppLayout;
  captureTarget: HTMLButtonElement | null;
  pointerId: number | null;
};

export default function useAppLayout() {
  const [appLayout, setAppLayout] = useState<AppLayout>(loadAppLayout);
  const resizeRef = useRef<LayoutResize | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const resizeActiveRef = useRef(false);
  const latestClientXRef = useRef(0);

  useEffect(() => {
    if (resizeActiveRef.current) return;
    if (
      window.localStorage.getItem(appLayoutStorageKey) == null &&
      window.localStorage.getItem(legacyAppLayoutStorageKey) != null
    ) {
      return;
    }
    window.localStorage.setItem(appLayoutStorageKey, JSON.stringify(appLayout));
  }, [appLayout]);

  const applyResize = useCallback((resize: LayoutResize, clientX: number) => {
    const delta = clientX - resize.startX;
    if (resize.pane === 'sidebar') {
      setAppLayout({
        ...resize.origin,
        sidebar: clampNumber(
          resize.origin.sidebar + delta,
          APP_LAYOUT_BOUNDS.sidebar.min,
          APP_LAYOUT_BOUNDS.sidebar.max,
        ),
      });
      return;
    }
    setAppLayout({
      ...resize.origin,
      list: clampNumber(
        resize.origin.list + delta,
        APP_LAYOUT_BOUNDS.list.min,
        APP_LAYOUT_BOUNDS.list.max,
      ),
    });
  }, []);

  const adjustAppLayout = useCallback((pane: ResizablePane, delta: number) => {
    const bounds = APP_LAYOUT_BOUNDS[pane];
    setAppLayout((current) => ({
      ...current,
      [pane]: clampNumber(current[pane] + delta, bounds.min, bounds.max),
    }));
  }, []);

  const resetAppLayoutPane = useCallback((pane: ResizablePane) => {
    setAppLayout((current) => ({
      ...current,
      [pane]: defaultAppLayout[pane],
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
    applyResize(resize, latestClientXRef.current);
    document.body.classList.remove('pane-resizing');
    if (
      resize.captureTarget
      && resize.pointerId !== null
      && resize.captureTarget.hasPointerCapture(resize.pointerId)
    ) {
      resize.captureTarget.releasePointerCapture(resize.pointerId);
    }
  }, [applyResize]);

  useEffect(() => () => {
    finishResize();
    document.body.classList.remove('pane-resizing');
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
    beginResize(pane, event.clientX);
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
        applyResize(currentResize, latestClientXRef.current);
      }
    });
  }, [applyResize]);

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
    setAppLayout(defaultAppLayout);
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

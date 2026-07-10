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
  loadAppLayout,
} from '../app/appConfig';

type ResizablePane = 'sidebar' | 'list';

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

  useEffect(() => {
    window.localStorage.setItem(appLayoutStorageKey, JSON.stringify(appLayout));
  }, [appLayout]);

  const finishResize = useCallback(() => {
    const resize = resizeRef.current;
    if (!resize) return;
    resizeRef.current = null;
    document.body.classList.remove('pane-resizing');
    if (
      resize.captureTarget
      && resize.pointerId !== null
      && resize.captureTarget.hasPointerCapture(resize.pointerId)
    ) {
      resize.captureTarget.releasePointerCapture(resize.pointerId);
    }
  }, []);

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
    resizeRef.current = {
      pane,
      startX: clientX,
      origin: appLayout,
      captureTarget,
      pointerId,
    };
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
    const delta = clientX - resize.startX;
    if (resize.pane === 'sidebar') {
      setAppLayout({
        ...resize.origin,
        sidebar: clampNumber(resize.origin.sidebar + delta, 228, 320),
      });
      return;
    }
    setAppLayout({
      ...resize.origin,
      list: clampNumber(resize.origin.list + delta, 340, 500),
    });
  }, []);

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
    resetAppLayout,
  };
}

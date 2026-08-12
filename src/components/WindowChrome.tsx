import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import { getCurrentWindow, LogicalPosition } from '@tauri-apps/api/window';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';
import { logError } from '../app/logger';

type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'web';

export function detectDesktopPlatform(): DesktopPlatform {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    return 'web';
  }
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  if (platform.includes('mac') || userAgent.includes('mac os')) return 'macos';
  if (platform.includes('win') || userAgent.includes('windows')) return 'windows';
  return 'linux';
}

/** The pointer must travel this far before a drag starts, so plain clicks
 *  and double-clicks on the strip keep working. */
const DRAG_START_DISTANCE_PX = 4;

type DragPointerStart = {
  pointerId: number;
  x: number;
  y: number;
};

/** Manual setPosition drag, engaged only when the native startDragging()
 *  drag fails to move the window (async IPC can miss the event context on
 *  transparent macOS windows). */
type DragState = {
  startX: number;
  startY: number;
  winX: number;
  winY: number;
};

/**
 * Custom window chrome for the frameless/transparent window:
 * - macOS: the overlay title bar draws traffic lights at the top-left; the
 *   top strip and the sidebar brand row drag the window.
 * - Windows/Linux: hide the native decorations (window_chrome_ready), render
 *   minimize/maximize/close controls at the top-right.
 *
 * Dragging mirrors the better-douyin shell: pointerdown only records the
 * gesture, and once the pointer moves past DRAG_START_DISTANCE_PX the native
 * startDragging() takes over. Double-clicking the strip toggles
 * maximize/restore. If the window never starts moving (native drag failed),
 * a manual setPosition drag (LogicalPosition, so retina scaling is handled)
 * takes over.
 */
export default function WindowChrome() {
  const platform = detectDesktopPlatform();
  const dragPointerStartRef = useRef<DragPointerStart | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (platform === 'web') return undefined;
    document.body.classList.add(`platform-${platform}`);
    void invoke(IPC.WindowChromeReady).catch((error) => {
      logError('Failed to apply native window chrome', error);
    });
    return () => {
      document.body.classList.remove(`platform-${platform}`);
    };
  }, [platform]);

  useEffect(() => {
    if (platform === 'web') return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.screenX - drag.startX;
      const dy = event.screenY - drag.startY;
      if (dx === 0 && dy === 0) return;
      void getCurrentWindow()
        .setPosition(new LogicalPosition(drag.winX + dx, drag.winY + dy))
        .catch(() => undefined);
    };

    const handleMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', () => {
      dragRef.current = null;
    });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', () => {
        dragRef.current = null;
      });
    };
  }, [platform]);

  if (platform === 'web') return null;

  const clearDragPointerStart = () => {
    dragPointerStartRef.current = null;
  };

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearDragPointerStart();
    if (event.button !== 0 || event.detail > 1) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    dragPointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handleDragPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragPointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId || event.buttons !== 1) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.hypot(deltaX, deltaY) < DRAG_START_DISTANCE_PX) return;
    clearDragPointerStart();
    void beginWindowDrag(event);
  };

  /**
   * Try the native drag first. If the window has not moved shortly after
   * (startDragging can silently no-op when the async IPC misses the mouse
   * event context, e.g. on transparent macOS windows), fall back to the
   * manual setPosition drag.
   */
  const beginWindowDrag = async (event: ReactPointerEvent<HTMLDivElement>) => {
    const tauriWindow = getCurrentWindow();
    const startX = event.screenX;
    const startY = event.screenY;
    let winX = 0;
    let winY = 0;
    try {
      const position = await tauriWindow.innerPosition();
      winX = position.x;
      winY = position.y;
    } catch {
      return;
    }
    try {
      await tauriWindow.startDragging();
    } catch {
      dragRef.current = { startX, startY, winX, winY };
      return;
    }
    const watchdog = window.setTimeout(() => {
      void tauriWindow.innerPosition().then((position) => {
        const moved = Math.hypot(position.x - winX, position.y - winY) > DRAG_START_DISTANCE_PX;
        if (!moved) {
          dragRef.current = { startX, startY, winX, winY };
        }
      });
    }, 300);
    window.addEventListener('mouseup', () => window.clearTimeout(watchdog), { once: true });
    window.addEventListener('blur', () => window.clearTimeout(watchdog), { once: true });
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    clearDragPointerStart();
    if (event.target instanceof Element && event.target.closest('button')) return;
    void toggleMaximize();
  };

  async function toggleMaximize() {
    const tauriWindow = getCurrentWindow();
    if (typeof tauriWindow.toggleMaximize === 'function') {
      await tauriWindow.toggleMaximize();
    } else if (await tauriWindow.isMaximized()) {
      await tauriWindow.unmaximize();
    } else {
      await tauriWindow.maximize();
    }
  }

  return (
    <div
      className={`window-chrome window-chrome-${platform}`}
      data-window-chrome
      role="presentation"
    >
      <div
        className="window-drag-region"
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={clearDragPointerStart}
        onPointerCancel={clearDragPointerStart}
        onDoubleClick={handleDoubleClick}
        role="presentation"
      />
      <div
        className="window-drag-region-side"
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={clearDragPointerStart}
        onPointerCancel={clearDragPointerStart}
        onDoubleClick={handleDoubleClick}
        role="presentation"
      />
      {platform !== 'macos' && (
        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            aria-label="最小化窗口"
            title="最小化"
            onClick={() => void getCurrentWindow().minimize()}
          >
            <Minus size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label="最大化或还原窗口"
            title="最大化或还原"
            onClick={() => void toggleMaximize()}
          >
            <Maximize2 size={13} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="window-control window-control-close"
            aria-label="关闭窗口"
            title="关闭"
            onClick={() => void getCurrentWindow().close()}
          >
            <X size={15} strokeWidth={1.7} />
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { invoke } from '../tauriBridge';

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
 * Dragging is implemented manually with setPosition instead of
 * startDragging: on macOS the native drag API goes through async IPC and
 * frequently misses the mousedown event context on transparent windows,
 * while setPosition always works.
 */
export default function WindowChrome() {
  const platform = detectDesktopPlatform();
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (platform === 'web') return undefined;
    document.body.classList.add(`platform-${platform}`);
    void invoke('window_chrome_ready').catch((error) => {
      console.error('Failed to apply native window chrome', error);
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
        .setPosition(new PhysicalPosition(drag.winX + dx, drag.winY + dy))
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

  const handleDragStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail > 1) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    const tauriWindow = getCurrentWindow();
    void tauriWindow.outerPosition().then((position) => {
      dragRef.current = {
        startX: event.screenX,
        startY: event.screenY,
        winX: position.x,
        winY: position.y,
      };
    });
  };

  async function toggleMaximize() {
    const tauriWindow = getCurrentWindow();
    if (await tauriWindow.isMaximized()) {
      await tauriWindow.unmaximize();
    } else {
      await tauriWindow.maximize();
    }
  }

  const handleDoubleClick = () => {
    if (platform !== 'macos') void toggleMaximize();
  };

  return (
    <div
      className={`window-chrome window-chrome-${platform}`}
      onDoubleClick={handleDoubleClick}
      role="presentation"
    >
      <div
        className="window-drag-region"
        onMouseDown={handleDragStart}
        role="presentation"
      />
      <div
        className="window-drag-region-side"
        onMouseDown={handleDragStart}
        role="presentation"
      />
      {platform !== 'macos' && (
        <div className="window-controls" data-no-window-drag>
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

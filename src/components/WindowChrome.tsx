import { useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { Maximize2, Minus, X } from 'lucide-react';
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

/**
 * Custom window chrome for the frameless/transparent window:
 * - macOS gets the system traffic lights from the overlay title bar; the
 *   top strip stays draggable.
 * - Windows/Linux hide the native decorations (window_chrome_ready) and
 *   render their own minimize / maximize / close controls.
 */
export default function WindowChrome() {
  const platform = detectDesktopPlatform();

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

  if (platform === 'web') return null;

  async function withCurrentWindow(action: (window: TauriWindow) => Promise<void>) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await action(getCurrentWindow());
  }

  async function toggleMaximize() {
    await withCurrentWindow(async (window) => {
      if (await window.isMaximized()) {
        await window.unmaximize();
      } else {
        await window.maximize();
      }
    });
  }

  const handleDrag = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail > 1) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    void withCurrentWindow((window) => window.startDragging()).catch((error) => {
      console.error('Failed to start window dragging', error);
    });
  };

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
        data-tauri-drag-region
        onMouseDown={handleDrag}
        role="presentation"
      />
      {platform !== 'macos' && (
        <div className="window-controls" data-no-window-drag>
          <button
            type="button"
            className="window-control"
            aria-label="最小化窗口"
            title="最小化"
            onClick={() => void withCurrentWindow((window) => window.minimize())}
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
            onClick={() => void withCurrentWindow((window) => window.close())}
          >
            <X size={15} strokeWidth={1.7} />
          </button>
        </div>
      )}
    </div>
  );
}

type TauriWindow = Awaited<ReturnType<typeof import('@tauri-apps/api/window')['getCurrentWindow']>>;

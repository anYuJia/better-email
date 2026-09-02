import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';
import { logError } from '../app/logger';

export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'web';

type TauriWindowModule = typeof import('@tauri-apps/api/window');
let tauriWindowModule: Promise<TauriWindowModule> | null = null;

function loadTauriWindowModule() {
  tauriWindowModule ??= import('@tauri-apps/api/window');
  return tauriWindowModule;
}

async function getCurrentTauriWindow() {
  const { getCurrentWindow } = await loadTauriWindowModule();
  return getCurrentWindow();
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function resolveDesktopPlatform(): Promise<DesktopPlatform> {
  if (!isTauriRuntime()) return 'web';
  const platform = await invoke<string>(IPC.GetPlatform);
  if (platform === 'macos' || platform === 'windows' || platform === 'linux') return platform;
  return 'web';
}

const DRAG_START_DISTANCE_PX = 4;

export function DesktopWindowDragRegion({
  platform,
  onToggleMaximize,
  className = '',
}: {
  platform: DesktopPlatform;
  onToggleMaximize: () => void;
  className?: string;
}) {
  const pointerStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const clearPointerStart = () => { pointerStartRef.current = null; };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearPointerStart();
    if (event.button !== 0 || event.detail > 1) return;
    if (event.target instanceof Element && event.target.closest('button, input, summary, [role="button"]')) return;
    pointerStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId || event.buttons !== 1) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_START_DISTANCE_PX) return;
    clearPointerStart();
    void getCurrentTauriWindow().then((window) => window.startDragging())
      .catch((error) => logError('Failed to drag native window', error));
  };

  return (
    <div
      className={`titlebar-drag-region window-drag-region window-drag-region-${platform} ${className}`.trim()}
      data-tauri-drag-region
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearPointerStart}
      onPointerCancel={clearPointerStart}
      onDoubleClick={() => {
        clearPointerStart();
        if (platform === 'windows') onToggleMaximize();
      }}
      role="presentation"
    />
  );
}

export function useDesktopWindowChrome(testPlatform?: DesktopPlatform) {
  const [platform, setPlatform] = useState<DesktopPlatform>(testPlatform ?? 'web');
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    if (testPlatform) {
      setPlatform(testPlatform);
      return () => { active = false; };
    }
    if (!isTauriRuntime()) return undefined;
    void invoke(IPC.WindowChromeReady).catch((error) => logError('Failed to apply native window chrome', error));
    void resolveDesktopPlatform().then((resolved) => { if (active) setPlatform(resolved); })
      .catch((error) => logError('Failed to resolve native platform', error));
    return () => { active = false; };
  }, [testPlatform]);

  useEffect(() => {
    if (platform !== 'windows' || (!isTauriRuntime() && !testPlatform)) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = async () => {
      const window = await getCurrentTauriWindow();
      const maximized = await window.isMaximized();
      if (active) setIsMaximized(maximized);
    };
    void sync().catch((error) => logError('Failed to read native maximize state', error));
    void getCurrentTauriWindow().then(async (window) => {
      if (typeof window.onResized !== 'function') return;
      unlisten = await window.onResized(() => { void sync().catch(() => undefined); });
    }).catch((error) => logError('Failed to listen for native resize state', error));
    return () => { active = false; unlisten?.(); };
  }, [platform, testPlatform]);

  const toggleMaximize = async () => {
    try {
      const window = await getCurrentTauriWindow();
      await window.toggleMaximize();
      setIsMaximized(await window.isMaximized());
    } catch (error) {
      logError('Failed to toggle native maximize state', error);
    }
  };

  return { platform, isMaximized, toggleMaximize, isNativeTitlebar: platform !== 'web' };
}

export function DesktopWindowControls({
  platform,
  isMaximized,
  onToggleMaximize,
}: {
  platform: DesktopPlatform;
  isMaximized: boolean;
  onToggleMaximize: () => void;
}) {
  if (platform !== 'windows') return null;
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button type="button" className="window-control" aria-label="最小化" title="最小化" onClick={() => {
        void getCurrentTauriWindow().then((window) => window.minimize())
          .catch((error) => logError('Failed to minimize native window', error));
      }}><Minus size={15} strokeWidth={1.7} aria-hidden="true" /></button>
      <button type="button" className="window-control" aria-label={isMaximized ? '还原' : '最大化'} title={isMaximized ? '还原' : '最大化'} onClick={onToggleMaximize}>
        {isMaximized ? <Copy size={13} strokeWidth={1.7} aria-hidden="true" /> : <Square size={13} strokeWidth={1.7} aria-hidden="true" />}
      </button>
      <button type="button" className="window-control window-control-close" aria-label="关闭" title="关闭" onClick={() => {
        void getCurrentTauriWindow().then((window) => window.close())
          .catch((error) => logError('Failed to close native window', error));
      }}><X size={15} strokeWidth={1.7} aria-hidden="true" /></button>
    </div>
  );
}

export function DesktopWindowChrome({
  className = '',
  left,
  center,
  right,
  testPlatform,
}: {
  className?: string;
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  testPlatform?: DesktopPlatform;
}) {
  const { platform, isMaximized, toggleMaximize, isNativeTitlebar } = useDesktopWindowChrome(testPlatform);
  return (
    <header className={`window-chrome desktop-window-chrome window-chrome-${platform} ${className}`.trim()} data-window-chrome>
      <div className="app-titlebar-grid">
        <div className="titlebar-left">
          {isNativeTitlebar && <DesktopWindowDragRegion platform={platform} onToggleMaximize={() => { void toggleMaximize(); }} className="titlebar-left-drag" />}
          {left}
        </div>
        <div className="titlebar-center">{center}</div>
        <div className="titlebar-right">
          {isNativeTitlebar && <DesktopWindowDragRegion platform={platform} onToggleMaximize={() => { void toggleMaximize(); }} className="titlebar-right-drag" />}
          {right}
          <DesktopWindowControls platform={platform} isMaximized={isMaximized} onToggleMaximize={() => { void toggleMaximize(); }} />
        </div>
      </div>
    </header>
  );
}

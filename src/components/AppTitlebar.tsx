import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Copy, Minus, RefreshCw, Square, X } from 'lucide-react';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';
import { logError } from '../app/logger';
import GlobalSearch, { type GlobalSearchProps } from './GlobalSearch';

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

/**
 * Browser tests and preview builds never infer an OS from the browser
 * identity. Native builds ask the Rust side, where cfg(target_os) is the
 * source of truth. The optional override is intentionally test-only.
 */
export function detectDesktopPlatform(testPlatform?: DesktopPlatform): DesktopPlatform {
  if (import.meta.env.MODE === 'test' && testPlatform) return testPlatform;
  return 'web';
}

async function resolveDesktopPlatform(): Promise<DesktopPlatform> {
  if (!isTauriRuntime()) return 'web';
  const platform = await invoke<string>(IPC.GetPlatform);
  if (platform === 'macos' || platform === 'windows' || platform === 'linux') return platform;
  return 'web';
}

type AppTitlebarProps = Omit<GlobalSearchProps, 'shortcutLabel'> & {
  isRefreshing?: boolean;
  refreshNotice?: string | null;
  onRefresh: () => void;
  /** Used only by component tests; production platform comes from Rust. */
  testPlatform?: DesktopPlatform;
};

type DragRegionProps = {
  platform: DesktopPlatform;
  onToggleMaximize: () => void;
  className?: string;
};

const DRAG_START_DISTANCE_PX = 4;

function TitlebarDragRegion({ platform, onToggleMaximize, className = '' }: DragRegionProps) {
  const pointerStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const clearPointerStart = () => {
    pointerStartRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearPointerStart();
    if (event.button !== 0 || event.detail > 1) return;
    if (event.target instanceof Element && event.target.closest('button, input, summary, [role="button"]')) return;
    pointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || start.pointerId !== event.pointerId || event.buttons !== 1) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.hypot(deltaX, deltaY) < DRAG_START_DISTANCE_PX) return;
    clearPointerStart();
    void getCurrentTauriWindow()
      .then((tauriWindow) => tauriWindow.startDragging())
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

export default function AppTitlebar({
  searchInputRef,
  query,
  appliedQuery,
  searchScope,
  filter,
  messages,
  onSearchSubmit,
  onQueryChange,
  onSearchScopeChange,
  onClearSearchAndFilter,
  onApplySearchShortcut,
  isRefreshing = false,
  refreshNotice = null,
  onRefresh,
  testPlatform,
}: AppTitlebarProps) {
  const testPlatformOverride = import.meta.env.MODE === 'test' ? testPlatform : undefined;
  const [platform, setPlatform] = useState<DesktopPlatform>(() => detectDesktopPlatform(testPlatformOverride));
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    if (testPlatformOverride) {
      setPlatform(testPlatformOverride);
      return () => {
        active = false;
      };
    }
    if (!isTauriRuntime()) return undefined;

    void invoke(IPC.WindowChromeReady).catch((error) => {
      logError('Failed to apply native window chrome', error);
    });
    void resolveDesktopPlatform()
      .then((resolvedPlatform) => {
        if (active) setPlatform(resolvedPlatform);
      })
      .catch((error) => logError('Failed to resolve native platform', error));

    return () => {
      active = false;
    };
  }, [testPlatformOverride]);

  useEffect(() => {
    const platformClasses: DesktopPlatform[] = ['macos', 'windows', 'linux', 'web'];
    platformClasses.forEach((item) => document.body.classList.remove(`platform-${item}`));
    if (platform !== 'web') document.body.classList.add(`platform-${platform}`);
    return () => {
      platformClasses.forEach((item) => document.body.classList.remove(`platform-${item}`));
    };
  }, [platform]);

  useEffect(() => {
    if (platform !== 'windows' || (!isTauriRuntime() && !testPlatformOverride)) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;

    async function syncMaximizedState() {
      const tauriWindow = await getCurrentTauriWindow();
      const nextMaximized = await tauriWindow.isMaximized();
      if (active) setIsMaximized(nextMaximized);
    }

    void syncMaximizedState().catch((error) => logError('Failed to read native maximize state', error));
    void getCurrentTauriWindow()
      .then(async (tauriWindow) => {
        if (typeof tauriWindow.onResized !== 'function') return;
        unlisten = await tauriWindow.onResized(() => {
          void syncMaximizedState().catch(() => undefined);
        });
      })
      .catch((error) => logError('Failed to listen for native resize state', error));

    return () => {
      active = false;
      unlisten?.();
    };
  }, [platform, testPlatformOverride]);

  const toggleMaximize = async () => {
    try {
      const tauriWindow = await getCurrentTauriWindow();
      await tauriWindow.toggleMaximize();
      setIsMaximized(await tauriWindow.isMaximized());
    } catch (error) {
      logError('Failed to toggle native maximize state', error);
    }
  };

  const shortcutLabel = platform === 'macos' ? '⌘K' : platform === 'windows' ? 'Ctrl K' : '⌘/Ctrl K';
  const isNativeTitlebar = platform !== 'web';

  return (
    <header
      className={`app-titlebar window-chrome app-titlebar-${platform} window-chrome-${platform}`}
      data-window-chrome
      role="banner"
    >
      <div className="app-titlebar-grid">
        <div className="titlebar-left">
          {isNativeTitlebar && (
            <TitlebarDragRegion platform={platform} onToggleMaximize={() => { void toggleMaximize(); }} className="titlebar-left-drag" />
          )}
          <div className="titlebar-brand">
            <img
              src="/brand/v4/brand-mark-64.png"
              alt=""
              width={22}
              height={22}
              draggable={false}
            />
            <span>Better Email</span>
          </div>
        </div>

        <div className="titlebar-center">
          <GlobalSearch
            searchInputRef={searchInputRef}
            query={query}
            appliedQuery={appliedQuery}
            searchScope={searchScope}
            filter={filter}
            messages={messages}
            shortcutLabel={shortcutLabel}
            onSearchSubmit={onSearchSubmit}
            onQueryChange={onQueryChange}
            onSearchScopeChange={onSearchScopeChange}
            onClearSearchAndFilter={onClearSearchAndFilter}
            onApplySearchShortcut={onApplySearchShortcut}
          />
        </div>

        <div className="titlebar-right">
          {isNativeTitlebar && (
            <TitlebarDragRegion platform={platform} onToggleMaximize={() => { void toggleMaximize(); }} className="titlebar-right-drag" />
          )}
          <button
            type="button"
            className={isRefreshing ? 'titlebar-refresh refreshing' : 'titlebar-refresh'}
            aria-label="刷新邮件"
            aria-busy={isRefreshing}
            title={isRefreshing ? (refreshNotice || '正在同步邮件') : '刷新邮件'}
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshCw size={15} aria-hidden="true" className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          {isRefreshing && (
            <span className="titlebar-sync-status" role="status" aria-live="polite">
              {refreshNotice || '同步中'}
            </span>
          )}
          {platform === 'windows' && (
            <div className="window-controls" aria-label="窗口控制">
              <button
                type="button"
                className="window-control"
                aria-label="最小化"
                title="最小化"
                onClick={() => {
                  void getCurrentTauriWindow().then((tauriWindow) => tauriWindow.minimize())
                    .catch((error) => logError('Failed to minimize native window', error));
                }}
              >
                <Minus size={15} strokeWidth={1.7} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="window-control"
                aria-label={isMaximized ? '还原' : '最大化'}
                title={isMaximized ? '还原' : '最大化'}
                onClick={() => { void toggleMaximize(); }}
              >
                {isMaximized
                  ? <Copy size={13} strokeWidth={1.7} aria-hidden="true" />
                  : <Square size={13} strokeWidth={1.7} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="window-control window-control-close"
                aria-label="关闭"
                title="关闭"
                onClick={() => {
                  void getCurrentTauriWindow().then((tauriWindow) => tauriWindow.close())
                    .catch((error) => logError('Failed to close native window', error));
                }}
              >
                <X size={15} strokeWidth={1.7} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

import type { Monitor, Window as NativeWindow } from '@tauri-apps/api/window';

const KEY = 'better-email-native-composer-geometry-v1';
type SavedGeometry = { x: number; y: number; width: number; height: number };

function readGeometry(): SavedGeometry | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    return value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))
      && value.width > 0 && value.height > 0 ? value : null;
  } catch { return null; }
}

/** Stored coordinates are physical, while dimensions are logical. Select the
 * surviving monitor before converting to its scale; disconnected screens fall
 * back to the primary work area, keeping the titlebar and controls reachable. */
export function nativeComposerPlacement(monitors: Monitor[], primary: Monitor | null) {
  const saved = readGeometry();
  const monitor = saved && monitors.find(item => {
    const { position, size } = item.workArea;
    return saved.x >= position.x && saved.x < position.x + size.width
      && saved.y >= position.y && saved.y < position.y + size.height;
  }) || primary || monitors[0];
  if (!monitor) return { width: 960, height: 700, minWidth: 760, minHeight: 560 };
  const scale = monitor.scaleFactor;
  const area = monitor.workArea;
  const margin = 16;
  const availableWidth = Math.max(320, area.size.width / scale - margin * 2);
  const availableHeight = Math.max(320, area.size.height / scale - margin * 2);
  const minWidth = Math.min(760, availableWidth);
  const minHeight = Math.min(560, availableHeight);
  const width = Math.min(availableWidth, Math.max(minWidth, saved?.width || 960));
  const height = Math.min(availableHeight, Math.max(minHeight, saved?.height || 700));
  const left = area.position.x / scale + margin;
  const top = area.position.y / scale + margin;
  const x = Math.min(left + availableWidth - width, Math.max(left, saved ? saved.x / scale : left + (availableWidth - width) / 2));
  const y = Math.min(top + availableHeight - height, Math.max(top, saved ? saved.y / scale : top + (availableHeight - height) / 2));
  return { x, y, width, height, minWidth, minHeight };
}

/** Capture OS-managed moves/resizes once they settle, never on every event. */
export async function rememberNativeComposerGeometry(window: NativeWindow) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let disposed = false;
  const unlisteners: Array<() => void> = [];
  const capture = async () => {
    const revision = ++generation;
    try {
      const [position, size, scale, maximized, minimized] = await Promise.all([
        window.outerPosition(), window.innerSize(), window.scaleFactor(), window.isMaximized(), window.isMinimized(),
      ]);
      if (disposed || revision !== generation || maximized || minimized || size.width <= 0 || size.height <= 0) return;
      localStorage.setItem(KEY, JSON.stringify({ x: position.x, y: position.y, width: size.width / scale, height: size.height / scale }));
    } catch { /* Workspace preferences must never block opening a draft. */ }
  };
  const schedule = () => {
    generation++;
    clearTimeout(timer);
    timer = setTimeout(() => { void capture(); }, 180);
  };
  const dispose = () => {
    disposed = true;
    generation++;
    clearTimeout(timer);
    unlisteners.splice(0).forEach(unlisten => unlisten());
  };
  try {
    for (const subscribe of [
      () => window.onMoved(schedule),
      () => window.onResized(schedule),
      () => window.onCloseRequested(() => { clearTimeout(timer); void capture(); }),
      () => window.once('tauri://destroyed', dispose),
    ]) {
      const unlisten = await subscribe();
      if (disposed) unlisten(); else unlisteners.push(unlisten);
    }
  } catch { dispose(); }
  return dispose;
}

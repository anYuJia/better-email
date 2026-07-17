type InvokeArgs = Record<string, unknown> | undefined;
type TauriCore = typeof import('@tauri-apps/api/core');
type TauriWindow = typeof import('@tauri-apps/api/window');
type TauriNotification = typeof import('@tauri-apps/plugin-notification');
type DesktopFileDropEvent =
  | { type: 'enter'; paths: string[]; position?: unknown }
  | { type: 'over'; position?: unknown }
  | { type: 'drop'; paths: string[]; position?: unknown }
  | { type: 'leave' };
type DesktopFileDropHandler = (event: DesktopFileDropEvent) => void;

let coreModule: Promise<TauriCore> | null = null;
let windowModule: Promise<TauriWindow> | null = null;
let notificationModule: Promise<TauriNotification> | null = null;

function loadCore() {
  coreModule ??= import('@tauri-apps/api/core');
  return coreModule;
}

function loadWindow() {
  windowModule ??= import('@tauri-apps/api/window');
  return windowModule;
}

function loadNotification() {
  notificationModule ??= import('@tauri-apps/plugin-notification');
  return notificationModule;
}

export function prodInvoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  return loadCore().then(({ invoke: tauriInvoke }) => tauriInvoke<T>(command, args));
}

export async function prodLocalFileAssetUrl(localPath: string): Promise<string> {
  const normalizedPath = localPath.trim();
  if (!normalizedPath) return '';
  const { convertFileSrc } = await loadCore();
  return convertFileSrc(normalizedPath);
}

export function prodGetCurrentWindow() {
  return {
    setBadgeCount: async (count?: number) => {
      const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
      return getTauriCurrentWindow().setBadgeCount(count);
    },
    setBadgeLabel: async (label?: string) => {
      const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
      return getTauriCurrentWindow().setBadgeLabel(label);
    },
    onDragDropEvent: async (handler: DesktopFileDropHandler) => {
      const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
      return getTauriCurrentWindow().onDragDropEvent((event) => handler(event.payload as unknown as DesktopFileDropEvent));
    },
  };
}

export function prodIsPermissionGranted(): Promise<boolean> {
  return loadNotification().then(({ isPermissionGranted }) => isPermissionGranted());
}

export function prodRequestPermission(): Promise<string> {
  return loadNotification().then(({ requestPermission: tauriRequestPermission }) => tauriRequestPermission());
}

type TauriEvent = typeof import('@tauri-apps/api/event');
let eventModule: Promise<TauriEvent> | null = null;

function loadEvent() {
  eventModule ??= import('@tauri-apps/api/event');
  return eventModule;
}

export function prodSendNotification(notification: { title: string; body?: string }) {
  void loadNotification().then(({ sendNotification: tauriSendNotification }) => tauriSendNotification(notification));
}

export async function prodListen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  const { listen: tauriListen } = await loadEvent();
  return tauriListen<T>(event, handler);
}

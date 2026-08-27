import type {
  ComposerWindowRequest,
  NativeCloseRequestEvent,
} from './app/composerWindow';
import {
  COMPOSER_OPEN_EVENT,
  COMPOSER_WINDOW_LABEL,
} from './app/composerWindow';
import { IPC } from './ipc/commands';

type InvokeArgs = Record<string, unknown> | undefined;
type TauriCore = typeof import('@tauri-apps/api/core');
type TauriWindow = typeof import('@tauri-apps/api/window');
type TauriWebviewWindow = typeof import('@tauri-apps/api/webviewWindow');
type TauriNotification = typeof import('@tauri-apps/plugin-notification');
type DesktopFileDropEvent =
  | { type: 'enter'; paths: string[]; position?: unknown }
  | { type: 'over'; position?: unknown }
  | { type: 'drop'; paths: string[]; position?: unknown }
  | { type: 'leave' };
type DesktopFileDropHandler = (event: DesktopFileDropEvent) => void;

let coreModule: Promise<TauriCore> | null = null;
let windowModule: Promise<TauriWindow> | null = null;
let webviewWindowModule: Promise<TauriWebviewWindow> | null = null;
let notificationModule: Promise<TauriNotification> | null = null;

function loadCore() {
  coreModule ??= import('@tauri-apps/api/core');
  return coreModule;
}

function loadWindow() {
  windowModule ??= import('@tauri-apps/api/window');
  return windowModule;
}

function loadWebviewWindow() {
  webviewWindowModule ??= import('@tauri-apps/api/webviewWindow');
  return webviewWindowModule;
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
    onFocusChanged: async (handler: (focused: boolean) => void) => {
      const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
      // Tauri 的 onFocusChanged 回调携带 Event<boolean>；透传 payload，
      // 让调用方只在窗口真正获得焦点时刷新未读数，失焦不再触发 IPC。
      return getTauriCurrentWindow().onFocusChanged((event) => handler(event.payload));
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

let composerWindowCreation: Promise<void> | null = null;

async function focusComposerWindow(window: {
  show: () => Promise<void>;
  unminimize: () => Promise<void>;
  setFocus: () => Promise<void>;
}) {
  await window.show();
  await window.unminimize();
  await window.setFocus();
}

async function ensureComposerWindow(): Promise<void> {
  // If a prewarm/create is already running, wait for the real native window
  // creation event instead of treating a half-created WebviewWindow as ready.
  if (composerWindowCreation) {
    await composerWindowCreation;
    return;
  }

  const { WebviewWindow } = await loadWebviewWindow();
  const existing = await WebviewWindow.getByLabel(COMPOSER_WINDOW_LABEL);
  if (existing) return;

  const composeUrl = new URL(window.location.href);
  composeUrl.search = '?window=compose&prewarm=1';
  composeUrl.hash = '';
  const child = new WebviewWindow(COMPOSER_WINDOW_LABEL, {
    url: composeUrl.toString(),
    title: '写邮件',
    width: 960,
    height: 700,
    minWidth: 760,
    minHeight: 560,
    resizable: true,
    decorations: true,
    titleBarStyle: 'visible',
    hiddenTitle: false,
    focus: false,
    visible: false,
    skipTaskbar: false,
  });
  composerWindowCreation = new Promise<void>((resolve, reject) => {
    void child.once('tauri://created', () => resolve());
    void child.once('tauri://error', (event) => {
      reject(new Error(`无法创建独立写信窗口：${String(event.payload)}`));
    });
  });

  try {
    await composerWindowCreation;
  } finally {
    composerWindowCreation = null;
  }
}

export async function prodPrewarmComposerWindow(): Promise<void> {
  await ensureComposerWindow();
}

export async function prodOpenComposerWindow(request: ComposerWindowRequest): Promise<void> {
  // The pending request is authoritative. Events are only a wake-up signal and
  // may be emitted before the React side has finished booting.
  await prodInvoke<void>(IPC.SetPendingComposerRequest, { request });
  await ensureComposerWindow();

  const { WebviewWindow } = await loadWebviewWindow();
  const composerWindow = await WebviewWindow.getByLabel(COMPOSER_WINDOW_LABEL);
  if (!composerWindow) {
    throw new Error('独立写信窗口创建完成后仍不可用');
  }

  await composerWindow.emit(COMPOSER_OPEN_EVENT);
  // Always show/focus on an explicit user action. The standalone app consumes
  // the pending request on boot/event/focus, so a lost wake-up event cannot
  // leave the native window permanently hidden.
  await focusComposerWindow(composerWindow);
}

export async function prodShowCurrentWindow(): Promise<void> {
  const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
  await focusComposerWindow(getTauriCurrentWindow());
}

export function prodTakePendingComposerRequest(): Promise<ComposerWindowRequest | null> {
  return prodInvoke<ComposerWindowRequest | null>(IPC.TakePendingComposerRequest);
}

export async function prodListenCurrentWindow<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
  return getTauriCurrentWindow().listen<T>(event, handler);
}

export async function prodEmitToMain<T>(event: string, payload?: T): Promise<void> {
  const { emitTo } = await loadEvent();
  await emitTo('main', event, payload);
}

export async function prodCloseCurrentWindow(): Promise<void> {
  const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
  const currentWindow = getTauriCurrentWindow();
  if (currentWindow.label === COMPOSER_WINDOW_LABEL) {
    await currentWindow.hide();
    return;
  }
  await currentWindow.destroy();
}

export async function prodOnCurrentWindowCloseRequested(
  handler: (event: NativeCloseRequestEvent) => void,
): Promise<() => void> {
  const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
  return getTauriCurrentWindow().onCloseRequested(handler);
}

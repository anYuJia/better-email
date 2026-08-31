import type {
  ComposerWindowRequest,
  NativeCloseRequestEvent,
} from './app/composerWindow';
import {
  COMPOSER_OPEN_EVENT,
  COMPOSER_READY_EVENT,
  COMPOSER_READY_QUERY_EVENT,
  COMPOSER_WINDOW_LABEL,
} from './app/composerWindow';
import type { SettingsWindowRequest } from './app/settingsWindow';
import { DEFAULT_SETTINGS_SECTION } from './app/settingsWindow';
import {
  SETTINGS_OPEN_EVENT,
  SETTINGS_READY_EVENT,
  SETTINGS_READY_QUERY_EVENT,
  SETTINGS_WINDOW_LABEL,
} from './app/settingsWindow';
import type { AccountScope } from './app/types';
import { IPC } from './ipc/commands';

type InvokeArgs = Record<string, unknown> | undefined;
type TauriCore = typeof import('@tauri-apps/api/core');
type TauriDpi = typeof import('@tauri-apps/api/dpi');
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
let dpiModule: Promise<TauriDpi> | null = null;
let windowModule: Promise<TauriWindow> | null = null;
let webviewWindowModule: Promise<TauriWebviewWindow> | null = null;
let notificationModule: Promise<TauriNotification> | null = null;

function loadCore() {
  coreModule ??= import('@tauri-apps/api/core');
  return coreModule;
}

function loadDpi() {
  dpiModule ??= import('@tauri-apps/api/dpi');
  return dpiModule;
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
let composerWindowReady: Promise<void> | null = null;
const COMPOSER_READY_TIMEOUT_MS = 15_000;

type ComposerNativeWindow = {
  emit: (event: string, payload?: unknown) => Promise<void>;
  show: () => Promise<void>;
  unminimize: () => Promise<void>;
  setFocus: () => Promise<void>;
};

async function focusComposerWindow(window: ComposerNativeWindow) {
  await window.show();
  await window.unminimize();
  await window.setFocus();
}

async function waitForComposerWindowReady(composerWindow: ComposerNativeWindow): Promise<void> {
  if (!composerWindowReady) {
    const readyWait = (async () => {
      const { listen: tauriListen } = await loadEvent();
      let resolveReady: (() => void) | undefined;
      let timeoutId: number | undefined;
      const readySignal = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const unlisten = await tauriListen<void>(COMPOSER_READY_EVENT, () => {
        resolveReady?.();
      });

      try {
        // A prewarmed window may already be ready before the main window starts
        // waiting. Querying it closes that lost-signal gap.
        await composerWindow.emit(COMPOSER_READY_QUERY_EVENT);
        await Promise.race([
          readySignal,
          new Promise<never>((_resolve, reject) => {
            timeoutId = window.setTimeout(() => {
              reject(new Error('写信窗口初始化超时，请重试'));
            }, COMPOSER_READY_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        unlisten();
      }
    })();
    composerWindowReady = readyWait;
  }

  const currentReadyWait = composerWindowReady;
  try {
    await currentReadyWait;
  } catch (error) {
    if (composerWindowReady === currentReadyWait) composerWindowReady = null;
    throw error;
  }
}

async function ensureComposerWindow(): Promise<void> {
  // If a prewarm/create is already running, wait for the same single-flight
  // operation instead of treating a half-created WebviewWindow as ready.
  if (composerWindowCreation) {
    await composerWindowCreation;
    return;
  }

  // Assign the promise before the first await. The prewarm effect and a user
  // click can enter this function in the same turn; both must share one
  // native-window creation rather than racing to create two windows.
  const creation = (async () => {
    const { WebviewWindow } = await loadWebviewWindow();
    const existing = await WebviewWindow.getByLabel(COMPOSER_WINDOW_LABEL);
    if (existing) return;

    // A previous composer may have been destroyed as a close fallback. Its
    // readiness must never be reused for the replacement window.
    composerWindowReady = null;
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
    await new Promise<void>((resolve, reject) => {
      void child.once('tauri://created', () => resolve());
      void child.once('tauri://error', (event) => {
        reject(new Error(`无法创建独立写信窗口：${String(event.payload)}`));
      });
    });
  })();
  composerWindowCreation = creation;

  try {
    await creation;
  } finally {
    if (composerWindowCreation === creation) composerWindowCreation = null;
  }
}

async function getComposerWindow(): Promise<ComposerNativeWindow> {
  const { WebviewWindow } = await loadWebviewWindow();
  const composerWindow = await WebviewWindow.getByLabel(COMPOSER_WINDOW_LABEL);
  if (!composerWindow) {
    throw new Error('独立写信窗口创建完成后仍不可用');
  }
  return composerWindow;
}

export async function prodPrewarmComposerWindow(): Promise<void> {
  await ensureComposerWindow();
  await waitForComposerWindowReady(await getComposerWindow());
}

export async function prodOpenComposerWindow(request: ComposerWindowRequest): Promise<void> {
  // The pending request is authoritative. Events are only a wake-up signal and
  // may be emitted before the React side has finished booting.
  await prodInvoke<void>(IPC.SetPendingComposerRequest, { request });
  await ensureComposerWindow();

  const composerWindow = await getComposerWindow();

  await composerWindow.emit(COMPOSER_OPEN_EVENT);
  await waitForComposerWindowReady(composerWindow);
  // Emit again after readiness. The first signal covers requests arriving
  // during boot; the second covers a listener that was not registered yet.
  // The composer reveals itself only after its UI and close handler are ready,
  // so the main window never exposes a blank WebView.
  await composerWindow.emit(COMPOSER_OPEN_EVENT);
}

let settingsWindowCreation: Promise<void> | null = null;
let settingsWindowReady: Promise<void> | null = null;
const SETTINGS_READY_TIMEOUT_MS = 15_000;

async function ensureSettingsWindow(request: SettingsWindowRequest): Promise<void> {
  if (settingsWindowCreation) {
    await settingsWindowCreation;
    return;
  }

  const creation = (async () => {
    const [{ WebviewWindow }, { LogicalPosition }] = await Promise.all([
      loadWebviewWindow(),
      loadDpi(),
    ]);
    const existing = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL);
    if (existing) return;

    settingsWindowReady = null;
    const settingsUrl = new URL(window.location.href);
    settingsUrl.search = '';
    settingsUrl.searchParams.set('window', 'settings');
    settingsUrl.searchParams.set('section', request.section || DEFAULT_SETTINGS_SECTION);
    if (request.accountScope !== undefined) {
      settingsUrl.searchParams.set('scope', String(request.accountScope));
    }
    settingsUrl.hash = '';
    const child = new WebviewWindow(SETTINGS_WINDOW_LABEL, {
      url: settingsUrl.toString(),
      title: '设置',
      width: 1040,
      height: 720,
      minWidth: 840,
      minHeight: 600,
      center: true,
      resizable: true,
      decorations: true,
      titleBarStyle: 'overlay',
      trafficLightPosition: new LogicalPosition(16, 18),
      hiddenTitle: true,
      focus: false,
      visible: false,
      skipTaskbar: false,
    });
    await new Promise<void>((resolve, reject) => {
      void child.once('tauri://created', () => resolve());
      void child.once('tauri://error', (event) => {
        reject(new Error(`无法创建独立设置窗口：${String(event.payload)}`));
      });
    });
  })();
  settingsWindowCreation = creation;

  try {
    await creation;
  } finally {
    if (settingsWindowCreation === creation) settingsWindowCreation = null;
  }
}

async function getSettingsWindow(): Promise<ComposerNativeWindow> {
  const { WebviewWindow } = await loadWebviewWindow();
  const settingsWindow = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL);
  if (!settingsWindow) {
    throw new Error('独立设置窗口创建完成后仍不可用');
  }
  return settingsWindow;
}

async function waitForSettingsWindowReady(settingsWindow: ComposerNativeWindow): Promise<void> {
  if (!settingsWindowReady) {
    const readyWait = (async () => {
      const { listen: tauriListen } = await loadEvent();
      let resolveReady: (() => void) | undefined;
      let timeoutId: number | undefined;
      const readySignal = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const unlisten = await tauriListen<void>(SETTINGS_READY_EVENT, () => {
        resolveReady?.();
      });

      try {
        await settingsWindow.emit(SETTINGS_READY_QUERY_EVENT);
        await Promise.race([
          readySignal,
          new Promise<never>((_resolve, reject) => {
            timeoutId = window.setTimeout(() => {
              reject(new Error('设置窗口初始化超时，请重试'));
            }, SETTINGS_READY_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
        unlisten();
      }
    })();
    settingsWindowReady = readyWait;
  }

  const currentReadyWait = settingsWindowReady;
  try {
    await currentReadyWait;
  } catch (error) {
    if (settingsWindowReady === currentReadyWait) settingsWindowReady = null;
    throw error;
  }
}

function normalizeSettingsWindowRequest(request: SettingsWindowRequest = {}): SettingsWindowRequest {
  return {
    ...request,
    section: request.section || DEFAULT_SETTINGS_SECTION,
  };
}

export async function prodPrewarmSettingsWindow(request: SettingsWindowRequest = {}): Promise<void> {
  const normalizedRequest = normalizeSettingsWindowRequest(request);
  await ensureSettingsWindow(normalizedRequest);
  await waitForSettingsWindowReady(await getSettingsWindow());
}

export async function prodOpenSettingsWindow(request: SettingsWindowRequest = {}): Promise<void> {
  const normalizedRequest = normalizeSettingsWindowRequest(request);
  await ensureSettingsWindow(normalizedRequest);
  const settingsWindow = await getSettingsWindow();
  await settingsWindow.emit(SETTINGS_OPEN_EVENT, normalizedRequest);
  await waitForSettingsWindowReady(settingsWindow);
  await settingsWindow.emit(SETTINGS_OPEN_EVENT, normalizedRequest);
  await focusComposerWindow(settingsWindow);
}

export async function prodSyncSettingsWindowAccountScope(scope: AccountScope): Promise<void> {
  const { WebviewWindow } = await loadWebviewWindow();
  const settingsWindow = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL);
  if (!settingsWindow) return;
  await settingsWindow.emit(SETTINGS_OPEN_EVENT, { accountScope: scope });
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
    try {
      await currentWindow.hide();
    } catch (hideError) {
      // Hiding keeps the prewarmed composer reusable. If a platform or
      // capability regression prevents it, force-destroy the window so the
      // user's first close action still succeeds and the next open recreates it.
      try {
        await currentWindow.destroy();
      } catch (destroyError) {
        throw new Error(
          `无法关闭写信窗口：隐藏失败（${String(hideError)}），销毁失败（${String(destroyError)}）`,
        );
      }
    }
    return;
  }
  if (currentWindow.label === SETTINGS_WINDOW_LABEL) settingsWindowReady = null;
  await currentWindow.destroy();
}

export async function prodOnCurrentWindowCloseRequested(
  handler: (event: NativeCloseRequestEvent) => void,
): Promise<() => void> {
  const { getCurrentWindow: getTauriCurrentWindow } = await loadWindow();
  return getTauriCurrentWindow().onCloseRequested(handler);
}

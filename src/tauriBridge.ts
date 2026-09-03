import type { Message } from './app/types';
import {
  type ComposerWindowRequest,
  type NativeCloseRequestEvent,
} from './app/composerWindow';
import type { SettingsWindowRequest } from './app/settingsWindow';

export type {
  ComposerWindowRequest,
  NativeCloseRequestEvent,
} from './app/composerWindow';
export {
  COMPOSER_CLOSED_EVENT,
  COMPOSER_CONTACTS_SETTINGS_EVENT,
  COMPOSER_OPEN_EVENT,
  COMPOSER_READY_EVENT,
  COMPOSER_READY_QUERY_EVENT,
  COMPOSER_WINDOW_LABEL,
} from './app/composerWindow';
export type { SettingsWindowRequest } from './app/settingsWindow';
export {
  SETTINGS_CLOSED_EVENT,
  SETTINGS_ACCOUNT_SCOPE_EVENT,
  SETTINGS_ACCOUNTS_UPDATED_EVENT,
  SETTINGS_OPEN_EVENT,
  SETTINGS_READY_EVENT,
  SETTINGS_READY_QUERY_EVENT,
  SETTINGS_WINDOW_LABEL,
} from './app/settingsWindow';

export type InvokeArgs = Record<string, unknown> | undefined;
export type MockMessage = Omit<Message, 'folder_role'> & { folder_role: string };
export type DesktopFileDropEvent =
  | { type: 'enter'; paths: string[]; position?: unknown }
  | { type: 'over'; position?: unknown }
  | { type: 'drop'; paths: string[]; position?: unknown }
  | { type: 'leave' };
export type DesktopFileDropHandler = (event: DesktopFileDropEvent) => void;

const hasTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const mockMode =
  import.meta.env.VITE_BETTER_EMAIL_UI_MOCK === '1'
  || import.meta.env.VITE_SWIFTMAIL_UI_MOCK === '1'
  || !hasTauriRuntime;

type MockBridgeModule = typeof import('./tauriBridge.mock');
type ProdBridgeModule = typeof import('./tauriBridge.prod');

let mockBridgeModule: Promise<MockBridgeModule> | null = null;
let prodBridgeModule: Promise<ProdBridgeModule> | null = null;

function loadMockBridge() {
  mockBridgeModule ??= import('./tauriBridge.mock');
  return mockBridgeModule;
}

function loadProdBridge() {
  prodBridgeModule ??= import('./tauriBridge.prod');
  return prodBridgeModule;
}

export function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  return mockMode
    ? loadMockBridge().then(({ mockInvoke }) => mockInvoke<T>(command, args))
    : loadProdBridge().then(({ prodInvoke }) => prodInvoke<T>(command, args));
}

export async function localFileAssetUrl(localPath: string): Promise<string> {
  const normalizedPath = localPath.trim();
  if (!normalizedPath) return '';
  if (mockMode) {
    const { mockLocalFileAssetUrl } = await loadMockBridge();
    return mockLocalFileAssetUrl(normalizedPath);
  }
  const { prodLocalFileAssetUrl } = await loadProdBridge();
  return prodLocalFileAssetUrl(normalizedPath);
}

export function getCurrentWindow() {
  return {
    setBadgeCount: async (count?: number) => {
      if (mockMode) {
        const { mockGetCurrentWindow } = await loadMockBridge();
        return mockGetCurrentWindow().setBadgeCount();
      }
      const { prodGetCurrentWindow } = await loadProdBridge();
      return prodGetCurrentWindow().setBadgeCount(count);
    },
    setBadgeLabel: async (label?: string) => {
      if (mockMode) {
        const { mockGetCurrentWindow } = await loadMockBridge();
        return mockGetCurrentWindow().setBadgeLabel();
      }
      const { prodGetCurrentWindow } = await loadProdBridge();
      return prodGetCurrentWindow().setBadgeLabel(label);
    },
    onDragDropEvent: async (handler: DesktopFileDropHandler) => {
      if (mockMode) {
        const { mockGetCurrentWindow } = await loadMockBridge();
        return mockGetCurrentWindow().onDragDropEvent();
      }
      const { prodGetCurrentWindow } = await loadProdBridge();
      return prodGetCurrentWindow().onDragDropEvent(handler);
    },
    onFocusChanged: async (handler: (focused: boolean) => void) => {
      if (mockMode) {
        const { mockGetCurrentWindow } = await loadMockBridge();
        return mockGetCurrentWindow().onFocusChanged(handler);
      }
      const { prodGetCurrentWindow } = await loadProdBridge();
      return prodGetCurrentWindow().onFocusChanged(handler);
    },
  };
}

export function isPermissionGranted(): Promise<boolean> {
  return mockMode
    ? loadMockBridge().then(({ mockIsPermissionGranted }) => mockIsPermissionGranted())
    : loadProdBridge().then(({ prodIsPermissionGranted }) => prodIsPermissionGranted());
}

export function requestPermission(): Promise<string> {
  return mockMode
    ? loadMockBridge().then(({ mockRequestPermission }) => mockRequestPermission())
    : loadProdBridge().then(({ prodRequestPermission }) => prodRequestPermission());
}

export function sendNotification(notification: { title: string; body?: string }) {
  if (mockMode) {
    void loadMockBridge().then(({ mockSendNotification }) => mockSendNotification(notification));
    return;
  }
  void loadProdBridge().then(({ prodSendNotification }) => prodSendNotification(notification));
}

export async function listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  if (mockMode) {
    return () => {};
  }
  const { prodListen } = await loadProdBridge();
  return prodListen<T>(event, handler);
}

export function isStandaloneComposerWindow() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('window') === 'compose';
}

export function isStandaloneSettingsWindow() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('window') === 'settings';
}

export function openComposerWindow(request: ComposerWindowRequest = {}): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodOpenComposerWindow }) => prodOpenComposerWindow(request));
}

export function prewarmComposerWindow(): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodPrewarmComposerWindow }) => prodPrewarmComposerWindow());
}

export function openSettingsWindow(request: SettingsWindowRequest = {}): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodOpenSettingsWindow }) => prodOpenSettingsWindow(request));
}

export function prewarmSettingsWindow(request: SettingsWindowRequest = {}): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodPrewarmSettingsWindow }) => prodPrewarmSettingsWindow(request));
}

export function syncSettingsWindowAccountScope(scope: import('./app/types').AccountScope): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodSyncSettingsWindowAccountScope }) => prodSyncSettingsWindowAccountScope(scope));
}

export function showCurrentWindow(): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodShowCurrentWindow }) => prodShowCurrentWindow());
}

export function takePendingComposerRequest(): Promise<ComposerWindowRequest | null> {
  if (mockMode) return Promise.resolve(null);
  return loadProdBridge().then(({ prodTakePendingComposerRequest }) => prodTakePendingComposerRequest());
}

export async function listenCurrentWindow<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  if (mockMode) return () => {};
  const { prodListenCurrentWindow } = await loadProdBridge();
  return prodListenCurrentWindow<T>(event, handler);
}

export function emitToMain<T>(event: string, payload?: T): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodEmitToMain }) => prodEmitToMain(event, payload));
}

export function closeCurrentWindow(): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodCloseCurrentWindow }) => prodCloseCurrentWindow());
}

export function onCurrentWindowCloseRequested(
  handler: (event: NativeCloseRequestEvent) => void,
): Promise<() => void> {
  if (mockMode) return Promise.resolve(() => {});
  return loadProdBridge().then(({ prodOnCurrentWindowCloseRequested }) => prodOnCurrentWindowCloseRequested(handler));
}

export function startDraggingCurrentWindow(): Promise<void> {
  if (mockMode) return Promise.resolve();
  return loadProdBridge().then(({ prodStartDraggingCurrentWindow }) => prodStartDraggingCurrentWindow());
}

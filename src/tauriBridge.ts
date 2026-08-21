import type { Message } from './app/types';

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

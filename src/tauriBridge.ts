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

import {
  mockInvoke,
  mockLocalFileAssetUrl,
  mockGetCurrentWindow,
  mockIsPermissionGranted,
  mockRequestPermission,
  mockSendNotification
} from './tauriBridge.mock';

export function invoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  return mockMode ? mockInvoke<T>(command, args) : import('./tauriBridge.prod').then(({ prodInvoke }) => prodInvoke<T>(command, args));
}

export async function localFileAssetUrl(localPath: string): Promise<string> {
  const normalizedPath = localPath.trim();
  if (!normalizedPath) return '';
  if (mockMode) {
    return mockLocalFileAssetUrl(normalizedPath);
  }
  const { prodLocalFileAssetUrl } = await import('./tauriBridge.prod');
  return prodLocalFileAssetUrl(normalizedPath);
}

export function getCurrentWindow() {
  if (mockMode) {
    return mockGetCurrentWindow();
  }
  return {
    setBadgeCount: async (count?: number) => {
      const { prodGetCurrentWindow } = await import('./tauriBridge.prod');
      return prodGetCurrentWindow().setBadgeCount(count);
    },
    setBadgeLabel: async (label?: string) => {
      const { prodGetCurrentWindow } = await import('./tauriBridge.prod');
      return prodGetCurrentWindow().setBadgeLabel(label);
    },
    onDragDropEvent: async (handler: DesktopFileDropHandler) => {
      const { prodGetCurrentWindow } = await import('./tauriBridge.prod');
      return prodGetCurrentWindow().onDragDropEvent(handler);
    },
  };
}

export function isPermissionGranted(): Promise<boolean> {
  return mockMode ? mockIsPermissionGranted() : import('./tauriBridge.prod').then(({ prodIsPermissionGranted }) => prodIsPermissionGranted());
}

export function requestPermission(): Promise<string> {
  return mockMode ? mockRequestPermission() : import('./tauriBridge.prod').then(({ prodRequestPermission }) => prodRequestPermission());
}

export function sendNotification(notification: { title: string; body?: string }) {
  if (mockMode) {
    return mockSendNotification(notification);
  }
  void import('./tauriBridge.prod').then(({ prodSendNotification }) => prodSendNotification(notification));
}

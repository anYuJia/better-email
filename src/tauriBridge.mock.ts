import type { InvokeArgs } from './mockTauri/types';
import { routeCommand } from './mockTauri/router';

export * from './mockTauri/types';
export * from './mockTauri/fixtures';
export * from './mockTauri/utils';
export * from './mockTauri/state';

export async function mockInvoke<T>(command: string, args?: Record<string, any>): Promise<T> {
  if (typeof window !== 'undefined') {
    const mockWindow = window as Window & {
      __betterEmailMockInvocations?: Array<{ command: string; args?: InvokeArgs }>;
    };
    mockWindow.__betterEmailMockInvocations ??= [];
    mockWindow.__betterEmailMockInvocations.push({
      command,
      args: args ? JSON.parse(JSON.stringify(args)) as InvokeArgs : undefined,
    });
  }
  return routeCommand(command, args) as T;
}

export async function mockLocalFileAssetUrl(localPath: string): Promise<string> {
  const normalizedPath = localPath.trim();
  if (!normalizedPath) return '';
  if (normalizedPath.endsWith('/better-email-inline-logo.svg')) {
    return '/inline-image-preview.svg';
  }
  return encodeURI(`file://${normalizedPath}`);
}

export function mockGetCurrentWindow() {
  return {
    setBadgeCount: async () => undefined,
    setBadgeLabel: async () => undefined,
    onDragDropEvent: async () => async () => undefined,
    onFocusChanged: async (_handler: (focused: boolean) => void) => async () => undefined,
  };
}

export function mockIsPermissionGranted(): Promise<boolean> {
  return Promise.resolve(true);
}

export function mockRequestPermission(): Promise<string> {
  return Promise.resolve('granted');
}

export function mockSendNotification(_notification: { title: string; body?: string }) {
  return;
}

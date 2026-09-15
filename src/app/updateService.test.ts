import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import {
  checkForAppUpdate,
  installAppUpdate,
  type AppUpdate,
} from './updateService';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.check,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: mocks.relaunch,
}));

function setTauriRuntime(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    return;
  }
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
}

describe('updateService', () => {
  beforeEach(() => {
    mocks.check.mockReset();
    mocks.relaunch.mockReset();
    mocks.relaunch.mockResolvedValue(undefined);
    setTauriRuntime(false);
  });

  it('skips updater access outside a Tauri runtime', async () => {
    await expect(checkForAppUpdate()).resolves.toBeNull();
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('shares an in-flight check between callers', async () => {
    setTauriRuntime(true);
    let resolveCheck: (update: AppUpdate | null) => void = () => undefined;
    const pending = new Promise<AppUpdate | null>((resolve) => {
      resolveCheck = resolve;
    });
    mocks.check.mockReturnValueOnce(pending);

    const first = checkForAppUpdate();
    const second = checkForAppUpdate();
    expect(first).toBe(second);
    expect(mocks.check).toHaveBeenCalledTimes(1);

    resolveCheck(null);
    await expect(first).resolves.toBeNull();
  });

  it('reports download progress and relaunches after installation', async () => {
    setTauriRuntime(true);
    const events: DownloadEvent[] = [
      { event: 'Started', data: { contentLength: 200 } },
      { event: 'Progress', data: { chunkLength: 80 } },
      { event: 'Finished' },
    ];
    const update: AppUpdate = {
      downloadAndInstall: vi.fn(async (onEvent?: (event: DownloadEvent) => void) => {
        events.forEach((event) => onEvent?.(event));
      }),
    } as unknown as AppUpdate;
    const progress: string[] = [];

    await installAppUpdate(update, (event) => progress.push(event.phase));

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(['preparing', 'downloading', 'downloading', 'installing', 'restarting']);
    expect(mocks.relaunch).toHaveBeenCalledTimes(1);
  });
});

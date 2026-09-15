import {
  check,
  type DownloadEvent,
  type Update,
} from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type AppUpdate = Update;

export type UpdateInstallProgress = {
  phase: 'preparing' | 'downloading' | 'installing' | 'restarting';
  downloadedBytes: number;
  totalBytes: number | null;
};

const UPDATE_CHECK_TIMEOUT_MS = 20_000;

let activeCheck: Promise<AppUpdate | null> | null = null;

export function isTauriRuntime() {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function getUpdateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const message = String(error).trim();
  return message || '未知错误';
}

/**
 * Check the signed updater manifest once at a time. The shared promise keeps
 * the startup check and the About page from issuing duplicate requests when
 * the user opens Settings while startup is still probing for an update.
 */
export function checkForAppUpdate(): Promise<AppUpdate | null> {
  if (!isTauriRuntime()) return Promise.resolve(null);
  if (activeCheck) return activeCheck;

  activeCheck = check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
  const request = activeCheck;
  void request.then(
    () => {
      if (activeCheck === request) activeCheck = null;
    },
    () => {
      if (activeCheck === request) activeCheck = null;
    },
  );
  return request;
}

function emitProgress(
  onProgress: ((progress: UpdateInstallProgress) => void) | undefined,
  progress: UpdateInstallProgress,
) {
  onProgress?.(progress);
}

function handleDownloadEvent(
  event: DownloadEvent,
  state: { downloadedBytes: number; totalBytes: number | null },
  onProgress: ((progress: UpdateInstallProgress) => void) | undefined,
) {
  if (event.event === 'Started') {
    state.downloadedBytes = 0;
    state.totalBytes = event.data.contentLength ?? null;
    emitProgress(onProgress, {
      phase: 'downloading',
      downloadedBytes: state.downloadedBytes,
      totalBytes: state.totalBytes,
    });
    return;
  }

  if (event.event === 'Progress') {
    state.downloadedBytes += event.data.chunkLength;
    emitProgress(onProgress, {
      phase: 'downloading',
      downloadedBytes: state.downloadedBytes,
      totalBytes: state.totalBytes,
    });
    return;
  }

  emitProgress(onProgress, {
    phase: 'installing',
    downloadedBytes: state.downloadedBytes,
    totalBytes: state.totalBytes,
  });
}

/**
 * Download the signed artifact, install it through the native updater and
 * relaunch the app. Tauri's Windows installer exits the app itself; the
 * explicit relaunch is required on macOS and Linux and is safe to keep in
 * the same standard flow.
 */
export async function installAppUpdate(
  update: AppUpdate,
  onProgress?: (progress: UpdateInstallProgress) => void,
) {
  if (!isTauriRuntime()) throw new Error('当前运行环境不支持桌面更新');

  const state = { downloadedBytes: 0, totalBytes: null as number | null };
  emitProgress(onProgress, {
    phase: 'preparing',
    downloadedBytes: state.downloadedBytes,
    totalBytes: state.totalBytes,
  });

  await update.downloadAndInstall((event) => {
    handleDownloadEvent(event, state, onProgress);
  }, { timeout: UPDATE_CHECK_TIMEOUT_MS });

  emitProgress(onProgress, {
    phase: 'restarting',
    downloadedBytes: state.downloadedBytes,
    totalBytes: state.totalBytes,
  });
  await relaunch();
}

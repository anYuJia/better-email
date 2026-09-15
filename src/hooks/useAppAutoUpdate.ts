import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageToast } from '../components/MessageToastStack';
import { logError } from '../app/logger';
import {
  checkForAppUpdate,
  getUpdateErrorMessage,
  installAppUpdate,
  type AppUpdate,
  type UpdateInstallProgress,
} from '../app/updateService';
import { mockMode } from '../tauriBridge';
import type { NativePlatform } from './useNativePlatform';

export type UseAppAutoUpdateOptions = {
  standaloneSettingsWindow: boolean;
  nativePlatform: NativePlatform;
  nativePlatformResolved: boolean;
  isMobileApp: boolean;
  onNotify: (message: string, tone?: MessageToast['tone']) => void;
};

export default function useAppAutoUpdate({
  standaloneSettingsWindow,
  nativePlatform,
  nativePlatformResolved,
  isMobileApp,
  onNotify,
}: UseAppAutoUpdateOptions) {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<UpdateInstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkStartedRef = useRef(false);

  useEffect(() => {
    if (
      standaloneSettingsWindow
      || mockMode
      || !nativePlatformResolved
      || nativePlatform !== 'desktop'
      || isMobileApp
      || checkStartedRef.current
    ) return undefined;

    checkStartedRef.current = true;
    void checkForAppUpdate()
      .then((nextUpdate) => {
        if (!nextUpdate) return;
        setUpdate(nextUpdate);
        onNotify(`发现新版本 ${nextUpdate.version}，可直接下载更新。`, 'info');
      })
      .catch((checkError) => {
        // Startup checks stay quiet. The About page exposes the actionable
        // error when the user explicitly asks for a manual check.
        logError('[update] startup check failed', getUpdateErrorMessage(checkError));
      });
    return undefined;
  }, [isMobileApp, nativePlatform, nativePlatformResolved, onNotify, standaloneSettingsWindow]);

  const install = useCallback(async () => {
    if (!update || installing) return;
    setInstalling(true);
    setError(null);
    setProgress(null);
    onNotify('开始下载更新，完成后将自动安装并重启。', 'info');
    try {
      await installAppUpdate(update, setProgress);
      setUpdate(null);
      setProgress(null);
    } catch (installError) {
      const message = getUpdateErrorMessage(installError);
      setError(message);
      onNotify(`更新安装失败：${message}。`, 'error');
      logError('[update] install failed', message);
    } finally {
      setInstalling(false);
    }
  }, [installing, onNotify, update]);

  const dismiss = useCallback(() => {
    if (installing) return;
    setUpdate(null);
    setError(null);
    setProgress(null);
  }, [installing]);

  return {
    update,
    installing,
    progress,
    error,
    install,
    dismiss,
  };
}

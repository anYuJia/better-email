import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const themeModeStorageKey = 'better-email.theme-mode';

function systemDarkMedia(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)');
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') {
    return systemDarkMedia().matches ? 'dark' : 'light';
  }
  return mode;
}

function readStoredMode(): ThemeMode {
  const stored = window.localStorage.getItem(themeModeStorageKey);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * Theme preference with three modes: follow the system, force light or force
 * dark. Only explicit changes write the shared preference. Other windows
 * follow storage updates without publishing their older state on mount.
 */
export default function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredMode()));

  useEffect(() => {
    const root = document.documentElement;
    let restoreFrame = 0;
    const apply = () => {
      const next = resolveTheme(mode);
      setResolved(next);
      if (root.dataset.theme === next) return;

      // WebKit can pause individual color transitions in an inactive mail
      // window. Paint the palette as a whole before restoring control motion.
      root.dataset.themeChanging = '';
      root.dataset.theme = next;
      cancelAnimationFrame(restoreFrame);
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = requestAnimationFrame(() => delete root.dataset.themeChanging);
      });
    };
    apply();
    const media = mode === 'system' ? systemDarkMedia() : null;
    media?.addEventListener('change', apply);
    return () => {
      media?.removeEventListener('change', apply);
      cancelAnimationFrame(restoreFrame);
      delete root.dataset.themeChanging;
    };
  }, [mode]);

  useEffect(() => {
    const syncMode = () => setModeState(readStoredMode());
    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea === window.localStorage
        && (event.key === themeModeStorageKey || event.key === null)) syncMode();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', syncMode);
    syncMode();
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', syncMode);
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    window.localStorage.setItem(themeModeStorageKey, next);
    setModeState(next);
  }, []);

  return { mode, resolved, setMode };
}

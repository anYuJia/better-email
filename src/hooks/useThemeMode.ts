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
 * dark. Persists to localStorage and mirrors the resolved theme onto
 * <html data-theme="..."> so every stylesheet can key off it.
 */
export default function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStoredMode()));

  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(mode);
      setResolved(next);
      document.documentElement.dataset.theme = next;
    };
    apply();
    window.localStorage.setItem(themeModeStorageKey, mode);
    if (mode === 'system') {
      const media = systemDarkMedia();
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  return { mode, resolved, setMode };
}

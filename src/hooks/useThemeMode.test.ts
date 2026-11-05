import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useThemeMode, { themeModeStorageKey } from './useThemeMode';

describe('useThemeMode', () => {
  beforeEach(() => {
    window.localStorage.removeItem(themeModeStorageKey);
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  afterEach(() => {
    window.localStorage.removeItem(themeModeStorageKey);
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
  });

  it('follows a theme change published by another window', () => {
    const { result } = renderHook(() => useThemeMode());

    act(() => {
      window.localStorage.setItem(themeModeStorageKey, 'dark');
      window.dispatchEvent(new StorageEvent('storage', {
        key: themeModeStorageKey,
        newValue: 'dark',
        storageArea: window.localStorage,
      }));
    });

    expect(result.current.mode).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists explicit choices and reconciles missed updates on focus', () => {
    const { result } = renderHook(() => useThemeMode());
    expect(window.localStorage.getItem(themeModeStorageKey)).toBeNull();

    act(() => result.current.setMode('dark'));
    expect(window.localStorage.getItem(themeModeStorageKey)).toBe('dark');

    act(() => {
      window.localStorage.setItem(themeModeStorageKey, 'light');
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current.mode).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

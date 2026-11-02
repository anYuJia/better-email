import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useExitPresence from './useExitPresence';

describe('useExitPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('mounts immediately and retains only the outgoing presentation', () => {
    const { result, rerender } = renderHook(({ open }) => useExitPresence(open), { initialProps: { open: false } });
    expect(result.current).toBe(false);
    rerender({ open: true });
    expect(result.current).toBe(true);
    rerender({ open: false });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(180));
    expect(result.current).toBe(false);
  });

  it('cancels obsolete removal when rapidly reopened and closed again', () => {
    const { result, rerender } = renderHook(({ open }) => useExitPresence(open), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(80));
    rerender({ open: true });
    rerender({ open: false });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(80));
    expect(result.current).toBe(false);
  });

  it('does not wait when motion is reduced', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const { result, rerender } = renderHook(({ open }) => useExitPresence(open), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes immediately if reduced motion becomes enabled during exit', () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal('matchMedia', () => media);
    const { result, rerender, unmount } = renderHook(({ open }) => useExitPresence(open), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => { media.matches = true; listeners.forEach((listener) => listener()); });
    expect(result.current).toBe(false);
    unmount();
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

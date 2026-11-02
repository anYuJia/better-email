import type { Monitor, Window as NativeWindow } from '@tauri-apps/api/window';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeComposerPlacement, rememberNativeComposerGeometry } from './nativeComposerGeometry';

const key = 'better-email-native-composer-geometry-v1';
const screen = (x: number, y: number, width: number, height: number, scaleFactor = 1) => ({
  scaleFactor, workArea: { position: { x, y }, size: { width, height } },
}) as Monitor;
beforeEach(() => localStorage.clear());
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('native composer placement', () => {
  it('restores physical position on a retina monitor while preserving logical size', () => {
    localStorage.setItem(key, JSON.stringify({ x: 200, y: 120, width: 900, height: 600 }));
    const monitor = screen(0, 0, 2880, 1800, 2);
    expect(nativeComposerPlacement([monitor], monitor)).toMatchObject({ x: 100, y: 60, width: 900, height: 600 });
  });

  it('returns a removed monitor window to the available work area and fits large dimensions', () => {
    localStorage.setItem(key, JSON.stringify({ x: -3000, y: 3000, width: 1800, height: 1200 }));
    const monitor = screen(0, 30, 1280, 740);
    const result = nativeComposerPlacement([monitor], monitor);
    expect(result).toMatchObject({ x: 16, y: 46, width: 1248, height: 708 });
  });

  it('ignores malformed preferences and fits minimums on small displays', () => {
    localStorage.setItem(key, '{broken');
    const monitor = screen(0, 0, 700, 500);
    const result = nativeComposerPlacement([monitor], monitor);
    expect(result).toMatchObject({ width: 668, height: 468, minWidth: 668, minHeight: 468 });
  });

  it('debounces native geometry events and ignores maximized geometry', async () => {
    vi.useFakeTimers();
    const handlers: Record<string, () => void> = {};
    const remove = vi.fn();
    const native = {
      outerPosition: vi.fn(async () => ({ x: 100, y: 200 })),
      innerSize: vi.fn(async () => ({ width: 1800, height: 1200 })),
      scaleFactor: vi.fn(async () => 2),
      isMaximized: vi.fn(async () => false),
      isMinimized: vi.fn(async () => false),
      onMoved: vi.fn(async (fn: () => void) => { handlers.move = fn; return remove; }),
      onResized: vi.fn(async (fn: () => void) => { handlers.resize = fn; return remove; }),
      onCloseRequested: vi.fn(async (fn: () => void) => { handlers.close = fn; return remove; }),
      once: vi.fn(async (_event: string, fn: () => void) => { handlers.destroy = fn; return remove; }),
    };
    const dispose = await rememberNativeComposerGeometry(native as unknown as NativeWindow);
    for (let i = 0; i < 30; i++) { handlers.move(); handlers.resize(); }
    expect(native.innerSize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(180);
    expect(native.innerSize).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({ x: 100, y: 200, width: 900, height: 600 });
    native.isMaximized.mockResolvedValue(true);
    native.innerSize.mockResolvedValue({ width: 2880, height: 1800 });
    handlers.resize();
    await vi.advanceTimersByTimeAsync(180);
    expect(JSON.parse(localStorage.getItem(key)!).width).toBe(900);
    handlers.move();
    dispose();
    await vi.advanceTimersByTimeAsync(180);
    expect(native.innerSize).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(4);
  });
});

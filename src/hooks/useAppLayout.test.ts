import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MouseEvent } from 'react';
import useAppLayout from './useAppLayout';
import { appLayoutStorageKey, fitAppLayout, getDefaultAppLayout } from '../app/storageConfig';

const originalWidth = window.innerWidth;
function resizeTo(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  localStorage.clear();
  resizeTo(1440);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resizeTo(originalWidth);
  vi.useRealTimers();
});

describe('workspace pane preferences', () => {
  it('adapts defaults on resize without turning them into a saved user preference', () => {
    const { result } = renderHook(useAppLayout);
    expect(result.current.appLayout).toEqual(getDefaultAppLayout(1440));
    expect(localStorage.getItem(appLayoutStorageKey)).toBeNull();
    act(() => resizeTo(1280));
    expect(result.current.appLayout).toEqual(getDefaultAppLayout(1280));
    expect(localStorage.getItem(appLayoutStorageKey)).toBeNull();
  });

  it('protects reading space while retaining manually saved widths for a larger window', () => {
    const preferred = { sidebar: 300, list: 540 };
    localStorage.setItem(appLayoutStorageKey, JSON.stringify(preferred));
    const { result } = renderHook(useAppLayout);
    act(() => resizeTo(1280));
    expect(1280 - result.current.appLayout.sidebar - result.current.appLayout.list - 2).toBeGreaterThanOrEqual(560);
    expect(JSON.parse(localStorage.getItem(appLayoutStorageKey)!)).toMatchObject(preferred);
    act(() => resizeTo(1600));
    expect(result.current.appLayout).toEqual(preferred);
  });

  it('reset restores responsive defaults instead of persisting a snapshot', () => {
    const { result } = renderHook(useAppLayout);
    act(() => result.current.adjustAppLayout('list', 40));
    expect(localStorage.getItem(appLayoutStorageKey)).not.toBeNull();
    act(() => result.current.resetAppLayout());
    expect(localStorage.getItem(appLayoutStorageKey)).toBeNull();
    act(() => resizeTo(1280));
    expect(result.current.appLayout).toEqual(getDefaultAppLayout(1280));
  });

  it('migrates automatically persisted defaults while respecting explicit resized values', () => {
    localStorage.setItem(appLayoutStorageKey, JSON.stringify({ sidebar: 224, list: 448 }));
    const view = renderHook(useAppLayout);
    expect(view.result.current.appLayout).toEqual(getDefaultAppLayout(1440));
    view.unmount();
    localStorage.setItem(appLayoutStorageKey, JSON.stringify({ sidebar: 224, list: 448, version: 3 }));
    const manual = renderHook(useAppLayout);
    expect(manual.result.current.appLayout).toEqual({ sidebar: 224, list: 448 });
  });

  it('fits both maximum preferences at the edge of the resizable layout', () => {
    const fitted = fitAppLayout({ sidebar: 320, list: 560 }, 1181);
    expect(fitted.sidebar).toBeGreaterThanOrEqual(218);
    expect(fitted.list).toBeGreaterThanOrEqual(340);
    expect(1181 - fitted.sidebar - fitted.list - 2).toBeGreaterThanOrEqual(560);
  });
});


describe('direct pane resize feedback', () => {
  it('paints drag frames without rerendering the workspace and saves the final width once released', () => {
    vi.useFakeTimers();
    let renders = 0;
    const { result } = renderHook(() => { renders += 1; return useAppLayout(); });
    const shell = document.createElement('main');
    shell.className = 'app-shell';
    const handle = document.createElement('button');
    shell.append(handle);
    document.body.append(shell);
    const before = renders;
    const initial = result.current.appLayout.sidebar;
    act(() => result.current.beginLayoutMouseResize('sidebar', {
      preventDefault() {}, clientX: 200, currentTarget: handle,
    } as unknown as MouseEvent<HTMLButtonElement>));
    act(() => result.current.moveLayoutMouseResize({ clientX: 228 } as MouseEvent<HTMLElement>));
    act(() => vi.advanceTimersByTime(20));
    expect(shell.style.getPropertyValue('--app-sidebar-width-preferred')).toBe(`${initial + 28}px`);
    expect(handle.getAttribute('aria-valuenow')).toBe(String(initial + 28));
    expect(renders).toBe(before);
    expect(localStorage.getItem(appLayoutStorageKey)).toBeNull();
    act(() => result.current.endLayoutMouseResize());
    expect(result.current.appLayout.sidebar).toBe(initial + 28);
    expect(JSON.parse(localStorage.getItem(appLayoutStorageKey)!).sidebar).toBe(initial + 28);
    expect(document.body.classList.contains('pane-resizing')).toBe(false);
    shell.remove();
  });

  it('keeps widths continuous across the former 1180px breakpoint', () => {
    const wider = fitAppLayout({ sidebar: 244, list: 410 }, 1181);
    const narrower = fitAppLayout({ sidebar: 244, list: 410 }, 1180);
    expect(Math.abs(wider.sidebar - narrower.sidebar)).toBeLessThanOrEqual(1);
    expect(Math.abs(wider.list - narrower.list)).toBeLessThanOrEqual(1);
    expect(narrower.list).toBeGreaterThanOrEqual(340);
  });
});

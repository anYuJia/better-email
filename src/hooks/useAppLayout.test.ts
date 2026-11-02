import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

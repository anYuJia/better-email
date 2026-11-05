import { Suspense, lazy } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPageShell from './SettingsPageShell';
import { getSettingsNavigationContext, type SettingsSectionId } from './settingsNavigation';

const animate = vi.fn(() => ({ cancel: vi.fn() }));
const nativeAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); animate.mockClear();
  if (nativeAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', nativeAnimate);
  else delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});
function page(section: SettingsSectionId, child: React.ReactNode) {
  const { group, item } = getSettingsNavigationContext(section);
  return <SettingsPageShell activeSection={section} group={group} item={item}>{child}</SettingsPageShell>;
}
function deferredContent(label: string) {
  let resolve!: (value: { default: () => React.JSX.Element }) => void;
  const promise = new Promise<{ default: () => React.JSX.Element }>(done => { resolve = done; });
  return { Component: lazy(() => promise), finish: () => resolve({ default: () => <input aria-label={label} /> }) };
}
describe('settings ready content timing', () => {
  it('keeps the new heading usable while loading and reveals only the committed content', async () => {
    const pending = deferredContent('设置值');
    render(page('general', <pending.Component />));
    expect(screen.getByRole('heading', { name: '通用' })).toBeDefined();
    expect(document.querySelector('[data-settings-loading]')).not.toBeNull();
    expect(screen.queryByRole('status')).toBeNull(); expect(animate).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(120)); expect(screen.getByRole('status').textContent).toContain('正在加载');
    await act(async () => { pending.finish(); });
    const input = screen.getByRole('textbox', { name: '设置值' }); input.focus(); fireEvent.change(input, { target: { value: '立即可编辑' } });
    expect(document.activeElement).toBe(input); expect(animate).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-settings-loading]')).toBeNull();
  });
  it('does not show the loading message for a short load or replay on a form update', async () => {
    const pending = deferredContent('短加载'); const { rerender } = render(page('general', <pending.Component />));
    await act(async () => { pending.finish(); });
    act(() => vi.advanceTimersByTime(200)); expect(screen.queryByRole('status')).toBeNull();
    const heading = screen.getByRole('heading', { name: '通用' });
    rerender(page('general', <pending.Component />));
    expect(screen.getByRole('heading', { name: '通用' })).toBe(heading); expect(animate).toHaveBeenCalledTimes(1);
  });
  it('never lets a late page overwrite or animate after newer navigation', async () => {
    const first = deferredContent('旧页面'); const next = deferredContent('新页面');
    const { rerender } = render(page('general', <first.Component />));
    const surface = document.querySelector('[data-settings-page]');
    rerender(page('about', <next.Component />));
    expect(document.querySelector('[data-settings-page]')).toBe(surface);
    await act(async () => { next.finish(); }); expect(screen.getByRole('textbox', { name: '新页面' })).toBeDefined();
    await act(async () => { first.finish(); });
    expect(screen.queryByRole('textbox', { name: '旧页面' })).toBeNull(); expect(animate).toHaveBeenCalledTimes(1);
  });
  it('honors reduced motion while keeping content immediately usable', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<Suspense>{page('general', <input aria-label="设置值" />)}</Suspense>);
    expect(screen.getByRole('textbox')).toBeDefined(); expect(animate).not.toHaveBeenCalled();
  });
});

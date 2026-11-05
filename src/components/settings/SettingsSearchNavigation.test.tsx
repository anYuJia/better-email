import { lazy, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsFrame from './SettingsFrame';
import type { SettingsSectionId } from './settingsNavigation';

vi.mock('./settingsPageLoaders', () => ({ preloadSettingsSection: vi.fn() }));
const scrollIntoView = vi.fn();
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); scrollIntoView.mockClear();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
});
function setup() {
  let finish!: (value: { default: () => React.JSX.Element }) => void;
  const pending = new Promise<{ default: () => React.JSX.Element }>((resolve) => { finish = resolve; });
  const Content = () => <details data-settings-section="ai-advanced"><summary>高级连接</summary><input aria-label="API 地址" /></details>;
  const ColdAi = lazy(() => pending);
  function Harness() {
    const [section, setSection] = useState<SettingsSectionId>('general');
    return <SettingsFrame title="设置" activeSection={section} onNavigate={setSection} onTestConnection={() => undefined} onSave={() => undefined} onClose={() => undefined}>
      {section === 'ai' ? <ColdAi /> : <p>{section} 内容</p>}
    </SettingsFrame>;
  }
  const view = render(<Harness />);
  function search() {
    fireEvent.input(screen.getByRole('searchbox', { name: '搜索设置' }), { target: { value: 'AI 连接参数' } });
    fireEvent.click(screen.getByRole('button', { name: /AI 连接参数/ }));
  }
  return { ...view, search, finish: () => finish({ default: Content }) };
}
describe('settings search waits for its own committed content', () => {
  it('opens and focuses a target after a cold chunk exceeds the previous delay without waiting for animation', async () => {
    const view = setup(); view.search();
    expect(screen.queryByLabelText('设置搜索结果')).toBeNull();
    expect(document.querySelector('[data-settings-loading]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => view.finish());
    const target = document.querySelector<HTMLDetailsElement>('[data-settings-section="ai-advanced"]')!;
    expect(target.open).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(target.classList.contains('settings-search-hit')).toBe(true);
    const input = screen.getByRole('textbox', { name: 'API 地址' }); input.focus();
    fireEvent.change(input, { target: { value: 'http://localhost' } });
    act(() => vi.advanceTimersByTime(1000));
    expect(document.activeElement).toBe(input);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(target.classList.contains('settings-search-hit')).toBe(false);
  });

  it('cancels the old search when navigation leaves and returns before the chunk resolves', async () => {
    const view = setup(); view.search();
    fireEvent.click(screen.getByRole('button', { name: '关于设置' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI 接入设置' }));
    await act(async () => view.finish());
    expect(document.querySelector<HTMLDetailsElement>('[data-settings-section="ai-advanced"]')?.open).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector('.settings-search-hit')).toBeNull();
  });

  it('cancels an outstanding target when Settings unmounts', async () => {
    const view = setup(); view.search(); view.unmount();
    await act(async () => view.finish());
    act(() => vi.advanceTimersByTime(1000));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('uses immediate scrolling with reduced motion and still focuses the ready target', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion') }));
    const view = setup(); view.search();
    await act(async () => view.finish());
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(document.activeElement?.getAttribute('data-settings-section')).toBe('ai-advanced');
  });
});

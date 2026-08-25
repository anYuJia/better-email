import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import useAutoHideScrollbars from './useAutoHideScrollbars';

function Harness() {
  useAutoHideScrollbars();
  return null;
}

function createScrollableSurface(parent: HTMLElement = document.body) {
  const surface = document.createElement('div');
  surface.style.overflowY = 'auto';
  Object.defineProperties(surface, {
    clientWidth: { configurable: true, value: 200 },
    clientHeight: { configurable: true, value: 100 },
    scrollWidth: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 300 },
  });
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
    bottom: 100,
    height: 100,
    left: 0,
    right: 200,
    top: 0,
    width: 200,
  } as DOMRect);
  parent.append(surface);
  return surface;
}

describe('useAutoHideScrollbars', () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it('shows a scrolling surface briefly, then removes its state', () => {
    vi.useFakeTimers();
    const appShell = document.createElement('main');
    appShell.className = 'app-shell';
    document.body.append(appShell);
    render(<Harness />, { container: appShell });
    const surface = createScrollableSurface(appShell);

    act(() => {
      surface.dispatchEvent(new Event('scroll'));
    });
    expect(surface.getAttribute('data-scrollbar-scrolling')).toBe('true');
    expect(document.querySelector('.auto-scrollbar-thumb--vertical')
      ?.classList.contains('auto-scrollbar-thumb--visible')).toBe(true);

    act(() => vi.advanceTimersByTime(1199));
    expect(surface.getAttribute('data-scrollbar-scrolling')).toBe('true');

    act(() => vi.advanceTimersByTime(1));
    expect(surface.hasAttribute('data-scrollbar-scrolling')).toBe(false);
    expect(document.querySelector('.auto-scrollbar-thumb--vertical')
      ?.classList.contains('auto-scrollbar-thumb--visible')).toBe(false);
  });

  it('also tracks scrollable body-level portals without marking static surfaces', () => {
    vi.useFakeTimers();
    const appShell = document.createElement('main');
    appShell.className = 'app-shell';
    document.body.append(appShell);
    render(<Harness />, { container: appShell });
    const portalSurface = createScrollableSurface();
    const staticSurface = document.createElement('div');
    staticSurface.style.overflowY = 'auto';
    document.body.append(staticSurface);

    act(() => {
      portalSurface.dispatchEvent(new Event('scroll'));
      staticSurface.dispatchEvent(new Event('scroll'));
    });

    expect(portalSurface.getAttribute('data-scrollbar-scrolling')).toBe('true');
    expect(staticSurface.hasAttribute('data-scrollbar-scrolling')).toBe(false);
  });
});

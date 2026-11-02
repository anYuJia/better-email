import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
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
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('maps pointer drag on the overlay thumb to scrollTop and cleans up on release', () => {
    const appShell = document.createElement('main');
    document.body.append(appShell);
    render(<Harness />, { container: appShell });
    const surface = createScrollableSurface(appShell);

    act(() => surface.dispatchEvent(new Event('scroll')));
    const thumb = document.querySelector('.auto-scrollbar-thumb--vertical') as HTMLElement;
    expect(thumb).toBeTruthy();
    expect(thumb.classList.contains('auto-scrollbar-thumb--visible')).toBe(true);

    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    act(() => {
      fireEvent.pointerDown(thumb, { button: 0, pointerId: 7, clientY: 10 });
      fireEvent.pointerMove(document, { pointerId: 7, clientY: 50 });
    });
    expect(surface.scrollTop).toBeGreaterThan(0);
    expect(thumb.classList.contains('is-dragging')).toBe(true);

    act(() => fireEvent.pointerUp(document, { pointerId: 7, clientY: 50 }));
    expect(thumb.classList.contains('is-dragging')).toBe(false);
    expect(document.body.style.userSelect).toBe('');
    raf.mockRestore();
  });

  it('does not recreate an overlay when an active drag is disposed', () => {
    const appShell = document.createElement('main');
    document.body.append(appShell);
    const view = render(<Harness />, { container: appShell });
    const surface = createScrollableSurface(appShell);

    act(() => surface.dispatchEvent(new Event('scroll')));
    const thumb = document.querySelector('.auto-scrollbar-thumb--vertical') as HTMLElement;
    act(() => fireEvent.pointerDown(thumb, { button: 0, pointerId: 9, clientY: 10 }));
    view.unmount();

    expect(document.querySelector('.auto-scrollbar-thumb')).toBeNull();
    expect(surface.hasAttribute('data-scrollbar-scrolling')).toBe(false);
  });

  it('removes overlay nodes when a surface unmounts after its hide timer', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    for (let index = 0; index < 3; index += 1) {
      const surface = createScrollableSurface();
      act(() => surface.dispatchEvent(new Event('scroll')));
      act(() => vi.advanceTimersByTime(1250));
      expect(document.querySelectorAll('.auto-scrollbar-thumb')).toHaveLength(2);
      await act(async () => { surface.remove(); });
      expect(document.querySelectorAll('.auto-scrollbar-thumb')).toHaveLength(0);
    }
  });

  it('coalesces wheel, touch and scroll activity into one overlay update per frame', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    render(<Harness />);
    const surface = createScrollableSurface();
    for (let index = 0; index < 5; index += 1) {
      fireEvent.wheel(surface, { deltaY: 20 });
      fireEvent.touchMove(surface);
      fireEvent.scroll(surface);
    }
    expect(frames).toHaveLength(1);
    expect(surface.getBoundingClientRect).not.toHaveBeenCalled();
    act(() => frames[0](0));
    expect(surface.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.auto-scrollbar-thumb')).toHaveLength(2);
  });

  it('leaves native top-layer popovers to their own visible scrollbar', () => {
    render(<Harness />);
    const popover = document.createElement('div');
    popover.setAttribute('popover', 'manual');
    document.body.append(popover);
    const surface = createScrollableSurface(popover);
    fireEvent.scroll(surface);
    fireEvent.wheel(surface, { deltaY: 20 });
    expect(document.querySelector('.auto-scrollbar-thumb')).toBeNull();
    expect(surface.hasAttribute('data-scrollbar-scrolling')).toBe(false);
  });
});

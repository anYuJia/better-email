import { StrictMode, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useReaderReveal from './useReaderReveal';

const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
let reduced = false;
let mobile = false;
let change: (() => void) | undefined;

function Reader({ id = '1:1', ready = true, reply = '' }) {
  const ref = useRef<HTMLDivElement>(null);
  useReaderReveal(ref, id, ready);
  return <div ref={ref}><article className="reader"><header className="reader-title-block">{id}</header><div className="body-text">正文</div><input value={reply} readOnly /></article></div>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('reduce') ? reduced : mobile; },
    addEventListener: (_event: string, callback: () => void) => { change = callback; },
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  animate.mockClear(); cancel.mockClear(); reduced = false; mobile = false; change = undefined;
});

describe('reader content reveal', () => {
  it.each([80, 250, 500])('never fades text during %sms browsing with delayed body responses', (interval) => {
    const view = render(<Reader />);
    act(() => vi.advanceTimersByTime(20));
    for (let id = 2; id < 5; id += 1) {
      act(() => vi.advanceTimersByTime(interval));
      view.rerender(<Reader id={`1:${id}`} ready={false} />);
      act(() => vi.advanceTimersByTime(800));
      view.rerender(<Reader id={`1:${id}`} />);
      act(() => vi.advanceTimersByTime(20));
    }
    expect(animate).toHaveBeenCalledTimes(2);
    for (const args of animate.mock.calls as unknown as [Record<string, unknown>[]][]) {
      expect(args[0].every((frame) => frame.opacity === undefined)).toBe(true);
    }
  });
  it('settles the first arrival without replay on subsequent selections, replies or reload', () => {
    const view = render(<Reader ready={false} />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<Reader />);
    expect(animate).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(16));
    view.rerender(<Reader reply="继续输入" />);
    view.rerender(<Reader ready={false} />);
    view.rerender(<Reader />);
    expect(animate).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(200));
    view.rerender(<Reader id="1:2" />);
    expect(animate).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('keeps selections fully visible even after a pause', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const view = render(<Reader />);
    act(() => vi.advanceTimersByTime(16));
    for (let id = 2; id <= 5; id += 1) {
      now += 60;
      view.rerender(<Reader id="" ready={false} />);
      view.rerender(<Reader id={`1:${id}`} />);
      expect(view.container.querySelector('.reader-title-block')?.textContent).toBe(`1:${id}`);
      expect(animate).toHaveBeenCalledTimes(2);
      act(() => vi.advanceTimersByTime(16));
    }
    expect(cancel).toHaveBeenCalledTimes(2);
    now += 200;
    view.rerender(<Reader id="1:6" />);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it.each(['reduce', 'mobile'])('does not stack content motion in %s mode', (mode) => {
    reduced = mode === 'reduce'; mobile = mode === 'mobile';
    render(<Reader />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('cancels active motion when reduced motion changes', () => {
    render(<Reader />);
    reduced = true;
    act(() => change?.());
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('survives the StrictMode setup probe and cancels rapid obsolete reveals', () => {
    const view = render(<StrictMode><Reader /></StrictMode>);
    expect(animate).toHaveBeenCalledTimes(4);
    expect(cancel).toHaveBeenCalledTimes(2);
    view.rerender(<StrictMode><Reader id="1:2" /></StrictMode>);
    expect(animate).toHaveBeenCalledTimes(6);
    expect(cancel).toHaveBeenCalledTimes(4);
  });
});

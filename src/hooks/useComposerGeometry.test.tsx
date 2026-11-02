import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useComposerGeometry from './useComposerGeometry';

let renders = 0;
function Surface({ enabled = true, active = true }: { enabled?: boolean; active?: boolean }) {
  renders++;
  const ref = useRef<HTMLElement>(null);
  const geometry = useComposerGeometry(ref, enabled, active);
  return <section ref={ref} style={geometry.style} onPointerMove={geometry.move} onPointerUp={geometry.end} onPointerCancel={geometry.end}>
    <header onPointerDown={geometry.beginDrag}>Drag</header>
    <button onPointerDown={geometry.beginResize} onKeyDown={geometry.resizeWithKeyboard}>Resize</button>
  </section>;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => setTimeout(() => callback(16), 16)));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(clearTimeout));
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return Number.parseFloat(this.style.width) || 760; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return Number.parseFloat(this.style.height) || 640; });
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) { return innerWidth - 16 - this.offsetWidth; });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) { return innerHeight - 16 - this.offsetHeight; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const translation = this.style.transform.match(/translate\(([-.\d]+)px, ([-.\d]+)px\)/);
    const left = this.offsetLeft + Number(translation?.[1] || 0);
    const top = this.offsetTop + Number(translation?.[2] || 0);
    return { left, top, width: this.offsetWidth, height: this.offsetHeight,
      right: left + this.offsetWidth, bottom: top + this.offsetHeight, x: left, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('composer workspace geometry', () => {
  it('coalesces pointer bursts without rendering the editor, flushes on release and restores after reopening', () => {
    const view = render(<Surface />);
    const panel = view.container.querySelector('section')!;
    const before = renders;
    fireEvent.pointerDown(view.getByText('Drag'), { button: 0, clientX: 800, clientY: 300 });
    for (let n = 1; n <= 30; n++) fireEvent.pointerMove(panel, { clientX: 800 - n * 2, clientY: 300 - n });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(renders).toBe(before);
    act(() => vi.advanceTimersByTime(16));
    expect(panel.style.transform).toBe('translate(-60px, -30px)');
    expect(renders).toBe(before);
    fireEvent.pointerMove(panel, { clientX: 700, clientY: 250 });
    fireEvent.pointerUp(panel);
    expect(panel.style.transform).toBe('translate(-100px, -50px)');
    view.unmount();
    const reopened = render(<Surface />);
    expect(reopened.container.querySelector('section')!.style.transform).toBe('translate(-100px, -50px)');
  });

  it('keeps resized top-left stable and remembers dimensions, including keyboard reset', () => {
    const view = render(<Surface />);
    const panel = view.container.querySelector('section')!;
    const original = panel.getBoundingClientRect();
    fireEvent.pointerDown(view.getByText('Resize'), { button: 0, clientX: original.right, clientY: original.bottom });
    fireEvent.pointerMove(panel, { clientX: original.right - 100, clientY: original.bottom - 80 });
    fireEvent.pointerUp(panel);
    expect(panel.style.width).toBe('660px');
    expect(panel.style.height).toBe('560px');
    expect(panel.getBoundingClientRect().left).toBe(original.left);
    expect(panel.getBoundingClientRect().top).toBe(original.top);
    view.unmount();
    const reopened = render(<Surface />);
    expect(reopened.container.querySelector('section')!.style.width).toBe('660px');
    fireEvent.keyDown(reopened.getByText('Resize'), { key: 'ArrowRight' });
    expect(reopened.container.querySelector('section')!.style.width).toBe('676px');
    fireEvent.keyDown(reopened.getByText('Resize'), { key: 'Home' });
    expect(reopened.container.querySelector('section')!.style.width).toBe('');
    expect(reopened.container.querySelector('section')!.style.transform).toBe('translate(0px, 0px)');
  });

  it('fits stored geometry after a smaller screen, and removes floating styles on mobile/native surfaces', () => {
    localStorage.setItem('better-email-composer-geometry-v1', JSON.stringify({ x: -1500, y: -900, width: 2000, height: 1500 }));
    const view = render(<Surface />);
    const panel = view.container.querySelector('section')!;
    expect(panel.getBoundingClientRect().left).toBe(16);
    expect(panel.getBoundingClientRect().top).toBe(16);
    expect(panel.getBoundingClientRect().right).toBe(innerWidth - 16);
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('innerHeight', 768);
    fireEvent(window, new Event('resize'));
    expect(panel.getBoundingClientRect().right).toBe(1008);
    expect(panel.getBoundingClientRect().bottom).toBe(752);
    view.rerender(<Surface enabled={false} />);
    expect(panel.style.transform).toBe('');
    expect(panel.style.width).toBe('');
    expect(panel.style.height).toBe('');
  });

  it('flushes a cancelled gesture and cancels its scheduled frame on minimize', () => {
    const view = render(<Surface />);
    const panel = view.container.querySelector('section')!;
    fireEvent.pointerDown(view.getByText('Drag'), { button: 0, clientX: 800, clientY: 300 });
    fireEvent.pointerMove(panel, { clientX: 740, clientY: 270 });
    view.rerender(<Surface active={false} />);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(panel.style.transform).toBe('translate(-60px, -30px)');
    expect(panel.dataset.geometryActive).toBeUndefined();
  });
});

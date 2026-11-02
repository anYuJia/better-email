import { useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useReaderScrollPosition from './useReaderScrollPosition';

const observers: { callback: ResizeObserverCallback; disconnect: ReturnType<typeof vi.fn> }[] = [];
afterEach(() => { cleanup(); vi.unstubAllGlobals(); observers.length = 0; });

function Harness({ id, ready = true, positions }: { id: string | null; ready?: boolean; positions: Map<string, number> }) {
  const ref = useRef<HTMLDivElement>(null);
  useReaderScrollPosition(ref, id, ready, positions);
  return <div ref={ref} data-testid="panel"><article className="reader">{id}</article></div>;
}

describe('reader reading position', () => {
  it('starts a different message at the top, restores a previous one, and ignores metadata rerenders', () => {
    const positions = new Map<string, number>();
    const view = render(<Harness id="1:10" positions={positions} />);
    const panel = view.getByTestId('panel');
    panel.scrollTop = 840;
    fireEvent.scroll(panel);
    view.rerender(<Harness id="1:20" positions={positions} />);
    expect(panel.scrollTop).toBe(0);
    panel.scrollTop = 260;
    fireEvent.scroll(panel);
    view.rerender(<Harness id="1:10" positions={positions} />);
    expect(panel.scrollTop).toBe(840);
    view.rerender(<Harness id="1:10" positions={positions} />);
    expect(panel.scrollTop).toBe(840);
  });

  it('keeps the offset through a detail loading gap and mobile unmount', () => {
    const positions = new Map([['1:10', 640]]);
    const view = render(<Harness id="1:10" ready={false} positions={positions} />);
    expect(view.getByTestId('panel').scrollTop).toBe(0);
    view.rerender(<Harness id="1:10" ready positions={positions} />);
    expect(view.getByTestId('panel').scrollTop).toBe(640);
    view.rerender(<Harness id={null} positions={positions} />);
    expect(positions.get('1:10')).toBe(640);
    view.unmount();
    const next = render(<Harness id="1:10" positions={positions} />);
    expect(next.getByTestId('panel').scrollTop).toBe(640);
    next.rerender(<Harness id="2:10" positions={positions} />);
    expect(next.getByTestId('panel').scrollTop).toBe(0);
  });

  it.each([false, true])('waits for image layout but yields to user scroll: %s', (userScrolls) => {
    vi.stubGlobal('ResizeObserver', class {
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(callback: ResizeObserverCallback) { observers.push({ callback, disconnect: this.disconnect }); }
    });
    const positions = new Map([['1:10', 800]]);
    const view = render(<Harness id="1:10" ready={false} positions={positions} />);
    const panel = view.getByTestId('panel');
    let maximum = 200;
    let scroll = 0;
    Object.defineProperty(panel, 'scrollTop', {
      get: () => scroll,
      set: (value: number) => { scroll = Math.min(value, maximum); },
    });
    view.rerender(<Harness id="1:10" ready positions={positions} />);
    expect(scroll).toBe(200);
    fireEvent.scroll(panel);
    expect(positions.get('1:10')).toBe(800);
    if (userScrolls) {
      fireEvent.wheel(panel);
      panel.scrollTop = 90;
      fireEvent.scroll(panel);
    }
    maximum = 1200;
    act(() => observers[0].callback([], {} as ResizeObserver));
    expect(scroll).toBe(userScrolls ? 90 : 800);
    expect(positions.get('1:10')).toBe(userScrolls ? 90 : 800);
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('bounds the workspace cache while keeping recently visited positions', () => {
    const positions = new Map<string, number>();
    const view = render(<Harness id="1:0" positions={positions} />);
    for (let id = 1; id <= 100; id += 1) view.rerender(<Harness id={`1:${id}`} positions={positions} />);
    expect(positions.size).toBe(80);
    expect(positions.has('1:0')).toBe(false);
    expect(positions.has('1:100')).toBe(true);
  });

  it('resumes a pending offset after the same message temporarily becomes unready', () => {
    const positions = new Map([['1:10', 800]]);
    const view = render(<Harness id="1:10" ready={false} positions={positions} />);
    const panel = view.getByTestId('panel');
    let maximum = 200;
    let scroll = 0;
    Object.defineProperty(panel, 'scrollTop', {
      get: () => scroll,
      set: (value: number) => { scroll = Math.min(value, maximum); },
    });
    view.rerender(<Harness id="1:10" ready positions={positions} />);
    expect(scroll).toBe(200);
    view.rerender(<Harness id="1:10" ready={false} positions={positions} />);
    maximum = 1200;
    view.rerender(<Harness id="1:10" ready positions={positions} />);
    expect(scroll).toBe(800);
    panel.scrollTop = 500;
    fireEvent.scroll(panel);
    view.rerender(<Harness id="1:10" ready={false} positions={positions} />);
    panel.scrollTop = 0;
    view.rerender(<Harness id="1:10" ready positions={positions} />);
    expect(scroll).toBe(500);
  });
});

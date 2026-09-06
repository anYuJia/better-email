import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useLongPress from './useLongPress';

function Row({ onMenu, onOpen, id = 1 }: { onMenu: () => void; onOpen: () => void; id?: number }) {
  const { consumeContextGesture: _, ...events } = useLongPress(true, id, onMenu);
  return <div {...events}><button onClick={onOpen}>打开邮件</button></div>;
}
const touch = { identifier: 1, clientX: 10, clientY: 20 };
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('long press gesture ownership', () => {
  it('opens the menu once and consumes the synthesized click, then allows the next tap', () => {
    vi.useFakeTimers();
    const onMenu = vi.fn(); const onOpen = vi.fn();
    render(<Row onMenu={onMenu} onOpen={onOpen} />);
    const button = screen.getByRole('button');
    fireEvent.touchStart(button, { touches: [touch] });
    act(() => vi.advanceTimersByTime(480));
    fireEvent.touchEnd(button);
    fireEvent.click(button, { detail: 1 });
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.touchStart(button, { touches: [touch] });
    fireEvent.touchEnd(button);
    fireEvent.click(button, { detail: 1 });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it.each(['move', 'cancel', 'multitouch', 'empty', 'unmount', 'identity'])('cleans up a %s gesture', (kind) => {
    vi.useFakeTimers();
    const onMenu = vi.fn(); const onOpen = vi.fn();
    const view = render(<Row onMenu={onMenu} onOpen={onOpen} />);
    const button = screen.getByRole('button');
    fireEvent.touchStart(button, { touches: [touch] });
    if (kind === 'move') fireEvent.touchMove(button, { touches: [{ ...touch, clientY: 50 }] });
    if (kind === 'cancel') fireEvent.touchCancel(button);
    if (kind === 'multitouch') fireEvent.touchMove(button, { touches: [touch, { ...touch, identifier: 2 }] });
    if (kind === 'empty') fireEvent.touchMove(button, { touches: [] });
    if (kind === 'unmount') view.unmount();
    if (kind === 'identity') view.rerender(<Row id={2} onMenu={onMenu} onOpen={onOpen} />);
    act(() => vi.advanceTimersByTime(600));
    expect(onMenu).not.toHaveBeenCalled();
  });
  it('keeps keyboard activation available after a touch menu', () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(<Row onMenu={vi.fn()} onOpen={onOpen} />);
    const button = screen.getByRole('button');
    fireEvent.touchStart(button, { touches: [touch] });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.touchEnd(button);
    fireEvent.click(button, { detail: 0 });
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

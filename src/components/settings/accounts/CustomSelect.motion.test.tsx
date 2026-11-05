import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CustomSelect } from './CustomSelect';

type AnimationStub = { cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; currentTime: number; onfinish: (() => void) | null };
const animations: { element: HTMLElement; frames: Keyframe[]; animation: AnimationStub }[] = [];
const preferenceListeners = new Set<(event: MediaQueryListEvent) => void>();
const nativeAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => preferenceListeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => preferenceListeners.delete(listener),
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 30, 240, 140));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: function (this: HTMLElement, frames: Keyframe[]) {
    const animation: AnimationStub = { cancel: vi.fn(), pause: vi.fn(), currentTime: 0, onfinish: null };
    animations.push({ element: this, frames, animation }); return animation;
  } });
});
afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  animations.length = 0; preferenceListeners.clear();
  if (nativeAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', nativeAnimate);
  else delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

const options = [{ value: 'one', label: '第一项' }, { value: 'two', label: '第二项' }];
function fixture(active = true) {
  return <CustomSelect active={active} ariaLabel="范围" options={options} value="one" onChange={vi.fn()} />;
}
function open() {
  const trigger = screen.getByRole('combobox');
  trigger.focus(); fireEvent.click(trigger);
  return { trigger, panel: screen.getByRole('listbox') };
}

describe('shared select motion continuity', () => {
  it('reopens from the current frame without replacing options, waiting another frame or losing focus', () => {
    render(fixture()); const { trigger, panel } = open();
    const option = panel.querySelector('[role="option"]'); panel.scrollTop = 42;
    act(() => animations[0].animation.onfinish?.());
    fireEvent.click(trigger);
    panel.style.opacity = '.54'; panel.style.transform = 'matrix(0.99, 0, 0, 0.99, 0, -1.2)';
    const exit = animations[animations.length - 1]; exit.animation.currentTime = 40;
    fireEvent.click(trigger);
    const reopen = animations[animations.length - 1];
    expect(exit.animation.pause).toHaveBeenCalledOnce();
    expect(reopen.frames[0]).toEqual(expect.objectContaining({ opacity: '0.54', transform: 'matrix(0.99, 0, 0, 0.99, 0, -1.2)' }));
    expect(screen.getByRole('listbox')).toBe(panel);
    expect(panel.querySelector('[role="option"]')).toBe(option);
    expect(panel.scrollTop).toBe(42);
    expect(panel.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(trigger);
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('listbox')).toBe(panel);
  });

  it('dismisses semantics immediately and retains the exact panel only until animation completion', () => {
    render(fixture()); const { trigger, panel } = open();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(panel.isConnected).toBe(true);
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(panel.style.pointerEvents).toBe('none');
    act(() => animations[animations.length - 1].animation.onfinish?.());
    expect(panel.isConnected).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('finishes a retained exit immediately if reduced motion is enabled', () => {
    render(fixture()); const { trigger, panel } = open(); fireEvent.click(trigger);
    expect(panel.isConnected).toBe(true);
    act(() => { for (const listener of preferenceListeners) listener({ matches: true } as MediaQueryListEvent); });
    expect(panel.isConnected).toBe(false);
    expect(preferenceListeners.size).toBe(0);
  });

  it('cancels pending motion when the owning surface becomes inactive and never revives a portal', () => {
    const view = render(fixture()); const { panel } = open();
    view.rerender(fixture(false));
    expect(panel.isConnected).toBe(false);
    expect(animations[0].animation.cancel).toHaveBeenCalled();
    view.rerender(fixture());
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

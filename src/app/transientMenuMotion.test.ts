import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelMenuExit, enterMenu, exitMenu, finishMenuEnter, pauseMenuExit } from './transientMenuMotion';

type AnimationStub = { cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onfinish: (() => void) | null; currentTime: number | null };
const animations: { element: HTMLElement; frames: Keyframe[]; timing: KeyframeAnimationOptions; animation: AnimationStub }[] = [];
const owner = {};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true,
    value: vi.fn(function (this: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      const animation = { cancel: vi.fn(), pause: vi.fn(), onfinish: null, currentTime: 0 };
      animations.push({ element: this, frames, timing, animation }); return animation;
    }),
  });
});
afterEach(() => {
  cancelMenuExit(owner); vi.runOnlyPendingTimers(); document.body.replaceChildren(); animations.length = 0;
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
function surface() {
  const panel = document.createElement('div');
  panel.innerHTML = '<input aria-label="Filter"><button role="menuitem">Open</button>';
  document.body.appendChild(panel);
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 200, 80));
  return panel;
}
describe('same-DOM transient menu motion', () => {
  it('enters from the trigger and removes the containing transform after settling', () => {
    const panel = surface(); enterMenu(panel, owner, 170, 80, false);
    expect(panel.style.transformOrigin).toBe('170px 80px');
    expect(animations[0].frames[0].transform).toContain('translateY(3px)');
    animations[0].animation.onfinish?.();
    expect(panel.hasAttribute('data-menu-motion')).toBe(false);
    expect(animations[0].animation.cancel).toHaveBeenCalledOnce();
  });
  it('retains the exact form DOM and browser state while disabling its outgoing semantics', () => {
    const panel = surface(); const input = panel.querySelector('input')!; input.value = '未提交输入'; panel.scrollTop = 24;
    const clone = vi.spyOn(panel, 'cloneNode'); const done = vi.fn();
    enterMenu(panel, owner, 0, 0); panel.style.opacity = '.45'; exitMenu(panel, owner, done);
    expect(clone).not.toHaveBeenCalled();
    expect(document.querySelector('[data-transient-exit]')).toBe(panel);
    expect(panel.querySelector('input')).toBe(input); expect(input.value).toBe('未提交输入'); expect(panel.scrollTop).toBe(24);
    expect(panel.hasAttribute('inert')).toBe(true); expect(panel.getAttribute('aria-hidden')).toBe('true');
    expect(panel.style.pointerEvents).toBe('none'); expect(done).not.toHaveBeenCalled();
    expect(animations[1].frames[0].opacity).toBe('0.45');
    animations[1].animation.onfinish?.(); expect(done).toHaveBeenCalledOnce();
    expect(panel.hasAttribute('data-transient-exit')).toBe(false);
  });
  it('reverses from the painted frame without executing the obsolete close callback', () => {
    const panel = surface(); const done = vi.fn(); exitMenu(panel, owner, done);
    panel.style.opacity = '.6'; panel.style.transform = 'matrix(0.994, 0, 0, 0.994, 0, -1.2)';
    enterMenu(panel, owner, 170, 0);
    expect(animations[1].element).toBe(panel); expect(animations[1].frames[0].opacity).toBe('0.6');
    expect(animations[1].timing.duration).toBeCloseTo(72);
    expect(panel.hasAttribute('inert')).toBe(false); expect(panel.hasAttribute('aria-hidden')).toBe(false);
    vi.advanceTimersByTime(300); expect(done).not.toHaveBeenCalled(); expect(panel.isConnected).toBe(true);
  });
  it('keeps exit style reads constant for 3 and 300 options and never clones either menu', () => {
    const counts = [];
    for (const count of [3, 300]) {
      const panel = surface(); panel.innerHTML = '<button><svg><path /></svg><span>Label</span></button>'.repeat(count);
      const clone = vi.spyOn(panel, 'cloneNode'); const styles = vi.spyOn(window, 'getComputedStyle');
      exitMenu(panel, owner); counts.push(styles.mock.calls.length);
      expect(clone).not.toHaveBeenCalled(); expect(animations[animations.length - 1].element).toBe(panel);
      styles.mockRestore(); cancelMenuExit(owner);
    }
    expect(counts[0]).toBe(counts[1]); expect(counts[0]).toBeLessThanOrEqual(4);
  });
  it('leaves fixed flyouts in their original viewport coordinate system during exit', () => {
    const panel = surface(); panel.innerHTML = '<div class="context-submenu" style="position:fixed;left:225px;top:115px"><button>Nested</button></div>';
    const flyout = panel.firstElementChild; exitMenu(panel, owner);
    expect(animations[0].frames.every(frame => frame.transform === undefined)).toBe(true);
    expect(panel.firstElementChild).toBe(flyout); expect(document.querySelectorAll('[data-transient-exit]')).toHaveLength(1);
  });
  it('pauses once before the next floating-placement frame and preserves the hold time', () => {
    const panel = surface(); exitMenu(panel, owner); panel.style.opacity = '.35';
    animations[0].animation.currentTime = 33; pauseMenuExit(owner); pauseMenuExit(owner);
    expect(animations[0].animation.pause).toHaveBeenCalledOnce(); expect(animations[0].animation.currentTime).toBe(33);
    enterMenu(panel, owner, 0, 0); expect(animations[1].frames[0].opacity).toBe('0.35');
  });
  it('closes synchronously for reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const panel = surface(); const done = vi.fn(); enterMenu(panel, owner, 0, 0); exitMenu(panel, owner, done);
    expect(animations).toHaveLength(0); expect(done).toHaveBeenCalledOnce();
  });
  it('settles an exit when reduced motion changes live', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.add(fn), removeEventListener: (_: string, fn: (event: MediaQueryListEvent) => void) => listeners.delete(fn) }));
    const panel = surface(); const done = vi.fn(); exitMenu(panel, owner, done);
    for (const fn of listeners) fn({ matches: true } as MediaQueryListEvent);
    expect(done).toHaveBeenCalledOnce(); expect(listeners.size).toBe(0);
  });
  it('bounds cleanup when a hidden WebView does not deliver animation finish', () => {
    const panel = surface(); const done = vi.fn(); exitMenu(panel, owner, done); pauseMenuExit(owner);
    vi.advanceTimersByTime(170); expect(done).toHaveBeenCalledOnce(); expect(panel.hasAttribute('data-transient-exit')).toBe(false);
    finishMenuEnter(panel);
  });
});

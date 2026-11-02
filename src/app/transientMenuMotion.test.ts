import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelMenuExit, enterMenu, exitMenu, finishMenuEnter, pauseMenuExit } from './transientMenuMotion';

type AnimationStub = { cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onfinish: (() => void) | null; currentTime: number | null };
const animations: { element: HTMLElement; frames: Keyframe[]; timing: KeyframeAnimationOptions; animation: AnimationStub }[] = [];
const owner = {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  vi.stubGlobal('Animation', class {});
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true, value: vi.fn(function (this: HTMLElement, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      const animation = { cancel: vi.fn(), pause: vi.fn(), onfinish: null, currentTime: 0 };
      animations.push({ element: this, frames, timing, animation });
      return animation;
    }),
  });
});

afterEach(() => {
  cancelMenuExit(owner);
  vi.runOnlyPendingTimers();
  document.body.replaceChildren();
  animations.length = 0;
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function surface() {
  const panel = document.createElement('div');
  panel.id = 'live-menu';
  panel.innerHTML = '<button id="live-action" data-context-item="open" role="menuitem">Open</button>';
  document.body.appendChild(panel);
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 30, left: 20, top: 30, width: 200, height: 80, right: 220, bottom: 110 } as DOMRect);
  return panel;
}

describe('transient menu visual lifecycle', () => {
  it('enters from the supplied trigger origin and settles without retaining a transform', () => {
    const panel = surface();
    enterMenu(panel, owner, 170, 80, false);
    expect(panel.style.transformOrigin).toBe('170px 80px');
    expect(animations[0].timing.duration).toBe(180);
    expect(animations[0].frames[0].transform).toContain('translateY(3px)');
    animations[0].animation.onfinish?.();
    expect(panel.hasAttribute('data-menu-motion')).toBe(false);
    expect(animations[0].animation.cancel).toHaveBeenCalledTimes(1);
  });

  it('interrupts an entrance with a noninteractive exit that does not retain IDs or menu roles', () => {
    const panel = surface();
    enterMenu(panel, owner, 0, 0);
    panel.style.opacity = '0.45';
    exitMenu(panel, owner);
    expect(animations[0].animation.cancel).toHaveBeenCalledTimes(1);
    const visual = document.querySelector<HTMLElement>('[data-transient-exit]')!;
    expect(visual.hasAttribute('inert')).toBe(true);
    expect(visual.getAttribute('aria-hidden')).toBe('true');
    expect(visual.style.pointerEvents).toBe('none');
    expect(visual.querySelector('[id], [role], [data-context-item]')).toBeNull();
    expect(visual.querySelector('button')?.tabIndex).toBe(-1);
    expect(animations[1].timing.duration).toBe(120);
    expect(animations[1].frames[0].opacity).toBe('0.45');
    panel.remove();
    expect(visual.isConnected).toBe(true);
    animations[1].animation.onfinish?.();
    expect(visual.isConnected).toBe(false);
  });

  it('cancels an old exit when the same trigger reopens without an old timer removing the new menu', () => {
    const first = surface();
    exitMenu(first, owner);
    document.querySelector<HTMLElement>('[data-transient-exit]')!.style.opacity = '0.4';
    first.remove();
    const next = surface();
    enterMenu(next, owner, 0, 0);
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
    expect(animations[0].animation.cancel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(175);
    expect(next.isConnected).toBe(true);
    expect(next.hasAttribute('data-menu-motion')).toBe(false);
    finishMenuEnter(next);
  });

  it('reverses a closing menu from its painted opacity and transform with only the remaining duration', () => {
    const panel = surface();
    exitMenu(panel, owner);
    panel.remove();
    const outgoing = document.querySelector<HTMLElement>('[data-transient-exit]')!;
    outgoing.style.opacity = '0.6';
    outgoing.style.transform = 'matrix(0.994, 0, 0, 0.994, 0, -1.2)';
    outgoing.style.transformOrigin = '170px 0px';

    const next = surface();
    enterMenu(next, owner, 170, 0);
    const entrance = animations[animations.length - 1];
    expect(entrance.element).toBe(next);
    expect(entrance.frames[0]).toEqual({ opacity: '0.6', transform: 'matrix(0.994, 0, 0, 0.994, 0, -1.2)' });
    expect(entrance.timing.duration).toBeCloseTo(72);
    expect(next.style.transformOrigin).toBe('170px 0px');
    expect(outgoing.isConnected).toBe(false);
    expect(next.hasAttribute('inert')).toBe(false);
    vi.advanceTimersByTime(300);
    expect(next.isConnected).toBe(true);
    expect(next.hasAttribute('data-menu-motion')).toBe(false);
  });

  it('uses a fresh entrance if the same context owner opens a different position', () => {
    const panel = surface();
    exitMenu(panel, owner);
    document.querySelector<HTMLElement>('[data-transient-exit]')!.style.opacity = '0.6';
    panel.remove();
    const next = surface();
    vi.mocked(next.getBoundingClientRect).mockReturnValue(new DOMRect(300, 30, 200, 80));
    enterMenu(next, owner, 0, 0);
    expect(animations[animations.length - 1].frames[0].opacity).toBe(0);
    expect(animations[animations.length - 1].timing.duration).toBe(180);
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
  });

  it('pauses an outgoing frame once while a reopening panel awaits positioning', () => {
    const panel = surface();
    exitMenu(panel, owner);
    const outgoing = document.querySelector<HTMLElement>('[data-transient-exit]')!;
    outgoing.style.opacity = '0.35';
    outgoing.style.transform = 'matrix(0.99, 0, 0, 0.99, 0, -2)';
    pauseMenuExit(owner);
    pauseMenuExit(owner);
    expect(animations[0].animation.pause).toHaveBeenCalledOnce();
    expect(animations[0].animation.cancel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(outgoing.isConnected).toBe(true);
    enterMenu(panel, owner, 0, 0);
    expect(animations[1].frames[0].opacity).toBe('0.35');
    expect(outgoing.isConnected).toBe(false);
  });

  it('cleans up a paused exit if reopening is abandoned before positioning', () => {
    const panel = surface();
    exitMenu(panel, owner);
    pauseMenuExit(owner);
    panel.remove();
    vi.advanceTimersByTime(170);
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
    expect(animations[0].animation.cancel).toHaveBeenCalledOnce();
  });

  it('holds the interruption time synchronously when native pause would settle on a later frame', () => {
    const panel = surface();
    exitMenu(panel, owner);
    const outgoing = document.querySelector<HTMLElement>('[data-transient-exit]')!;
    const animation = animations[0].animation;
    let time = 33;
    let pausePending = false;
    animation.pause.mockImplementation(() => { pausePending = true; });
    Object.defineProperty(animation, 'currentTime', {
      get: () => time,
      set: (value: number) => { time = value; pausePending = false; },
    });
    outgoing.style.opacity = '0.195';
    pauseMenuExit(owner);
    // Browsers resolve an unheld pending pause on the next frame, allowing
    // exit opacity to fall before floating-menu positioning can sample it.
    if (pausePending) { time += 16; outgoing.style.opacity = '0.073'; }
    expect(time).toBe(33);
    expect(pausePending).toBe(false);
    enterMenu(panel, owner, 0, 0);
    expect(animations[1].frames[0].opacity).toBe('0.195');
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
  });

  it('keeps the current entrance frame when positioning restarts before completion', () => {
    const panel = surface();
    enterMenu(panel, owner, 0, 0);
    panel.style.opacity = '0.7';
    panel.style.transform = 'matrix(0.9955, 0, 0, 0.9955, 0, -0.9)';
    enterMenu(panel, owner, 0, 0);
    expect(animations[0].animation.cancel).toHaveBeenCalledTimes(1);
    expect(animations[1].frames[0].opacity).toBe('0.7');
    expect(animations[1].frames[0].transform).toBe('matrix(0.9955, 0, 0, 0.9955, 0, -0.9)');
    expect(animations[1].timing.duration).toBeCloseTo(54);
    finishMenuEnter(panel);
  });

  it('skips expensive exit cloning for large menus and still clears older visual ownership', () => {
    const old = surface();
    exitMenu(old, owner);
    const oldVisual = document.querySelector('[data-transient-exit]')!;
    const large = surface();
    large.innerHTML = '<button><svg><path /></svg><span>Label</span></button>'.repeat(300);
    enterMenu(large, {}, 0, 0);
    const clone = vi.spyOn(large, 'cloneNode');
    const styles = vi.spyOn(window, 'getComputedStyle');
    const countBeforeExit = animations.length;
    exitMenu(large, owner);
    expect(clone).not.toHaveBeenCalled();
    expect(styles).toHaveBeenCalledTimes(1); // duration only; no per-node style copying
    expect(animations).toHaveLength(countBeforeExit);
    expect(large.hasAttribute('data-menu-motion')).toBe(false);
    expect(oldVisual.isConnected).toBe(false);
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
  });

  it('keeps a fixed nested flyout in viewport space outside the parent scroll clip and cancels the whole group', () => {
    const panel = surface();
    panel.style.overflow = 'auto';
    panel.innerHTML = '<div style="position:relative;margin-top:90px"><button>Branch</button><div style="position:fixed;display:block;overflow:auto"><button>Nested action</button></div></div>';
    const flyout = panel.querySelector<HTMLElement>(':scope > div > div')!;
    vi.spyOn(flyout, 'getBoundingClientRect').mockReturnValue({
      x: 225, y: 115, left: 225, top: 115, width: 190, height: 100, right: 415, bottom: 215,
    } as DOMRect);
    exitMenu(panel, owner);

    const visuals = Array.from(document.querySelectorAll<HTMLElement>('[data-transient-exit]'));
    expect(visuals).toHaveLength(2);
    const rootVisual = visuals[0];
    const flyoutVisual = visuals[1];
    expect(rootVisual.style.overflow).toBe('auto');
    expect(flyoutVisual.parentElement).toBe(document.body);
    expect(rootVisual.contains(flyoutVisual)).toBe(false);
    expect(flyoutVisual.style.position).toBe('fixed');
    expect(flyoutVisual.style.left).toBe('225px');
    expect(flyoutVisual.style.top).toBe('115px');
    expect(flyoutVisual.style.width).toBe('190px');
    expect(flyoutVisual.hasAttribute('inert')).toBe(true);
    expect(flyoutVisual.getAttribute('aria-hidden')).toBe('true');

    // One completed surface must not release the other surface's owner.
    animations[0].animation.onfinish?.();
    expect(rootVisual.isConnected).toBe(false);
    expect(flyoutVisual.isConnected).toBe(true);
    enterMenu(panel, owner, 0, 0);
    expect(flyoutVisual.isConnected).toBe(false);
    expect(animations[1].animation.cancel).toHaveBeenCalledTimes(1);
  });

  it('skips both entrance and exit when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const panel = surface();
    enterMenu(panel, owner, 0, 0);
    exitMenu(panel, owner);
    expect(animations).toHaveLength(0);
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
  });

  it('settles running entrances and removes exit visuals when reduced motion changes live', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = {
      matches: false,
      addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const panel = surface();
    enterMenu(panel, owner, 0, 0);
    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
    expect(panel.hasAttribute('data-menu-motion')).toBe(false);
    expect(listeners.size).toBe(0);

    exitMenu(panel, owner);
    expect(document.querySelector('[data-transient-exit]')).not.toBeNull();
    for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
    expect(listeners.size).toBe(0);
    expect(media.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it('has a bounded cleanup fallback when the WebView does not deliver animation finish', () => {
    const panel = surface();
    exitMenu(panel, owner);
    vi.advanceTimersByTime(170);
    expect(document.querySelector('[data-transient-exit]')).toBeNull();
    expect(animations[0].animation.cancel).toHaveBeenCalledTimes(1);
  });
});

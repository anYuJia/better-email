import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useSettingsSurfaceMotion from './useSettingsSurfaceMotion';

function Surface({ active, onExited, enabled = true }: { active: boolean; onExited: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useSettingsSurfaceMotion(ref, active, { enabled, onExited });
  return <div ref={ref} />;
}

const originalAnimate = HTMLElement.prototype.animate;
afterEach(() => {
  cleanup();
  HTMLElement.prototype.animate = originalAnimate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Settings mobile surface motion', () => {
  it('reverses from the live position and ignores stale completions without transforming fixed descendants', () => {
    const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }> = [];
    const animate = vi.fn(() => {
      const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null };
      animations.push(animation);
      return animation;
    });
    HTMLElement.prototype.animate = animate as unknown as typeof originalAnimate;
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('getComputedStyle', (element: HTMLElement) => element === document.documentElement
      ? { getPropertyValue: () => '' }
      : { opacity: '0.944', left: '4.14px' });
    const onExited = vi.fn();
    const view = render(<Surface active onExited={onExited} />);
    const oldFinish = animations[0].onfinish!;
    view.rerender(<Surface active={false} onExited={onExited} />);
    expect(animate).toHaveBeenLastCalledWith([
      { left: '4.14px', opacity: 0.944 },
      { left: '12px', opacity: 0 },
    ], expect.objectContaining({ duration: 180 * 0.944, fill: 'both' }));
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    oldFinish();
    expect(onExited).not.toHaveBeenCalled();
    const element = view.container.firstElementChild as HTMLElement;
    expect(element.style.transform).toBe('');
    expect(element.style.translate).toBe('');
    animations[1].onfinish!();
    animations[1].onfinish!();
    expect(onExited).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('settles immediately when reduced motion is enabled during exit', () => {
    let changed: (() => void) | undefined;
    const preference = {
      matches: false,
      addEventListener: vi.fn((_type: string, callback: () => void) => { changed = callback; }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => preference);
    const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null };
    HTMLElement.prototype.animate = vi.fn(() => animation) as unknown as typeof originalAnimate;
    const onExited = vi.fn();
    const view = render(<Surface active onExited={onExited} />);
    view.rerender(<Surface active={false} onExited={onExited} />);
    preference.matches = true;
    changed!();
    expect(onExited).toHaveBeenCalledOnce();
    expect(animation.cancel).toHaveBeenCalled();
    changed!();
    expect(onExited).toHaveBeenCalledOnce();
  });

  it('leaves standalone and desktop surfaces untouched and cleans up a viewport change', () => {
    const onExited = vi.fn();
    const view = render(<Surface active enabled={false} onExited={onExited} />);
    const element = view.container.firstElementChild as HTMLElement;
    expect(element.style.left).toBe('');
    view.rerender(<Surface active onExited={onExited} />);
    expect(element.style.left).toBe('0px');
    view.rerender(<Surface active enabled={false} onExited={onExited} />);
    expect(element.style.left).toBe('');
    expect(element.style.opacity).toBe('');
    expect(onExited).not.toHaveBeenCalled();
  });
});

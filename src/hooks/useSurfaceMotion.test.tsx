import { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useSurfaceMotion from './useSurfaceMotion';

function Surface({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useSurfaceMotion(ref, active, { enabled });
  return <div ref={ref} />;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useSurfaceMotion', () => {
  it('reverses from the painted frame and scales duration to the remaining distance', () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel, onfinish: null }));
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    vi.stubGlobal('getComputedStyle', vi.fn((element: HTMLElement) => element === document.documentElement
      ? { getPropertyValue: () => '' }
      : { opacity: '0.4', translate: '0px 2.4px' }));
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as typeof original;
    try {
      const view = render(<Surface />);
      expect(animate).toHaveBeenCalledTimes(1);
      view.rerender(<Surface active={false} />);
      expect(animate).toHaveBeenLastCalledWith([
        { opacity: 0.4, translate: '0px 2.4px' },
        { opacity: '0', translate: '0px 4px' },
      ], expect.objectContaining({ duration: 72 }));
      expect(cancel).toHaveBeenCalledTimes(1);
      view.rerender(<Surface />);
      expect(animate).toHaveBeenLastCalledWith([
        { opacity: 0.4, translate: '0px 2.4px' },
        { opacity: '1', translate: 'none' },
      ], expect.objectContaining({ duration: 108 }));
      view.rerender(<Surface />);
      expect(animate).toHaveBeenCalledTimes(3);
      view.unmount();
      expect(cancel).toHaveBeenCalledTimes(3);
    } finally {
      HTMLElement.prototype.animate = original;
    }
  });

  it('leaves the stationary base and native windows untouched', () => {
    const view = render(<Surface enabled={false} />);
    const element = view.container.firstElementChild as HTMLElement;
    view.rerender(<Surface enabled={false} active={false} />);
    expect(element.style.opacity).toBe('');
    expect(element.style.translate).toBe('');
  });

  it('applies reduced motion endpoints without starting an animation', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const view = render(<Surface />);
    const element = view.container.firstElementChild as HTMLElement;
    expect(element.style.opacity).toBe('1');
    expect(element.style.translate).toBe('none');
    view.rerender(<Surface active={false} />);
    expect(element.style.opacity).toBe('0');
  });
});

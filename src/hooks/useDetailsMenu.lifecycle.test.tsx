import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDetailsMenu } from './useDetailsMenu';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function FormMenu({ visible = true }: { visible?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [value, setValue] = useState('');
  useDetailsMenu(ref, { floating: true });
  return visible ? <details ref={ref} data-floating-menu="true">
    <summary>标签</summary>
    <div data-floating-menu-panel="true">
      <input aria-label="标签名称" value={value} onChange={event => setValue(event.target.value)} />
    </div>
  </details> : null;
}

describe('floating menu editing continuity', () => {
  it('keeps a positioned form visible and focused while input rerenders await measurement', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback); return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const flushFrame = () => act(() => {
      const queued = [...frames.values()]; frames.clear();
      queued.forEach(callback => callback(0));
    });
    const view = render(<FormMenu visible={false} />);
    view.rerender(<FormMenu />);
    const details = view.container.querySelector('details')!;
    const input = view.getByRole('textbox', { name: '标签名称' });
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(details.hasAttribute('data-menu-positioned')).toBe(false);
    flushFrame();
    expect(details.getAttribute('data-menu-positioned')).toBe('true');
    input.focus();

    for (const value of ['新', '新标', '新标签']) {
      fireEvent.change(input, { target: { value } });
      // This assertion covers the interval before the next animation frame;
      // final-state-only tests missed WebKit's visibility-induced blur.
      expect(details.getAttribute('data-menu-positioned')).toBe('true');
      expect(document.activeElement).toBe(input);
      flushFrame();
      expect(document.activeElement).toBe(input);
    }
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(details.open).toBe(false);
    expect(details.hasAttribute('data-menu-positioned')).toBe(false);
  });
});

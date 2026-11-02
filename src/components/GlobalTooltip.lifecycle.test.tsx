import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalTooltip from './GlobalTooltip';

function Harness({ visible = true }: { visible?: boolean }) {
  return <>
    {visible && <button title="复制地址" aria-describedby="copy-help"><svg aria-hidden="true" /></button>}
    <span id="copy-help">复制完整邮箱地址</span>
    <GlobalTooltip />
  </>;
}

function pointer(target: HTMLElement, type: string, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(target, event);
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('GlobalTooltip input and description ownership', () => {
  it('bounds a long hint to a short viewport and restores its full native text', () => {
    vi.stubGlobal('innerHeight', 200);
    const longTitle = '完整签名与地址说明。'.repeat(40);
    render(<><button title={longTitle}><svg /></button><GlobalTooltip /></>);
    const button = screen.getByRole('button');
    pointer(button, 'pointerover');
    act(() => vi.advanceTimersByTime(350));
    const tooltip = screen.getByRole('tooltip');
    expect(Array.from(tooltip.textContent ?? '')).toHaveLength(120);
    expect(tooltip.querySelector('.global-tooltip-text')?.textContent).toBe(tooltip.textContent);
    expect(tooltip.style.maxHeight).toBe('180px');
    expect(button.getAttribute('aria-describedby')).toBe('global-tooltip');
    pointer(button, 'pointerout');
    expect(button.title).toBe(longTitle);
  });

  it('fits complete text lines inside a boundary after accounting for padding and borders', () => {
    vi.stubGlobal('innerHeight', 160);
    const originalStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalStyle(element);
      if (!element.classList.contains('global-tooltip')) return style;
      const geometry: Record<string, string> = {
        lineHeight: '30px', paddingTop: '6px', paddingBottom: '6px',
        borderTopWidth: '1px', borderBottomWidth: '1px',
      };
      return new Proxy(style, {
        get(target, property) {
          if (typeof property === 'string' && property in geometry) return geometry[property];
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
    render(<><button title={'操作说明。'.repeat(40)}><svg /></button><GlobalTooltip /></>);
    pointer(screen.getByRole('button'), 'pointerover');
    act(() => vi.advanceTimersByTime(350));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.maxHeight).toBe('140px');
    expect(tooltip.style.getPropertyValue('--tooltip-visible-lines')).toBe('4');
  });
  it('waits 350ms initially, then 100ms within a warm tool group and resets after leaving it', () => {
    render(<>
      <div role="toolbar">
        <button title="第一项"><svg /></button><button title="第二项"><svg /></button>
      </div>
      <div><button title="其它区域"><svg /></button></div>
      <GlobalTooltip />
    </>);
    const [first, second, other] = screen.getAllByRole('button');
    pointer(first, 'pointerover');
    act(() => vi.advanceTimersByTime(349));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip').textContent).toBe('第一项');
    pointer(first, 'pointerout');
    pointer(second, 'pointerover');
    act(() => vi.advanceTimersByTime(99));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip').textContent).toBe('第二项');
    pointer(second, 'pointerout');
    pointer(other, 'pointerover');
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole('tooltip').textContent).toBe('其它区域');
    pointer(other, 'pointerout');
    act(() => vi.advanceTimersByTime(1000));
    pointer(other, 'pointerover');
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('does not warm a group from a cancelled pending hint', () => {
    render(<Harness />);
    const button = screen.getByRole('button');
    pointer(button, 'pointerover');
    act(() => vi.advanceTimersByTime(200));
    pointer(button, 'pointerout');
    pointer(button, 'pointerover');
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('keeps a warm group on the same side and clamps near the viewport edge', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(30);
    render(<div role="toolbar">
      <button title="顶部工具"><svg /></button><button title="邻近工具"><svg /></button>
      <GlobalTooltip />
    </div>);
    const [first, second] = screen.getAllByRole('button');
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 12, 32, 32));
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 32, 32));
    pointer(first, 'pointerover');
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByRole('tooltip').classList.contains('is-bottom')).toBe(true);
    pointer(first, 'pointerout');
    pointer(second, 'pointerover');
    act(() => vi.advanceTimersByTime(100));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.classList.contains('is-bottom')).toBe(true);
    expect(tooltip.style.left).toBe('10px');
    expect(tooltip.style.top).toBe('140px');
  });

  it('adds its description without replacing existing help and removes only its own ID', () => {
    const view = render(<Harness />);
    const button = screen.getByRole('button');
    pointer(button, 'pointerover');
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByRole('tooltip').textContent).toBe('复制地址');
    expect(button.getAttribute('aria-describedby')).toBe('copy-help global-tooltip');
    button.setAttribute('aria-describedby', 'copy-help global-tooltip new-help');
    pointer(button, 'pointerout');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe('copy-help new-help');
    expect(button.title).toBe('复制地址');
    pointer(button, 'pointerover');
    view.unmount();
    expect(button.getAttribute('aria-describedby')).toBe('copy-help new-help');
    expect(button.title).toBe('复制地址');
  });

  it('does not reopen a mouse hint from touch focus but still supports subsequent keyboard focus', () => {
    render(<Harness />);
    const button = screen.getByRole('button');
    pointer(button, 'pointerover', 'touch');
    act(() => vi.advanceTimersByTime(350));
    expect(screen.queryByRole('tooltip')).toBeNull();
    pointer(button, 'pointerdown', 'touch');
    act(() => button.focus());
    act(() => vi.advanceTimersByTime(350));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => button.blur());
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => button.focus());
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('does not leave a pending hint behind when its target disappears', () => {
    const view = render(<Harness />);
    pointer(screen.getByRole('button'), 'pointerover');
    view.rerender(<Harness visible={false} />);
    act(() => vi.advanceTimersByTime(350));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not erase a keyboard hint when an unrelated element emits pointerout', () => {
    render(<Harness />);
    act(() => screen.getByRole('button').focus());
    act(() => vi.advanceTimersByTime(350));
    pointer(document.body, 'pointerout');
    expect(screen.getByRole('tooltip')).toBeDefined();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not overwrite a title updated by the owner while the hint is open', () => {
    render(<Harness />);
    const button = screen.getByRole('button');
    pointer(button, 'pointerover');
    act(() => vi.advanceTimersByTime(350));
    button.title = '已复制';
    pointer(button, 'pointerout');
    expect(button.title).toBe('已复制');
  });
});

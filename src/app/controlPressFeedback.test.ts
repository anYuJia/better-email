import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installControlPressFeedback } from './inputPolicy';

function pointer(target: EventTarget, type: string, options: {
  pointerType?: string;
  pointerId?: number;
  x?: number;
  y?: number;
  primary?: boolean;
} = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: options.x ?? 20,
    clientY: options.y ?? 20,
  });
  Object.defineProperties(event, {
    pointerType: { value: options.pointerType ?? 'touch' },
    pointerId: { value: options.pointerId ?? 1 },
    isPrimary: { value: options.primary ?? true },
  });
  target.dispatchEvent(event);
  return event;
}

describe('touch and pen feedback for explicitly opted-in actions', () => {
  let dispose: () => void;
  let action: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <button id="action" style="--ui-control-feedback:tactile"><span>Compose</span></button>
      <button id="row">Menu row</button><input id="input">
    `;
    action = document.querySelector<HTMLButtonElement>('#action')!;
    vi.spyOn(action, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 44));
    dispose = installControlPressFeedback();
  });

  afterEach(() => {
    dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it.each(['touch', 'pen'])('responds immediately to %s without cancelling input or duplicating clicks', (pointerType) => {
    const click = vi.fn();
    action.addEventListener('click', click);
    const down = pointer(action.querySelector('span')!, 'pointerdown', { pointerType });
    expect(action.dataset.uiPressed).toBe('true');
    expect(down.defaultPrevented).toBe(false);
    expect(click).not.toHaveBeenCalled();
    const up = pointer(action, 'pointerup', { pointerType });
    expect(action.dataset.uiPressed).toBe('false');
    expect(up.defaultPrevented).toBe(false);
    expect(click).not.toHaveBeenCalled();
    action.click();
    expect(click).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20);
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
  });

  it('leaves mouse input, menu rows, fields and controls without the motion opt-in alone', () => {
    pointer(action, 'pointerdown', { pointerType: 'mouse' });
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
    for (const selector of ['#row', '#input']) {
      const target = document.querySelector<HTMLElement>(selector)!;
      pointer(target, 'pointerdown');
      expect(target.hasAttribute('data-ui-pressed')).toBe(false);
    }
    // Reduced-motion CSS omits this marker entirely.
    action.style.removeProperty('--ui-control-feedback');
    pointer(action, 'pointerdown');
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
  });

  it.each(['disabled', 'aria-disabled', 'aria-busy', 'inert'])('does not press a %s action', (state) => {
    if (state === 'inert') document.body.setAttribute('inert', '');
    else action.setAttribute(state, state === 'disabled' ? '' : 'true');
    pointer(action, 'pointerdown');
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
    document.body.removeAttribute('inert');
  });

  it('cancels feedback when moving beyond the tap tolerance without preventing scrolling', () => {
    pointer(action, 'pointerdown');
    pointer(action, 'pointermove', { x: 23 });
    expect(action.dataset.uiPressed).toBe('true');
    const move = pointer(action, 'pointermove', { y: 31 });
    expect(action.dataset.uiPressed).toBe('false');
    expect(move.defaultPrevented).toBe(false);
    pointer(action, 'pointermove');
    expect(action.dataset.uiPressed).toBe('false');
    pointer(action, 'pointerup');
    vi.advanceTimersByTime(20);
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
  });

  it('cancels on leaving the action even inside the movement tolerance', () => {
    pointer(action, 'pointerdown', { x: 2 });
    pointer(action, 'pointermove', { x: -1 });
    expect(action.dataset.uiPressed).toBe('false');
  });

  it.each(['pointercancel', 'lostpointercapture'])('clears %s for the matching pointer only', (type) => {
    pointer(action, 'pointerdown');
    pointer(action, type, { pointerId: 2 });
    expect(action.dataset.uiPressed).toBe('true');
    pointer(action, type);
    expect(action.dataset.uiPressed).toBe('false');
    vi.advanceTimersByTime(200);
    expect(action.dataset.uiPressed).toBe('false');
  });

  it('clears on scrolling, window blur and document hiding', () => {
    pointer(action, 'pointerdown');
    action.dispatchEvent(new Event('scroll'));
    expect(action.dataset.uiPressed).toBe('false');
    pointer(action, 'pointerdown');
    window.dispatchEvent(new Event('blur'));
    expect(action.dataset.uiPressed).toBe('false');
    pointer(action, 'pointerdown');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(action.dataset.uiPressed).toBe('false');
  });

  it('releases a previous press when another finger begins a gesture', () => {
    pointer(action, 'pointerdown');
    pointer(action, 'pointerdown', { pointerId: 2, primary: false });
    expect(action.dataset.uiPressed).toBe('false');
  });

  it.each(['Enter', ' '])('releases cancelled pointer ownership for keyboard activation with %s', (key) => {
    pointer(action, 'pointerdown');
    pointer(action, 'pointermove', { x: 40 });
    const keyboard = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    action.dispatchEvent(keyboard);
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
    expect(keyboard.defaultPrevented).toBe(false);
  });

  it('allows mouse input after a cancelled touch', () => {
    pointer(action, 'pointerdown');
    pointer(action, 'pointercancel');
    pointer(action, 'pointerdown', { pointerType: 'mouse' });
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
  });

  it('does not let delayed release cleanup erase a rapid next press', () => {
    pointer(action, 'pointerdown');
    pointer(action, 'pointerup');
    pointer(action, 'pointerdown', { pointerId: 2 });
    vi.advanceTimersByTime(20);
    expect(action.dataset.uiPressed).toBe('true');
    pointer(action, 'pointerup', { pointerId: 2 });
    vi.advanceTimersByTime(20);
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
  });

  it('removes feedback and event listeners when disposed', () => {
    pointer(action, 'pointerdown');
    dispose();
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
    pointer(action, 'pointerdown');
    expect(action.hasAttribute('data-ui-pressed')).toBe(false);
  });
});

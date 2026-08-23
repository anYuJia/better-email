import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import SnoozePicker from './SnoozePicker';

afterEach(() => {
  cleanup();
});

function flushEffects() {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function Harness({ onConfirm = vi.fn(async () => undefined) }: { onConfirm?: () => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <div data-testid="app-container">
      <button type="button" data-testid="trigger">触发按钮</button>
      {open && (
        <SnoozePicker
          targetCount={1}
          targetLabel="测试邮件"
          onConfirm={onConfirm}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function dialog() {
  return document.querySelector('.snooze-dialog') as HTMLElement;
}

function backdrop() {
  return document.querySelector('.snooze-backdrop') as HTMLElement;
}

describe('SnoozePicker modal focus management', () => {
  it('focuses a preset on open and makes the application background inert', async () => {
    const { container } = render(<Harness />);
    await flushEffects();
    const firstPreset = dialog().querySelector('button') as HTMLElement;
    expect(firstPreset).toBeDefined();

    // 背景 inert：除本对话框外的 body 子元素（渲染容器）都应 inert/aria-hidden。
    expect(container.hasAttribute('inert')).toBe(true);
    expect(container.getAttribute('aria-hidden')).toBe('true');
  });

  it('closes on Escape and restores focus to the previous element', async () => {
    const HarnessWithClose = () => {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" data-testid="anchor" onClick={() => setOpen(true)}>锚点</button>
          {open && (
            <SnoozePicker
              targetCount={1}
              targetLabel="测试邮件"
              onConfirm={vi.fn(async () => undefined)}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      );
    };
    render(<HarnessWithClose />);
    const anchor = document.querySelector('[data-testid="anchor"]') as HTMLElement;
    anchor.focus();
    fireEvent.click(anchor);
    await flushEffects();
    fireEvent.keyDown(backdrop(), { key: 'Escape' });
    await flushEffects();
    expect(document.querySelector('.snooze-dialog')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('consumes Escape before application shortcuts and keeps the underlying state intact', async () => {
    const backgroundEscape = vi.fn();
    window.addEventListener('keydown', backgroundEscape);
    try {
      render(<Harness />);
      await flushEffects();
      const firstPreset = dialog().querySelector('button') as HTMLElement;
      fireEvent.keyDown(firstPreset, { key: 'Escape' });
      await flushEffects();

      expect(backgroundEscape).not.toHaveBeenCalled();
      expect(document.querySelector('.snooze-dialog')).toBeNull();
    } finally {
      window.removeEventListener('keydown', backgroundEscape);
    }
  });

  it('keeps focus inside the dialog when Tab would leave it', async () => {
    render(<Harness />);
    await flushEffects();
    const focusables = Array.from(
      dialog().querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((element) => !element.hasAttribute('disabled'));
    expect(focusables.length).toBeGreaterThan(0);
    const last = focusables[focusables.length - 1];
    last.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    const defaultPrevented = !last.dispatchEvent(event);
    expect(defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusables[0]);
  });
});

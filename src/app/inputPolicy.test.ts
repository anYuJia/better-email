import { afterEach, describe, expect, it } from 'vitest';
import { installInputPolicy } from './inputPolicy';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('input policy', () => {
  it('keeps Tab literal inside Composer and leaves non-Composer Tab alone', () => {
    document.body.innerHTML = `
      <section class="composer">
        <input id="composer-input" value="ab">
      </section>
      <input id="outside-input" value="cd">
    `;
    installInputPolicy();

    const composerInput = document.getElementById('composer-input') as HTMLInputElement;
    composerInput.focus();
    composerInput.setSelectionRange(2, 2);
    const composerTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    composerInput.dispatchEvent(composerTab);

    expect(composerTab.defaultPrevented).toBe(true);
    expect(composerInput.value).toBe('ab\t');
    expect(document.activeElement).toBe(composerInput);

    const outsideInput = document.getElementById('outside-input') as HTMLInputElement;
    const outsideTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    outsideInput.dispatchEvent(outsideTab);
    expect(outsideTab.defaultPrevented).toBe(false);
  });

  it('disables writing assistance on dynamically focused text controls', () => {
    installInputPolicy();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('data-gramm')).toBe('false');
  });
});

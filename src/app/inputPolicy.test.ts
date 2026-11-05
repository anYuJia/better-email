import { afterEach, describe, expect, it } from 'vitest';
import { installInputPolicy } from './inputPolicy';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('input policy', () => {
  it('leaves Tab and Shift+Tab navigation intact in every composer text control', () => {
    document.body.innerHTML = `
      <section class="composer">
        <input id="composer-input" value="ab">
        <input id="contact-search" type="search" value="Ada">
        <textarea id="composer-body">body</textarea>
        <div id="rich-body" contenteditable="true">rich body</div>
      </section>
      <input id="outside-input" value="cd">
    `;
    installInputPolicy();

    for (const control of document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable]')) {
      control.focus();
      const before = control.outerHTML;
      const value = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control.value : control.textContent;
      for (const shiftKey of [false, true]) {
        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
        control.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(control.outerHTML).toBe(before);
        expect(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control.value : control.textContent).toBe(value);
      }
    }
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

const editableSelector = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
  'textarea',
  '[contenteditable="true"]',
].join(',');

function disableWritingAssistance(element: Element) {
  if (!element.matches(editableSelector)) return;
  element.setAttribute('spellcheck', 'false');
  element.setAttribute('autocorrect', 'off');
  element.setAttribute('autocapitalize', 'off');
  element.setAttribute('data-gramm', 'false');
  element.setAttribute('data-gramm_editor', 'false');
  element.setAttribute('data-enable-grammarly', 'false');
}

export function installInputPolicy() {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('spellcheck', 'false');
  document.body?.setAttribute('spellcheck', 'false');
  document.body?.setAttribute('autocorrect', 'off');
  document.body?.setAttribute('autocapitalize', 'off');

  document.querySelectorAll(editableSelector).forEach(disableWritingAssistance);
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element) disableWritingAssistance(event.target);
  }, true);
}

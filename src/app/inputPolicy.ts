const editableSelector = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
  'textarea',
  '[contenteditable="true"]',
].join(',');

const composerTextInputTypes = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
]);

let installed = false;

function disableWritingAssistance(element: Element) {
  if (!element.matches(editableSelector)) return;
  element.setAttribute('spellcheck', 'false');
  element.setAttribute('autocorrect', 'off');
  element.setAttribute('autocapitalize', 'off');
  element.setAttribute('data-gramm', 'false');
  element.setAttribute('data-gramm_editor', 'false');
  element.setAttribute('data-enable-grammarly', 'false');
}

function insertTabInTextControl(target: HTMLInputElement | HTMLTextAreaElement) {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const nextValue = `${target.value.slice(0, start)}\t${target.value.slice(end)}`;
  const prototype = target instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (nativeSetter) nativeSetter.call(target, nextValue);
  else target.value = nextValue;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1));
}

function insertTabInEditable(target: HTMLElement) {
  target.focus({ preventScroll: true });
  try {
    if (target.ownerDocument.execCommand('insertText', false, '\t')) return;
  } catch {
    // Fall through to Range insertion for WebViews without execCommand support.
  }

  const selection = target.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) {
    target.append(target.ownerDocument.createTextNode('\t'));
  } else {
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const text = target.ownerDocument.createTextNode('\t');
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleComposerTab(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.isComposing || event.keyCode === 229) return;
  if (!(event.target instanceof HTMLElement) || !event.target.closest('.composer')) return;

  if (event.target instanceof HTMLInputElement) {
    if (!composerTextInputTypes.has(event.target.type.toLowerCase())) return;
    event.preventDefault();
    event.stopPropagation();
    insertTabInTextControl(event.target);
    return;
  }

  if (event.target instanceof HTMLTextAreaElement) {
    event.preventDefault();
    event.stopPropagation();
    insertTabInTextControl(event.target);
    return;
  }

  if (event.target.isContentEditable) {
    event.preventDefault();
    event.stopPropagation();
    insertTabInEditable(event.target);
  }
}

export function installInputPolicy() {
  if (typeof document === 'undefined' || installed) return;
  installed = true;
  document.documentElement.setAttribute('spellcheck', 'false');
  document.body?.setAttribute('spellcheck', 'false');
  document.body?.setAttribute('autocorrect', 'off');
  document.body?.setAttribute('autocapitalize', 'off');

  document.querySelectorAll(editableSelector).forEach(disableWritingAssistance);
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element) disableWritingAssistance(event.target);
  }, true);
  // Component-specific editors may stop propagation and own Tab themselves.
  // This bubble-phase fallback covers every other text field inside Composer
  // (contact search, template names, future text controls) without changing
  // Tab behavior anywhere else in the application.
  document.addEventListener('keydown', handleComposerTab);
}

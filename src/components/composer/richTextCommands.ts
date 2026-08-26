export type RichTextFormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  justifyLeft: boolean;
  justifyCenter: boolean;
};

const EMPTY_FORMAT_STATE: RichTextFormatState = {
  bold: false,
  italic: false,
  underline: false,
  unorderedList: false,
  orderedList: false,
  justifyLeft: false,
  justifyCenter: false,
};

function isSelectionInside(editor: HTMLElement, range: Range) {
  return editor.contains(range.commonAncestorContainer);
}

export function saveEditorSelection(editor: HTMLElement | null) {
  if (!editor) return null;
  const selection = editor.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return isSelectionInside(editor, range) ? range.cloneRange() : null;
}

export function restoreEditorSelection(editor: HTMLElement, range: Range | null) {
  editor.focus({ preventScroll: true });
  if (!range || !isSelectionInside(editor, range)) return;
  const selection = editor.ownerDocument.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function dispatchEditorInput(editor: HTMLElement) {
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}

export function runEditorCommand(
  editor: HTMLElement | null,
  command: string,
  value?: string,
  range: Range | null = null,
) {
  if (!editor) return false;
  restoreEditorSelection(editor, range);
  try {
    const executed = editor.ownerDocument.execCommand(command, false, value);
    dispatchEditorInput(editor);
    return executed;
  } catch {
    return false;
  }
}

function queryCommandState(documentRef: Document, command: string) {
  try {
    return documentRef.queryCommandState(command);
  } catch {
    return false;
  }
}

export function readEditorFormatState(editor: HTMLElement | null): RichTextFormatState {
  if (!editor || !editor.ownerDocument.activeElement || !editor.contains(editor.ownerDocument.activeElement)) {
    return EMPTY_FORMAT_STATE;
  }
  const documentRef = editor.ownerDocument;
  return {
    bold: queryCommandState(documentRef, 'bold'),
    italic: queryCommandState(documentRef, 'italic'),
    underline: queryCommandState(documentRef, 'underline'),
    unorderedList: queryCommandState(documentRef, 'insertUnorderedList'),
    orderedList: queryCommandState(documentRef, 'insertOrderedList'),
    justifyLeft: queryCommandState(documentRef, 'justifyLeft'),
    justifyCenter: queryCommandState(documentRef, 'justifyCenter'),
  };
}

export function isRichTextMeaningfullyEmpty(editor: HTMLElement | null) {
  if (!editor) return true;
  if (editor.querySelector('img, video, audio, iframe, table, hr')) return false;
  const text = (editor.textContent ?? '')
    .replace(/[\u00a0\u200b\ufeff\s]/g, '')
    .trim();
  return text.length === 0;
}

export function syncRichTextEmptyState(editor: HTMLElement | null) {
  if (!editor) return true;
  const empty = isRichTextMeaningfullyEmpty(editor);
  editor.dataset.empty = String(empty);
  return empty;
}

export function normalizeLinkUrl(value: string) {
  const trimmed = value.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  if (/^(?:www\.)?[^\s/]+\.[^\s/]+(?:\/[^\s]*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

export function selectedEditorText(editor: HTMLElement | null) {
  if (!editor) return '';
  const selection = editor.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return '';
  const range = selection.getRangeAt(0);
  return isSelectionInside(editor, range) ? selection.toString() : '';
}

export function insertLink(
  editor: HTMLElement | null,
  url: string,
  text: string,
  range: Range | null,
) {
  if (!editor) return false;
  restoreEditorSelection(editor, range);
  const selection = editor.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || !isSelectionInside(editor, selection.getRangeAt(0))) return false;
  const currentRange = selection.getRangeAt(0);
  if (!currentRange.collapsed) {
    return runEditorCommand(editor, 'createLink', url, currentRange);
  }
  if (!text.trim()) return false;
  const anchor = editor.ownerDocument.createElement('a');
  anchor.href = url;
  anchor.textContent = text;
  currentRange.insertNode(anchor);
  currentRange.setStartAfter(anchor);
  currentRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(currentRange);
  dispatchEditorInput(editor);
  return true;
}

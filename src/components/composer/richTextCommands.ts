import { findAutoLinkMatches, normalizeAutoLink, type AutoLinkMatch } from './composerBody';

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

type TextSelectionOffsets = {
  start: number;
  end: number;
};

function textOffsetAt(editor: HTMLElement, container: Node, offset: number) {
  if (container !== editor && !editor.contains(container)) return null;
  const range = editor.ownerDocument.createRange();
  range.selectNodeContents(editor);
  try {
    range.setEnd(container, offset);
  } catch {
    return null;
  }
  return range.toString().length;
}

function textSelectionOffsetsForRange(editor: HTMLElement, range: Range) {
  if (!isSelectionInside(editor, range)) return null;
  const start = textOffsetAt(editor, range.startContainer, range.startOffset);
  const end = textOffsetAt(editor, range.endContainer, range.endOffset);
  if (start === null || end === null) return null;
  return { start, end };
}

function saveTextSelectionOffsets(editor: HTMLElement): TextSelectionOffsets | null {
  const selection = editor.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return textSelectionOffsetsForRange(editor, selection.getRangeAt(0));
}

function textPositionAt(editor: HTMLElement, offset: number) {
  const documentRef = editor.ownerDocument;
  const nodeFilter = documentRef.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = documentRef.createTreeWalker(editor, nodeFilter);
  let remaining = Math.max(0, offset);
  let lastTextNode: Text | null = null;
  let current = walker.nextNode();

  while (current) {
    const textNode = current as Text;
    lastTextNode = textNode;
    if (remaining <= textNode.data.length) {
      return { node: textNode, offset: remaining };
    }
    remaining -= textNode.data.length;
    current = walker.nextNode();
  }

  if (lastTextNode) {
    return { node: lastTextNode, offset: lastTextNode.data.length };
  }
  return { node: editor, offset: editor.childNodes.length };
}

function restoreTextSelectionOffsets(editor: HTMLElement, offsets: TextSelectionOffsets | null) {
  if (!offsets) return;
  const selection = editor.ownerDocument.getSelection();
  if (!selection) return;
  const start = textPositionAt(editor, offsets.start);
  const end = textPositionAt(editor, offsets.end);
  const range = editor.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function isAutoLinkReady(text: string, match: AutoLinkMatch, force: boolean) {
  if (force) return true;
  const nextCharacter = text[match.index + match.raw.length] ?? '';
  if (!nextCharacter) return /[，。！？；：、）】》〉」』]/.test(match.raw[match.raw.length - 1] ?? '');
  return /\s|[，。！？；：、）】》〉」』]/.test(nextCharacter);
}

function replaceTextNodeWithAutoLinks(editor: HTMLElement, node: Text, force: boolean) {
  const matches = findAutoLinkMatches(node.data)
    .filter((match) => isAutoLinkReady(node.data, match, force));
  if (matches.length === 0 || !node.parentNode) return false;

  const documentRef = editor.ownerDocument;
  const fragment = documentRef.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) {
      fragment.append(documentRef.createTextNode(node.data.slice(cursor, match.index)));
    }
    const anchor = documentRef.createElement('a');
    anchor.className = 'composer-auto-link';
    anchor.href = match.href;
    anchor.textContent = match.text;
    fragment.append(anchor);
    const trailingText = match.raw.slice(match.text.length);
    if (trailingText) fragment.append(documentRef.createTextNode(trailingText));
    cursor = match.index + match.raw.length;
  }
  if (cursor < node.data.length) {
    fragment.append(documentRef.createTextNode(node.data.slice(cursor)));
  }
  node.parentNode.replaceChild(fragment, node);
  return true;
}

function refreshAutoLinkAnchors(editor: HTMLElement) {
  let changed = false;
  editor.querySelectorAll<HTMLAnchorElement>('a.composer-auto-link').forEach((anchor) => {
    const currentText = anchor.textContent ?? '';
    const normalized = normalizeAutoLink(currentText);
    if (!normalized) {
      changed = unwrapElement(anchor) || changed;
      return;
    }

    if (normalized.text !== currentText) {
      anchor.textContent = normalized.text;
      const trailingText = currentText.slice(normalized.text.length);
      if (trailingText) anchor.after(editor.ownerDocument.createTextNode(trailingText));
      changed = true;
    }
    if (anchor.getAttribute('href') !== normalized.href) {
      anchor.setAttribute('href', normalized.href);
      changed = true;
    }
  });
  return changed;
}

export function autoLinkEditorText(editor: HTMLElement | null, options: { force?: boolean } = {}) {
  if (!editor) return false;
  const force = options.force ?? false;
  const documentRef = editor.ownerDocument;
  const wasFocused = documentRef.activeElement === editor;
  const selection = saveTextSelectionOffsets(editor);
  let changed = refreshAutoLinkAnchors(editor);
  const nodeFilter = documentRef.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = documentRef.createTreeWalker(editor, nodeFilter);
  const textNodes: Text[] = [];
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    if (!node.parentElement?.closest('a') && findAutoLinkMatches(node.data).length > 0) {
      textNodes.push(node);
    }
    current = walker.nextNode();
  }

  if (textNodes.length === 0) {
    if (changed && wasFocused) restoreTextSelectionOffsets(editor, selection);
    return changed;
  }
  textNodes.forEach((node) => {
    if (node.isConnected && replaceTextNodeWithAutoLinks(editor, node, force)) changed = true;
  });
  if (changed && wasFocused) restoreTextSelectionOffsets(editor, selection);
  return changed;
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

function selectedAnchors(editor: HTMLElement, range: Range | null) {
  if (!range) return [];
  return Array.from(editor.querySelectorAll<HTMLAnchorElement>('a')).filter((anchor) => {
    try {
      return anchor.contains(range.startContainer)
        || anchor.contains(range.endContainer)
        || range.intersectsNode(anchor);
    } catch {
      return false;
    }
  });
}

const inlineFormattingSelector = 'b,strong,i,em,u,s,strike,del,mark,font,small,big,sub,sup,span';

function selectedInlineFormattingElements(editor: HTMLElement, range: Range | null) {
  if (!range) return [];
  if (range.collapsed) {
    const elements: HTMLElement[] = [];
    let current: Node | null = range.startContainer;
    while (current && current !== editor) {
      if (current instanceof HTMLElement && current.matches(inlineFormattingSelector)) {
        elements.push(current);
      }
      current = current.parentNode;
    }
    return elements;
  }
  return Array.from(editor.querySelectorAll<HTMLElement>(inlineFormattingSelector)).filter((element) => {
    try {
      return range.intersectsNode(element);
    } catch {
      return false;
    }
  });
}

function unwrapElement(element: HTMLElement) {
  const parent = element.parentNode;
  if (!parent) return false;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
  return true;
}

function unwrapAnchor(anchor: HTMLAnchorElement) {
  return unwrapElement(anchor);
}

export function clearEditorFormatting(editor: HTMLElement | null, range: Range | null = null) {
  if (!editor) return false;

  const documentRef = editor.ownerDocument;
  const textSelection = saveTextSelectionOffsets(editor)
    ?? (range ? textSelectionOffsetsForRange(editor, range) : null);
  const previousSkipAutoLink = editor.dataset.skipAutoLink;
  editor.dataset.skipAutoLink = 'true';
  let changed = false;
  let removeFormatExecuted = false;
  try {
    restoreEditorSelection(editor, range);
    const selection = documentRef.getSelection();
    const currentRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const collapsedInlineCommands = currentRange?.collapsed
      ? ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript']
        .filter((command) => queryCommandState(documentRef, command))
      : [];

    try {
      removeFormatExecuted = documentRef.execCommand('removeFormat', false);
      changed = removeFormatExecuted || changed;
    } catch {
      // Some WebKit versions do not expose execCommand; the anchor fallback below still runs.
    }

    for (const command of collapsedInlineCommands) {
      if (queryCommandState(documentRef, command)) {
        try {
          changed = documentRef.execCommand(command, false) || changed;
        } catch {
          // Keep clearing the remaining formats.
        }
      }
    }

    try {
      changed = documentRef.execCommand('unlink', false) || changed;
    } catch {
      // The explicit anchor cleanup below covers collapsed selections.
    }

    const nextSelection = documentRef.getSelection();
    const nextRange = nextSelection && nextSelection.rangeCount > 0
      ? nextSelection.getRangeAt(0)
      : currentRange;
    if (nextRange?.collapsed || !removeFormatExecuted) {
      selectedInlineFormattingElements(editor, nextRange).forEach((element) => {
        changed = unwrapElement(element) || changed;
      });
    }
    selectedAnchors(editor, nextRange).forEach((anchor) => {
      changed = unwrapAnchor(anchor) || changed;
    });

    dispatchEditorInput(editor);
  } finally {
    if (previousSkipAutoLink === undefined) {
      delete editor.dataset.skipAutoLink;
    } else {
      editor.dataset.skipAutoLink = previousSkipAutoLink;
    }
  }

  restoreTextSelectionOffsets(editor, textSelection);
  return changed;
}

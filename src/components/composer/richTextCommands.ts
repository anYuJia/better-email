import { findAutoLinkMatches, normalizeAutoLink, type AutoLinkMatch } from './composerBody';

export type RichTextFormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  highlight: boolean;
  unorderedList: boolean;
  orderedList: boolean;
  justifyLeft: boolean;
  justifyCenter: boolean;
};

export type InlineTextFormatState = Pick<
  RichTextFormatState,
  'bold' | 'italic' | 'underline' | 'highlight'
>;

const TYPING_FORMAT_ATTRIBUTE = 'data-composer-typing-format';
const TYPING_FORMAT_MARKER = '\u200b';

const EMPTY_FORMAT_STATE: RichTextFormatState = {
  bold: false,
  italic: false,
  underline: false,
  highlight: false,
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

function collapsedRangeInsideEditor(editor: HTMLElement, range: Range | null) {
  if (range?.collapsed && isSelectionInside(editor, range)) return range.cloneRange();
  const selection = editor.ownerDocument.getSelection();
  if (selection && selection.rangeCount > 0) {
    const currentRange = selection.getRangeAt(0);
    if (currentRange.collapsed && isSelectionInside(editor, currentRange)) {
      return currentRange.cloneRange();
    }
  }
  const endRange = editor.ownerDocument.createRange();
  endRange.selectNodeContents(editor);
  endRange.collapse(false);
  return endRange;
}

function typingFormatMarkerAt(editor: HTMLElement, range: Range) {
  const startElement = range.startContainer instanceof HTMLElement
    ? range.startContainer
    : range.startContainer.parentElement;
  const marker = startElement?.closest<HTMLElement>(`[${TYPING_FORMAT_ATTRIBUTE}]`) ?? null;
  return marker && editor.contains(marker) ? marker : null;
}

function applyTypingFormatStyles(marker: HTMLElement, state: InlineTextFormatState) {
  marker.style.fontWeight = state.bold ? '700' : '';
  marker.style.fontStyle = state.italic ? 'italic' : '';
  marker.style.textDecorationLine = state.underline ? 'underline' : '';
  marker.style.backgroundColor = state.highlight ? '#FFF1A8' : '';
  marker.setAttribute(
    TYPING_FORMAT_ATTRIBUTE,
    Object.entries(state)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(' '),
  );
}

export function setEditorTypingFormat(
  editor: HTMLElement | null,
  range: Range | null,
  state: InlineTextFormatState,
) {
  if (!editor) return null;
  const targetRange = collapsedRangeInsideEditor(editor, range);
  let marker = typingFormatMarkerAt(editor, targetRange);
  let markerText: Text | null = null;

  if (!marker) {
    marker = editor.ownerDocument.createElement('span');
    markerText = editor.ownerDocument.createTextNode(TYPING_FORMAT_MARKER);
    marker.append(markerText);
    targetRange.insertNode(marker);
  } else {
    markerText = Array.from(marker.childNodes)
      .find((node): node is Text => node.nodeType === Node.TEXT_NODE) ?? null;
    if (!markerText) {
      markerText = editor.ownerDocument.createTextNode(TYPING_FORMAT_MARKER);
      marker.append(markerText);
    } else if (!markerText.data.includes(TYPING_FORMAT_MARKER)) {
      markerText.insertData(0, TYPING_FORMAT_MARKER);
    }
  }

  applyTypingFormatStyles(marker, state);
  (Object.keys(state) as Array<keyof InlineTextFormatState>)
    .filter((key) => !state[key])
    .forEach((key) => clearInheritedInlineFormatAroundNode(editor, marker, key));
  const nextRange = editor.ownerDocument.createRange();
  nextRange.setStart(markerText, markerText.data.length);
  nextRange.collapse(true);
  restoreEditorSelection(editor, nextRange);
  return nextRange.cloneRange();
}

export function cleanupEditorTypingFormatMarkers(editor: HTMLElement | null) {
  if (!editor) return false;
  let changed = false;
  editor.querySelectorAll<HTMLElement>(`[${TYPING_FORMAT_ATTRIBUTE}]`).forEach((marker) => {
    const nodeFilter = editor.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
    const walker = editor.ownerDocument.createTreeWalker(marker, nodeFilter);
    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }
    textNodes.forEach((textNode) => {
      let markerIndex = textNode.data.indexOf(TYPING_FORMAT_MARKER);
      while (markerIndex >= 0) {
        textNode.deleteData(markerIndex, TYPING_FORMAT_MARKER.length);
        changed = true;
        markerIndex = textNode.data.indexOf(TYPING_FORMAT_MARKER);
      }
    });
    marker.removeAttribute(TYPING_FORMAT_ATTRIBUTE);
    if (!marker.textContent && marker.childElementCount === 0) {
      marker.remove();
    }
  });
  return changed;
}

function inlineFormatElement(documentRef: Document, key: keyof InlineTextFormatState) {
  const tagName = {
    bold: 'strong',
    italic: 'em',
    underline: 'u',
    highlight: 'mark',
  }[key];
  return documentRef.createElement(tagName);
}

function inlineFormatSelector(key: keyof InlineTextFormatState) {
  return {
    bold: 'b, strong, [style*="font-weight"]',
    italic: 'i, em, [style*="font-style"]',
    underline: 'u, [style*="text-decoration"]',
    highlight: 'mark, [style*="background"]',
  }[key];
}

function clearInlineFormatStyle(element: HTMLElement, key: keyof InlineTextFormatState) {
  const semanticSelector = {
    bold: 'b, strong',
    italic: 'i, em',
    underline: 'u',
    highlight: 'mark',
  }[key];
  if (element.matches(semanticSelector)) return unwrapElement(element);

  const property = {
    bold: 'font-weight',
    italic: 'font-style',
    underline: 'text-decoration',
    highlight: 'background',
  }[key];
  element.style.removeProperty(property);
  if (key === 'underline') element.style.removeProperty('text-decoration-line');
  if (key === 'highlight') element.style.removeProperty('background-color');
  if (element.tagName === 'SPAN' && !element.getAttribute('style') && element.attributes.length === 0) {
    return unwrapElement(element);
  }
  return true;
}

function fragmentHasMeaningfulContent(fragment: DocumentFragment) {
  const contentElements = 'br, hr, img, video, audio, iframe, table';
  return Array.from(fragment.childNodes).some((node) => {
    if (node instanceof Text) return node.data.length > 0;
    if (!(node instanceof HTMLElement)) return false;
    return node.matches(contentElements)
      || Boolean(node.textContent)
      || node.querySelector(contentElements) !== null;
  });
}

function splitInlineFormatAncestorAroundNode(
  ancestor: HTMLElement,
  node: Node,
  key: keyof InlineTextFormatState,
) {
  const documentRef = ancestor.ownerDocument;
  const beforeRange = documentRef.createRange();
  beforeRange.selectNodeContents(ancestor);
  beforeRange.setEndBefore(node);
  const beforeContent = beforeRange.extractContents();

  const afterRange = documentRef.createRange();
  afterRange.selectNodeContents(ancestor);
  afterRange.setStartAfter(node);
  const afterContent = afterRange.extractContents();

  if (fragmentHasMeaningfulContent(beforeContent)) {
    const before = ancestor.cloneNode(false) as HTMLElement;
    before.removeAttribute('id');
    before.append(beforeContent);
    ancestor.before(before);
  }
  if (fragmentHasMeaningfulContent(afterContent)) {
    const after = ancestor.cloneNode(false) as HTMLElement;
    after.removeAttribute('id');
    after.append(afterContent);
    ancestor.after(after);
  }
  clearInlineFormatStyle(ancestor, key);
}

function clearInheritedInlineFormatAroundNode(
  editor: HTMLElement,
  node: Node,
  key: keyof InlineTextFormatState,
) {
  const selector = inlineFormatSelector(key);
  let ancestor = node.parentElement?.closest<HTMLElement>(selector) ?? null;
  while (ancestor && ancestor !== editor && editor.contains(ancestor)) {
    splitInlineFormatAncestorAroundNode(ancestor, node, key);
    ancestor = node.parentElement?.closest<HTMLElement>(selector) ?? null;
  }
}

function removeEmptyInlineFormattingElements(editor: HTMLElement) {
  Array.from(editor.querySelectorAll<HTMLElement>(inlineFormattingSelector))
    .reverse()
    .forEach((element) => {
      if (element.hasAttribute(TYPING_FORMAT_ATTRIBUTE)) return;
      if (element.textContent || element.querySelector('br, hr, img, video, audio, iframe, table')) return;
      element.remove();
    });
  editor.normalize();
}

export function setEditorSelectionFormat(
  editor: HTMLElement | null,
  range: Range | null,
  key: keyof InlineTextFormatState,
  enabled: boolean,
) {
  if (!editor || !range || range.collapsed || !isSelectionInside(editor, range)) return null;
  const offsets = textSelectionOffsetsForRange(editor, range);
  if (!offsets) return null;
  const documentRef = editor.ownerDocument;

  if (enabled) {
    const fragment = range.extractContents();
    const nodeFilter = documentRef.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
    const walker = documentRef.createTreeWalker(fragment, nodeFilter);
    const selectedTextNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      selectedTextNodes.push(current as Text);
      current = walker.nextNode();
    }
    selectedTextNodes.forEach((textNode) => {
      if (!textNode.parentNode || textNode.data.length === 0) return;
      const wrapper = inlineFormatElement(documentRef, key);
      textNode.parentNode.insertBefore(wrapper, textNode);
      wrapper.append(textNode);
    });
    range.insertNode(fragment);
  } else {
    const selector = inlineFormatSelector(key);
    const fragment = range.extractContents();
    Array.from(fragment.querySelectorAll<HTMLElement>(selector))
      .forEach((element) => clearInlineFormatStyle(element, key));
    const selectionBoundary = documentRef.createElement('span');
    selectionBoundary.setAttribute('data-composer-format-boundary', '');
    selectionBoundary.append(fragment);
    range.insertNode(selectionBoundary);
    clearInheritedInlineFormatAroundNode(editor, selectionBoundary, key);
    unwrapElement(selectionBoundary);
  }

  removeEmptyInlineFormattingElements(editor);
  restoreTextSelectionOffsets(editor, offsets);
  dispatchEditorInput(editor);
  return saveEditorSelection(editor);
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

function queryCommandValue(documentRef: Document, command: string) {
  try {
    return documentRef.queryCommandValue(command);
  } catch {
    return '';
  }
}

function rangeInsideEditor(editor: HTMLElement, fallbackRange: Range | null) {
  if (fallbackRange && isSelectionInside(editor, fallbackRange)) return fallbackRange;
  const selection = editor.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return isSelectionInside(editor, range) ? range : null;
}

function formatAncestors(editor: HTMLElement, range: Range) {
  const ancestors: HTMLElement[] = [];
  let current: Node | null = range.startContainer;
  while (current && current !== editor) {
    if (current instanceof HTMLElement) ancestors.push(current);
    current = current.parentNode;
  }
  return ancestors;
}

function hasTextDecoration(element: HTMLElement, decoration: string) {
  const value = `${element.style.textDecoration} ${element.style.textDecorationLine}`.toLowerCase();
  return value.includes(decoration);
}

function hasVisibleHighlight(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  if (!normalized || normalized === 'transparent' || normalized === 'initial' || normalized === 'inherit') {
    return false;
  }
  if (normalized === 'rgba(0,0,0,0)' || normalized.endsWith(',0)')) return false;
  return true;
}

function isComposerHighlight(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  return normalized === '#fff1a8'
    || normalized === 'rgb(255,241,168)'
    || normalized === 'rgba(255,241,168,1)';
}

export function readEditorFormatState(
  editor: HTMLElement | null,
  fallbackRange: Range | null = null,
): RichTextFormatState {
  if (!editor) {
    return EMPTY_FORMAT_STATE;
  }
  const range = rangeInsideEditor(editor, fallbackRange);
  if (!range) return EMPTY_FORMAT_STATE;
  const documentRef = editor.ownerDocument;
  const ancestors = formatAncestors(editor, range);
  const boldFromDom = ancestors.some((element) => (
    element.matches('b, strong')
    || element.style.fontWeight === 'bold'
    || Number.parseInt(element.style.fontWeight, 10) >= 600
  ));
  const italicFromDom = ancestors.some((element) => (
    element.matches('i, em') || element.style.fontStyle === 'italic'
  ));
  const underlineFromDom = ancestors.some((element) => (
    element.matches('u') || hasTextDecoration(element, 'underline')
  ));
  const highlightFromDom = ancestors.some((element) => (
    element.matches('mark') || hasVisibleHighlight(element.style.backgroundColor)
  ));
  return {
    bold: queryCommandState(documentRef, 'bold') || boldFromDom,
    italic: queryCommandState(documentRef, 'italic') || italicFromDom,
    underline: queryCommandState(documentRef, 'underline') || underlineFromDom,
    highlight: highlightFromDom || isComposerHighlight(queryCommandValue(documentRef, 'hiliteColor')),
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

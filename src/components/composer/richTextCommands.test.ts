import { describe, expect, it } from 'vitest';
import {
  autoLinkEditorText,
  cleanupEditorTypingFormatMarkers,
  clearEditorFormatting,
  setEditorSelectionFormat,
  setEditorTypingFormat,
} from './richTextCommands';

function selectEditorContents(editor: HTMLElement) {
  const selection = editor.ownerDocument.getSelection();
  const range = editor.ownerDocument.createRange();
  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range.cloneRange();
}

describe('rich text commands', () => {
  it('turns web addresses in an editor into styled anchors', () => {
    const editor = document.createElement('div');
    editor.textContent = '打开 example.com/path。';
    document.body.append(editor);

    autoLinkEditorText(editor);

    expect(editor.innerHTML).toBe(
      '打开 <a class="composer-auto-link" href="https://example.com/path">example.com/path</a>。',
    );
    editor.remove();
  });

  it('waits for a delimiter before linking a URL that is still being typed', () => {
    const editor = document.createElement('div');
    editor.textContent = 'https://example.com/path';
    document.body.append(editor);

    expect(autoLinkEditorText(editor)).toBe(false);
    expect(editor.querySelector('a')).toBeNull();
    expect(autoLinkEditorText(editor, { force: true })).toBe(true);
    expect(editor.querySelector('a')?.textContent).toBe('https://example.com/path');
    editor.remove();
  });

  it('keeps an existing automatic link in sync when its text is edited', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<a class="composer-auto-link" href="https://example.com">https://example.com</a>';
    document.body.append(editor);
    const anchor = editor.querySelector('a');

    if (!anchor) throw new Error('automatic link missing');
    anchor.textContent = 'https://example.com/path';
    autoLinkEditorText(editor, { force: true });
    expect(editor.querySelector('a')?.getAttribute('href')).toBe('https://example.com/path');

    anchor.textContent = 'https://example';
    autoLinkEditorText(editor, { force: true });
    expect(editor.querySelector('a')).toBeNull();
    editor.remove();
  });

  it('clears selected links even when the browser command is unavailable', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<strong>重点</strong> <a class="composer-auto-link" href="https://example.com">example.com</a>';
    document.body.append(editor);
    const range = selectEditorContents(editor);

    clearEditorFormatting(editor, range);

    expect(editor.querySelector('a')).toBeNull();
    expect(editor.querySelector('strong')).toBeNull();
    expect(editor.textContent).toBe('重点 example.com');
    editor.remove();
  });

  it('clears an inline format when the caret is inside it', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<strong>重点</strong>';
    document.body.append(editor);
    const text = editor.querySelector('strong')?.firstChild;
    const selection = editor.ownerDocument.getSelection();
    const range = editor.ownerDocument.createRange();
    if (!text) throw new Error('formatted text node missing');
    range.setStart(text, text.textContent?.length ?? 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    clearEditorFormatting(editor, range);

    expect(editor.querySelector('strong')).toBeNull();
    expect(editor.textContent).toBe('重点');
    editor.remove();
  });

  it('keeps preselected typing formats while removing the invisible caret marker from content', () => {
    const editor = document.createElement('div');
    document.body.append(editor);
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    range.collapse(true);

    const nextRange = setEditorTypingFormat(editor, range, {
      bold: true,
      italic: true,
      underline: true,
      highlight: true,
    });
    const marker = editor.querySelector<HTMLElement>('[data-composer-typing-format]');
    const markerText = marker?.firstChild;
    if (!(markerText instanceof Text) || !nextRange) throw new Error('typing marker missing');

    markerText.appendData('新内容');
    nextRange.setStart(markerText, markerText.data.length);
    nextRange.collapse(true);
    restoreSelection(editor, nextRange);

    expect(cleanupEditorTypingFormatMarkers(editor)).toBe(true);
    expect(editor.textContent).toBe('新内容');
    expect(editor.innerHTML).not.toContain('data-composer-typing-format');
    expect(editor.innerHTML).not.toContain('\u200b');
    expect(marker?.style.fontWeight).toBe('700');
    expect(marker?.style.fontStyle).toBe('italic');
    expect(marker?.style.textDecorationLine).toBe('underline');
    expect(marker?.style.backgroundColor).not.toBe('');
    editor.remove();
  });

  it('removes a selected format without changing the text before or after the selection', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<strong>前选后</strong>';
    document.body.append(editor);
    const text = editor.querySelector('strong')?.firstChild;
    if (!(text instanceof Text)) throw new Error('formatted text missing');
    const range = editor.ownerDocument.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 2);
    restoreSelection(editor, range);

    setEditorSelectionFormat(editor, range, 'bold', false);

    expect(editor.textContent).toBe('前选后');
    const textNodes = Array.from(editor.childNodes).flatMap((node) => (
      node instanceof Text ? [node] : Array.from(node.childNodes).filter((child): child is Text => child instanceof Text)
    ));
    const selectedText = textNodes.find((node) => node.data === '选');
    const beforeText = textNodes.find((node) => node.data === '前');
    const afterText = textNodes.find((node) => node.data === '后');
    expect(selectedText?.parentElement?.closest('strong')).toBeNull();
    expect(beforeText?.parentElement?.closest('strong')).not.toBeNull();
    expect(afterText?.parentElement?.closest('strong')).not.toBeNull();
    editor.remove();
  });

  it('starts unformatted typing outside inherited inline formats at a collapsed caret', () => {
    const editor = document.createElement('div');
    editor.innerHTML = '<strong><em><u><mark>前后</mark></u></em></strong>';
    document.body.append(editor);
    const text = editor.querySelector('mark')?.firstChild;
    if (!(text instanceof Text)) throw new Error('formatted text missing');
    const range = editor.ownerDocument.createRange();
    range.setStart(text, 1);
    range.collapse(true);

    setEditorTypingFormat(editor, range, {
      bold: false,
      italic: false,
      underline: false,
      highlight: false,
    });

    const marker = editor.querySelector<HTMLElement>('[data-composer-typing-format]');
    expect(marker).not.toBeNull();
    expect(marker?.closest('strong, em, u, mark')).toBeNull();
    expect(editor.textContent?.replace('\u200b', '')).toBe('前后');
    editor.remove();
  });
});

function restoreSelection(editor: HTMLElement, range: Range) {
  const selection = editor.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

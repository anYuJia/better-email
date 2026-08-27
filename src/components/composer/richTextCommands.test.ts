import { describe, expect, it } from 'vitest';
import { autoLinkEditorText, clearEditorFormatting } from './richTextCommands';

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
});

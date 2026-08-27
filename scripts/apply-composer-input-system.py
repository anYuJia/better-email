from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, got {count}')
    return text.replace(old, new, 1)


primary = Path('src/components/composer/ComposerPrimaryFields.tsx')
text = primary.read_text(encoding='utf-8')

marker = "type ComposerPrimaryFieldsProps = {\n"
helper = """function insertTabInTextControl(target: HTMLInputElement | HTMLTextAreaElement) {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? start;
  const nextValue = `${target.value.slice(0, start)}\t${target.value.slice(end)}`;
  const nativeSetter = Object.getOwnPropertyDescriptor(
    target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set;
  nativeSetter?.call(target, nextValue);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1));
}

"""
text = replace_once(text, marker, helper + marker, 'text tab helper')

old_keydown = """  function handleRichBodyKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const editor = event.currentTarget;
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      runEditorCommand(editor, event.shiftKey ? 'outdent' : 'indent');
      return;
    }

    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (['a', 'c', 'x', 'v', 'z', 'y', 'b', 'i', 'u'].includes(key)) {
      event.stopPropagation();
    }
  }
"""
new_keydown = """  function handleRichBodyKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const editor = event.currentTarget;
    const nativeEvent = event.nativeEvent;
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;

    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      runEditorCommand(editor, 'insertText', '\t');
      return;
    }

    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (['a', 'c', 'x', 'v', 'z', 'y', 'b', 'i', 'u'].includes(key)) {
      // Preserve the WebView/native edit command. We only stop app-level shortcuts.
      event.stopPropagation();
    }
  }
"""
text = replace_once(text, old_keydown, new_keydown, 'rich body keyboard')

old_subject = """        <input
          aria-label="主题"
          value={draft.subject}
          onChange={(event) => onPatchDraft({ subject: event.target.value })}
          placeholder="添加主题"
        />
"""
new_subject = """        <input
          aria-label="主题"
          value={draft.subject}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-gramm="false"
          onChange={(event) => onPatchDraft({ subject: event.target.value })}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Tab') {
              event.preventDefault();
              event.stopPropagation();
              insertTabInTextControl(event.currentTarget);
              return;
            }
            if ((event.metaKey || event.ctrlKey) && !event.altKey) event.stopPropagation();
          }}
          placeholder="添加主题"
        />
"""
text = replace_once(text, old_subject, new_subject, 'subject input')

old_rich_attrs = """            aria-multiline="true"
            aria-label="邮件正文（富文本）"
            spellCheck
            onKeyDownCapture={handleRichBodyKeyDown}
"""
new_rich_attrs = """            aria-multiline="true"
            aria-label="邮件正文（富文本）"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-gramm="false"
            onKeyDownCapture={handleRichBodyKeyDown}
"""
text = replace_once(text, old_rich_attrs, new_rich_attrs, 'rich editor assistance')

old_textarea = """          <textarea
            aria-label="邮件正文"
            value={editableBody}
            onDrop={onAttachmentDrop}
"""
new_textarea = """          <textarea
            aria-label="邮件正文"
            value={editableBody}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-gramm="false"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                insertTabInTextControl(event.currentTarget);
                return;
              }
              if ((event.metaKey || event.ctrlKey) && !event.altKey) event.stopPropagation();
            }}
            onDrop={onAttachmentDrop}
"""
text = replace_once(text, old_textarea, new_textarea, 'plain editor keyboard')
primary.write_text(text, encoding='utf-8')

shortcuts = Path('src/hooks/useAppShortcuts.ts')
text = shortcuts.read_text(encoding='utf-8')
marker = """    function handleShortcut(event: KeyboardEvent) {
      const {
"""
replacement = """    function handleShortcut(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) return;
      const {
"""
text = replace_once(text, marker, replacement, 'global IME guard')
shortcuts.write_text(text, encoding='utf-8')

lib = Path('src-tauri/src/lib.rs')
text = lib.read_text(encoding='utf-8')
old = """        // Keep the native window titlebar (traffic lights and title), but do
        // not create Tauri's default macOS application menu.
        .enable_macos_default_menu(false)
"""
new = """        // Keep the native macOS application/Edit menu so WebKit receives the
        // standard Undo/Redo/Cut/Copy/Paste/Select All command chain and shortcuts.
        .enable_macos_default_menu(true)
"""
text = replace_once(text, old, new, 'macOS edit menu')
lib.write_text(text, encoding='utf-8')

css = Path('src/components/composer/composer-polish.css')
text = css.read_text(encoding='utf-8')
marker = '/* Compact formatting toolbar: keep formatting available without stealing vertical space. */'
if marker not in text:
    text += """

/* Compact formatting toolbar: keep formatting available without stealing vertical space. */
.composer .composer-rich-toolbar {
  min-height: 38px;
  flex-basis: 38px;
  gap: 4px;
  padding-inline: 14px;
}

.composer .composer-rich-toolbar button {
  width: 26px;
  min-width: 26px;
  min-height: 26px;
}

.composer .composer-rich-toolbar .composer-rich-toolbar-select .custom-select-summary {
  min-height: 26px;
  padding-inline: 6px;
}

.composer .composer-rich-toolbar-group {
  gap: 1px;
  padding-right: 6px;
}
"""
css.write_text(text, encoding='utf-8')

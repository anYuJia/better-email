import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  Bold,
  Eraser,
  FileSignature,
  FileText,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Paperclip,
  Redo2,
  Underline,
  Undo2,
} from 'lucide-react';
import type { DraftInput } from '../../app/types';
import { CustomSelect } from '../settings/accounts/CustomSelect';
import {
  clearEditorFormatting,
  readEditorFormatState,
  restoreEditorSelection,
  runEditorCommand,
  saveEditorSelection,
  type RichTextFormatState,
} from './richTextCommands';

const FONT_OPTIONS = [
  { value: '', label: '字体' },
  { value: 'system-ui', label: '系统字体' },
  { value: 'PingFang SC', label: '苹方' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
];

const FONT_SIZE_OPTIONS = [
  { value: '', label: '字号' },
  { value: '1', label: '12' },
  { value: '2', label: '14' },
  { value: '3', label: '16' },
  { value: '4', label: '18' },
  { value: '5', label: '20' },
  { value: '6', label: '24' },
  { value: '7', label: '32' },
];
type ToolbarButtonProps = {
  label: string;
  icon: React.ReactNode;
  pressed?: boolean;
  onClick: () => void;
};

function toolbarButton({ label, icon, pressed, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export function ComposerRichToolbar({
  editorRef,
}: {
  editorRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const [fontValue, setFontValue] = useState('');
  const [fontSizeValue, setFontSizeValue] = useState('');
  const [formatState, setFormatState] = useState<RichTextFormatState>({
    bold: false,
    italic: false,
    underline: false,
    unorderedList: false,
    orderedList: false,
    justifyLeft: false,
    justifyCenter: false,
  });
  const editorSelectionRef = useRef<Range | null>(null);

  useEffect(() => {
    const editor = editorRef?.current;
    if (!editor) return undefined;
    const sync = () => {
      const selection = saveEditorSelection(editor);
      if (selection) editorSelectionRef.current = selection;
      setFormatState(readEditorFormatState(editor));
    };
    editor.addEventListener('keyup', sync);
    editor.addEventListener('mouseup', sync);
    editor.addEventListener('input', sync);
    editor.addEventListener('focus', sync);
    editor.ownerDocument.addEventListener('selectionchange', sync);
    sync();
    return () => {
      editor.removeEventListener('keyup', sync);
      editor.removeEventListener('mouseup', sync);
      editor.removeEventListener('input', sync);
      editor.removeEventListener('focus', sync);
      editor.ownerDocument.removeEventListener('selectionchange', sync);
    };
  }, [editorRef]);

  function restoreEditorFocus(editor: HTMLDivElement) {
    const selection = editorSelectionRef.current;
    const restore = () => restoreEditorSelection(editor, selection);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(restore);
    } else {
      queueMicrotask(restore);
    }
  }

  function executeFromSelect(command: string, value: string) {
    const editor = editorRef?.current ?? null;
    if (!editor) return;
    const selection = saveEditorSelection(editor) ?? editorSelectionRef.current;
    if (selection) editorSelectionRef.current = selection;
    const run = () => {
      const target = editorRef?.current ?? null;
      if (!target) return;
      runEditorCommand(target, command, value, selection);
      editorSelectionRef.current = saveEditorSelection(target) ?? selection ?? editorSelectionRef.current;
      setFormatState(readEditorFormatState(target));
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(run);
    } else {
      queueMicrotask(run);
    }
  }
  function execute(command: string, value?: string) {
    const editor = editorRef?.current ?? null;
    const selection = saveEditorSelection(editor) ?? editorSelectionRef.current;
    runEditorCommand(editor, command, value, selection);
    if (editor) {
      editorSelectionRef.current = saveEditorSelection(editor) ?? selection ?? editorSelectionRef.current;
      setFormatState(readEditorFormatState(editor));
      restoreEditorFocus(editor);
    }
  }

  function clearFormatting() {
    const editor = editorRef?.current ?? null;
    const selection = saveEditorSelection(editor) ?? editorSelectionRef.current;
    clearEditorFormatting(editor, selection);
    if (editor) {
      editorSelectionRef.current = saveEditorSelection(editor) ?? selection ?? editorSelectionRef.current;
      setFormatState(readEditorFormatState(editor));
      restoreEditorFocus(editor);
    }
  }

  return (
    <div className="composer-rich-toolbar" aria-label="富文本格式工具栏">
      <div className="composer-rich-toolbar-group" aria-label="撤销和重做">
        {toolbarButton({ label: '撤销', icon: <Undo2 size={17} />, onClick: () => execute('undo') })}
        {toolbarButton({ label: '重做', icon: <Redo2 size={17} />, onClick: () => execute('redo') })}
      </div>

      <div className="composer-rich-toolbar-group composer-rich-toolbar-selects">
        <CustomSelect
          ariaLabel="字体"
          value={fontValue}
          options={FONT_OPTIONS}
          dense
          className="composer-rich-toolbar-select"
          portalOwnerId="composer-rich-toolbar"
          portalZIndex={1200}
          onChange={(value) => {
            if (!value) return;
            setFontValue(value);
            executeFromSelect('fontName', value);
          }}
        />
        <CustomSelect
          ariaLabel="字号"
          value={fontSizeValue}
          options={FONT_SIZE_OPTIONS}
          dense
          className="composer-rich-toolbar-select"
          portalOwnerId="composer-rich-toolbar"
          portalZIndex={1200}
          onChange={(value) => {
            if (!value) return;
            setFontSizeValue(value);
            executeFromSelect('fontSize', value);
          }}
        />
      </div>

      <div className="composer-rich-toolbar-group" aria-label="文字样式">
        {toolbarButton({ label: '加粗', icon: <Bold size={17} />, pressed: formatState.bold, onClick: () => execute('bold') })}
        {toolbarButton({ label: '斜体', icon: <Italic size={17} />, pressed: formatState.italic, onClick: () => execute('italic') })}
        {toolbarButton({ label: '下划线', icon: <Underline size={17} />, pressed: formatState.underline, onClick: () => execute('underline') })}
        {toolbarButton({ label: '文字高亮', icon: <Highlighter size={17} />, onClick: () => execute('hiliteColor', '#FFF1A8') })}
      </div>

      <div className="composer-rich-toolbar-group" aria-label="段落格式">
        {toolbarButton({ label: '无序列表', icon: <List size={17} />, pressed: formatState.unorderedList, onClick: () => execute('insertUnorderedList') })}
        {toolbarButton({ label: '有序列表', icon: <ListOrdered size={17} />, pressed: formatState.orderedList, onClick: () => execute('insertOrderedList') })}
        {toolbarButton({ label: '左对齐', icon: <AlignLeft size={17} />, pressed: formatState.justifyLeft, onClick: () => execute('justifyLeft') })}
        {toolbarButton({ label: '居中对齐', icon: <AlignCenter size={17} />, pressed: formatState.justifyCenter, onClick: () => execute('justifyCenter') })}
      </div>

      <div className="composer-rich-toolbar-group" aria-label="格式清理">
        {toolbarButton({ label: '清除格式', icon: <Eraser size={17} />, onClick: clearFormatting })}
      </div>
    </div>
  );
}

type ComposerQuickToolsProps = {
  draft: DraftInput;
  dropActive: boolean;
  signature: string;
  onInsertSignature: () => void;
  onPickAttachments: () => void;
  onAttachmentDrop: React.DragEventHandler<HTMLElement>;
  onAttachmentDragEnter: React.DragEventHandler<HTMLElement>;
  onAttachmentDragLeave: React.DragEventHandler<HTMLElement>;
  onAttachmentDragOver: React.DragEventHandler<HTMLElement>;
  onToggleFormatting?: () => void;
  onOpenTemplates?: () => void;
  onOpenMore?: () => void;
  templateButtonRef?: React.RefObject<HTMLButtonElement>;
  moreButtonRef?: React.RefObject<HTMLButtonElement>;
  formattingExpanded?: boolean;
  hideRichToolbar?: boolean;
};

export default function ComposerQuickTools({
  draft,
  dropActive,
  signature,
  onInsertSignature,
  onPickAttachments,
  onAttachmentDrop,
  onAttachmentDragEnter,
  onAttachmentDragLeave,
  onAttachmentDragOver,
  onToggleFormatting,
  onOpenTemplates,
  onOpenMore,
  templateButtonRef,
  moreButtonRef,
  formattingExpanded = true,
  hideRichToolbar = false,
}: ComposerQuickToolsProps) {
  const regularAttachmentCount = draft.attachments.filter((attachment) => !attachment.is_inline).length;

  return (
    <section className="composer-quick-tools" aria-label="写信常用工具">
      {!hideRichToolbar && <ComposerRichToolbar />}

      <div
        className={`composer-attachments${dropActive ? ' drop-active' : ''}`}
        onDrop={onAttachmentDrop}
        onDragEnter={onAttachmentDragEnter}
        onDragLeave={onAttachmentDragLeave}
        onDragOver={onAttachmentDragOver}
      >
        <div className="composer-quick-toolbar">
          <div className="composer-footer-tool-group" aria-label="写信工具">
            <button type="button" aria-label="添加附件" title="添加附件" onClick={onPickAttachments}>
              <Paperclip size={17} />
              附件
              {regularAttachmentCount > 0 && <small>{regularAttachmentCount}</small>}
            </button>
            <button
              type="button"
              aria-label="格式"
              title="格式"
              aria-pressed={formattingExpanded}
              onClick={onToggleFormatting}
            >
              <span className="composer-format-glyph" aria-hidden="true">A</span>
              格式
            </button>
            <button type="button" aria-label="插入签名" onClick={onInsertSignature} disabled={!signature} title={signature || '当前发件身份未设置签名'}>
              <FileSignature size={17} />
              签名
            </button>
            {onOpenTemplates ? (
              <button ref={templateButtonRef} type="button" aria-label="插入模板" title="插入模板" onClick={onOpenTemplates}>
                <FileText size={17} />
                模板
              </button>
            ) : null}
            {onOpenMore ? (
              <button ref={moreButtonRef} type="button" aria-label="更多写信工具" title="更多写信工具" onClick={onOpenMore}>
                <span className="composer-more-glyph" aria-hidden="true">•••</span>
                更多
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

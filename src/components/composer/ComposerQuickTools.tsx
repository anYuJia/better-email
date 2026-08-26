import type React from 'react';
import { useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  Bold,
  FileSignature,
  FileText,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Redo2,
  Underline,
  Undo2,
  X,
} from 'lucide-react';
import type { DraftInput } from '../../app/types';
import { CustomSelect } from '../settings/accounts/CustomSelect';

const FONT_OPTIONS = [
  { value: '', label: '字体' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'Georgia', label: 'Georgia' },
];

const FONT_SIZE_OPTIONS = [
  { value: '', label: '字号' },
  { value: '2', label: '14' },
  { value: '3', label: '16' },
  { value: '4', label: '18' },
  { value: '5', label: '20' },
];

function runEditorCommand(command: string, value?: string) {
  const editor = document.querySelector<HTMLElement>('.composer-richtext-body');
  if (!editor) return;
  editor.focus();
  try {
    document.execCommand(command, false, value);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } catch {
    // Unsupported browser commands should not interrupt composition.
  }
}

function toolbarButton(
  label: string,
  icon: React.ReactNode,
  onClick: () => void,
) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}>
      {icon}
    </button>
  );
}

export function ComposerRichToolbar() {
  const [fontValue, setFontValue] = useState('');
  const [fontSizeValue, setFontSizeValue] = useState('');

  return (
    <div className="composer-rich-toolbar" aria-label="富文本格式工具栏">
      <div className="composer-rich-toolbar-group" aria-label="撤销和重做">
        {toolbarButton('撤销', <Undo2 size={17} />, () => runEditorCommand('undo'))}
        {toolbarButton('重做', <Redo2 size={17} />, () => runEditorCommand('redo'))}
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
            if (value) runEditorCommand('fontName', value);
            setFontValue('');
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
            if (value) runEditorCommand('fontSize', value);
            setFontSizeValue('');
          }}
        />
      </div>

      <div className="composer-rich-toolbar-group" aria-label="文字样式">
        {toolbarButton('加粗', <Bold size={17} />, () => runEditorCommand('bold'))}
        {toolbarButton('斜体', <Italic size={17} />, () => runEditorCommand('italic'))}
        {toolbarButton('下划线', <Underline size={17} />, () => runEditorCommand('underline'))}
        {toolbarButton('文字高亮', <Highlighter size={17} />, () => runEditorCommand('hiliteColor', '#FFF1A8'))}
      </div>

      <div className="composer-rich-toolbar-group" aria-label="段落格式">
        {toolbarButton('无序列表', <List size={17} />, () => runEditorCommand('insertUnorderedList'))}
        {toolbarButton('有序列表', <ListOrdered size={17} />, () => runEditorCommand('insertOrderedList'))}
        {toolbarButton('左对齐', <AlignLeft size={17} />, () => runEditorCommand('justifyLeft'))}
        {toolbarButton('居中对齐', <AlignCenter size={17} />, () => runEditorCommand('justifyCenter'))}
      </div>

      <div className="composer-rich-toolbar-group" aria-label="插入内容">
        {toolbarButton('插入链接', <Link2 size={17} />, () => {
          const url = window.prompt('输入链接地址');
          if (url?.trim()) runEditorCommand('createLink', url.trim());
        })}
        {toolbarButton('清除格式', <X size={17} />, () => runEditorCommand('removeFormat'))}
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
              <button type="button" aria-label="插入模板" title="插入模板" onClick={onOpenTemplates}>
                <FileText size={17} />
                模板
              </button>
            ) : null}
            {onOpenMore ? (
              <button type="button" aria-label="更多写信工具" title="更多写信工具" onClick={onOpenMore}>
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

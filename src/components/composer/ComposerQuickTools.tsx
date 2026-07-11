import type React from 'react';
import { Bold, File, FileArchive, FileImage, FileSignature, FileSpreadsheet, FileText, Italic, List, Paperclip, X } from 'lucide-react';
import type { DraftInput } from '../../app/types';
import { formatBytes } from '../../mailUtils';

type ComposerQuickToolsProps = {
  draft: DraftInput;
  richComposer: boolean;
  dropActive: boolean;
  signature: string;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
  onRichComposerChange: (value: boolean) => void;
  onInsertSignature: () => void;
  onPickAttachments: () => void;
  onRemoveAttachment: (index: number) => void;
  onAttachmentDrop: React.DragEventHandler<HTMLElement>;
  onAttachmentDragEnter: React.DragEventHandler<HTMLElement>;
  onAttachmentDragLeave: React.DragEventHandler<HTMLElement>;
  onAttachmentDragOver: React.DragEventHandler<HTMLElement>;
};

function attachmentIcon(filename: string, mimeType: string) {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(lowerName)) {
    return <FileImage size={15} />;
  }
  if (/\.(xlsx?|csv|numbers)$/i.test(lowerName)) {
    return <FileSpreadsheet size={15} />;
  }
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lowerName)) {
    return <FileArchive size={15} />;
  }
  if (lowerMime.startsWith('text/') || /\.(pdf|txt|md|docx?|pages)$/i.test(lowerName)) {
    return <FileText size={15} />;
  }
  return <File size={15} />;
}

export default function ComposerQuickTools({
  draft,
  richComposer,
  dropActive,
  signature,
  onPatchDraft,
  onRichComposerChange,
  onInsertSignature,
  onPickAttachments,
  onRemoveAttachment,
  onAttachmentDrop,
  onAttachmentDragEnter,
  onAttachmentDragLeave,
  onAttachmentDragOver,
}: ComposerQuickToolsProps) {
  return (
    <section className="composer-quick-tools" aria-label="写信常用工具">
      <div className="composer-quick-toolbar">
        <div className="composer-rich-toggle">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={richComposer}
              onChange={(event) => onRichComposerChange(event.target.checked)}
            />
            富文本 HTML
          </label>
          {richComposer && (
            <div className="rich-toolbar">
              <button
                type="button"
                title="加粗"
                aria-label="加粗 B"
                onClick={() => onPatchDraft({
                  html_body: `${draft.html_body}<strong>加粗文字</strong>`,
                  body: `${draft.body}加粗文字`,
                })}
              >
                <Bold size={14} />
                <span>B</span>
              </button>
              <button
                type="button"
                title="斜体"
                aria-label="斜体 I"
                onClick={() => onPatchDraft({
                  html_body: `${draft.html_body}<em>斜体文字</em>`,
                  body: `${draft.body}斜体文字`,
                })}
              >
                <Italic size={14} />
                <span>I</span>
              </button>
              <button
                type="button"
                onClick={() => onPatchDraft({
                  html_body: `${draft.html_body}<ul><li>列表项</li></ul>`,
                  body: `${draft.body}\n- 列表项`,
                })}
              >
                <List size={14} />
                列表
              </button>
            </div>
          )}
        </div>

        <div className="composer-signature">
          <button type="button" onClick={onInsertSignature} title={signature || '当前发件身份未设置签名'}>
            <FileSignature size={15} />
            插入签名
          </button>
          <small title={signature || '当前发件身份未设置签名'}>
            {signature || '未设置签名'}
          </small>
        </div>

        <div
          className={`composer-attachments${dropActive ? ' drop-active' : ''}`}
          onDrop={onAttachmentDrop}
          onDragEnter={onAttachmentDragEnter}
          onDragLeave={onAttachmentDragLeave}
          onDragOver={onAttachmentDragOver}
        >
          <div className="composer-attachment-controls">
            <button type="button" className="composer-attachment-button" onClick={onPickAttachments}>
              <Paperclip size={15} />
              添加附件
            </button>
            <span>
              {draft.attachments.length > 0
                ? `已添加 ${draft.attachments.length} 个附件`
                : '拖入文件，或点击添加附件'}
            </span>
          </div>
          {draft.attachments.length > 0 && (
            <div className="composer-attachment-list">
              {draft.attachments.map((attachment, index) => (
                <span className="composer-attachment-chip" key={`${attachment.filename}-${index}`}>
                  <span className="composer-file-icon" aria-hidden="true">
                    {attachmentIcon(attachment.filename, attachment.mime_type)}
                  </span>
                  <strong>{attachment.filename}</strong>
                  <em>{formatBytes(attachment.size_bytes)}</em>
                  <button type="button" aria-label={`移除 ${attachment.filename}`} onClick={() => onRemoveAttachment(index)}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {richComposer && (
        <textarea
          className="composer-html-source"
          value={draft.html_body}
          onChange={(event) => onPatchDraft({ html_body: event.target.value })}
          placeholder="HTML 正文，将在保存和发送前清洗"
        />
      )}
    </section>
  );
}

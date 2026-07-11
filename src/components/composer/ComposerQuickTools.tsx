import type React from 'react';
import { Bold, FileSignature, Italic, List, Paperclip } from 'lucide-react';
import type { DraftInput } from '../../app/types';

type ComposerQuickToolsProps = {
  draft: DraftInput;
  richComposer: boolean;
  dropActive: boolean;
  signature: string;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
  onRichComposerChange: (value: boolean) => void;
  onInsertSignature: () => void;
  onPickAttachments: () => void;
  onAttachmentDrop: React.DragEventHandler<HTMLElement>;
  onAttachmentDragEnter: React.DragEventHandler<HTMLElement>;
  onAttachmentDragLeave: React.DragEventHandler<HTMLElement>;
  onAttachmentDragOver: React.DragEventHandler<HTMLElement>;
};

export default function ComposerQuickTools({
  draft,
  richComposer,
  dropActive,
  signature,
  onPatchDraft,
  onRichComposerChange,
  onInsertSignature,
  onPickAttachments,
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

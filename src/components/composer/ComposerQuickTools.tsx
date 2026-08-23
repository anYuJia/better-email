import type React from 'react';
import { Bold, FileSignature, Italic, List, Paperclip } from 'lucide-react';
import type { DraftInput } from '../../app/types';
import { plainTextToRichHtml } from './composerBody';

type ComposerQuickToolsProps = {
  draft: DraftInput;
  dropActive: boolean;
  signature: string;
  onPatchDraft: (patch: Partial<DraftInput>) => void;
  onInsertSignature: () => void;
  onPickAttachments: () => void;
  onAttachmentDrop: React.DragEventHandler<HTMLElement>;
  onAttachmentDragEnter: React.DragEventHandler<HTMLElement>;
  onAttachmentDragLeave: React.DragEventHandler<HTMLElement>;
  onAttachmentDragOver: React.DragEventHandler<HTMLElement>;
};

export default function ComposerQuickTools({
  draft,
  dropActive,
  signature,
  onPatchDraft,
  onInsertSignature,
  onPickAttachments,
  onAttachmentDrop,
  onAttachmentDragEnter,
  onAttachmentDragLeave,
  onAttachmentDragOver,
}: ComposerQuickToolsProps) {
  const richHtml = draft.html_body || plainTextToRichHtml(draft.body);
  const regularAttachmentCount = draft.attachments.filter((attachment) => !attachment.is_inline).length;

  return (
    <section className="composer-quick-tools" aria-label="写信常用工具">
      <div className="composer-quick-toolbar">
        <div className="rich-toolbar" aria-label="富文本格式">
          <button
            type="button"
            title="加粗"
            aria-label="加粗"
            onClick={() => onPatchDraft({
              html_body: `${richHtml}<strong>加粗文字</strong>`,
              body: `${draft.body}加粗文字`,
            })}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            title="斜体"
            aria-label="斜体"
            onClick={() => onPatchDraft({
              html_body: `${richHtml}<em>斜体文字</em>`,
              body: `${draft.body}斜体文字`,
            })}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            title="插入列表"
            aria-label="插入列表"
            onClick={() => onPatchDraft({
              html_body: `${richHtml}<ul><li>列表项</li></ul>`,
              body: `${draft.body}\n- 列表项`,
            })}
          >
            <List size={14} />
          </button>
        </div>

        <div className="composer-signature">
          <button
            type="button"
            onClick={onInsertSignature}
            disabled={!signature}
            title={signature || '当前发件身份未设置签名'}
          >
            <FileSignature size={15} />
            插入签名
          </button>
        </div>

        <div
          className={`composer-attachments${dropActive ? ' drop-active' : ''}`}
          onDrop={onAttachmentDrop}
          onDragEnter={onAttachmentDragEnter}
          onDragLeave={onAttachmentDragLeave}
          onDragOver={onAttachmentDragOver}
        >
          <div className="composer-attachment-controls">
            <button
              type="button"
              className="composer-attachment-button"
              onClick={onPickAttachments}
            >
              <Paperclip size={15} />
              添加附件
            </button>
            {regularAttachmentCount > 0 && <span>{`已添加 ${regularAttachmentCount} 个附件`}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

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
    </section>
  );
}

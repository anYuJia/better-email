import React, { useRef, useState } from 'react';
import {
  Mail,
  Maximize2,
  Minus,
  Save,
  Send,
  X,
} from 'lucide-react';
import { isDraftEmpty } from '../app/appConfig';
import type {
  Account,
  ComposerAutosave,
  ComposeTemplate,
  Contact,
  DraftInput,
  MailIdentity,
} from '../app/types';
import { formatDate } from '../mailUtils';
import ComposerAdvancedTools from './composer/ComposerAdvancedTools';
import ComposerPrimaryFields from './composer/ComposerPrimaryFields';
import ComposerQuickTools from './composer/ComposerQuickTools';
import './composer/composer.css';

type ComposerPosition = {
  x: number;
  y: number;
};

type ComposerDragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

export type ComposerWindowProps = {
  minimized: boolean;
  draft: DraftInput;
  accounts: Account[];
  identities: MailIdentity[];
  fallbackAccountId: number;
  contacts: Contact[];
  templates: ComposeTemplate[];
  templateName: string;
  richComposer: boolean;
  dropActive: boolean;
  status: string;
  autosave: ComposerAutosave | null;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
  onDraftChange: (draft: DraftInput) => void;
  onAddContact: (contact: Contact) => void;
  onApplyTemplate: (template: ComposeTemplate) => void;
  onDeleteTemplate: (template: ComposeTemplate) => void;
  onTemplateNameChange: (value: string) => void;
  onSaveTemplate: () => void;
  onRichComposerChange: (value: boolean) => void;
  onInsertSignature: () => void;
  onPickAttachments: () => void;
  onRemoveAttachment: (index: number) => void;
  onAttachmentDrop: React.DragEventHandler<HTMLElement>;
  onAttachmentDragEnter: React.DragEventHandler<HTMLElement>;
  onAttachmentDragLeave: React.DragEventHandler<HTMLElement>;
  onAttachmentDragOver: React.DragEventHandler<HTMLElement>;
  onAttachmentPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
  onSaveDraft: () => void;
  onQueueDraft: () => void;
  onSendDraft: () => void;
};

export default function ComposerWindow({
  minimized,
  draft,
  accounts,
  identities,
  fallbackAccountId,
  contacts,
  templates,
  templateName,
  richComposer,
  dropActive,
  status,
  autosave,
  onMinimize,
  onRestore,
  onClose,
  onDraftChange,
  onAddContact,
  onApplyTemplate,
  onDeleteTemplate,
  onTemplateNameChange,
  onSaveTemplate,
  onRichComposerChange,
  onInsertSignature,
  onPickAttachments,
  onRemoveAttachment,
  onAttachmentDrop,
  onAttachmentDragEnter,
  onAttachmentDragLeave,
  onAttachmentDragOver,
  onAttachmentPaste,
  onSaveDraft,
  onQueueDraft,
  onSendDraft,
}: ComposerWindowProps) {
  const [position, setPosition] = useState<ComposerPosition>({ x: 0, y: 0 });
  const dragRef = useRef<ComposerDragState | null>(null);
  const title = draft.subject.trim() || '新邮件';
  const accountId = draft.account_id || fallbackAccountId || accounts[0]?.id || 0;
  const draftIdentities = identities.filter((identity) => identity.account_id === accountId);
  const draftIdentity =
    draftIdentities.find((identity) => identity.id === draft.identity_id)
    ?? draftIdentities.find((identity) => identity.is_default)
    ?? draftIdentities[0]
    ?? null;

  function patchDraft(patch: Partial<DraftInput>) {
    onDraftChange({ ...draft, ...patch });
  }

  function beginDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select, label, a')) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const maxX = Math.max(window.innerWidth * 0.42, 120);
    const maxY = Math.max(window.innerHeight * 0.36, 120);
    const nextX = Math.min(Math.max(drag.originX + event.clientX - drag.startX, -maxX), maxX);
    const nextY = Math.min(Math.max(drag.originY + event.clientY - drag.startY, -maxY), maxY);
    setPosition({ x: nextX, y: nextY });
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (minimized) {
    return (
      <div className="composer-backdrop composer-backdrop-minimized">
        <section className="composer-minimized" aria-label="已最小化的新邮件">
          <button className="composer-mini-main" type="button" onClick={onRestore}>
            <Mail size={17} />
            <span>
              <strong>{title}</strong>
              <small>{draft.to.trim() || '未填写收件人'}</small>
            </span>
          </button>
          <div className="composer-mini-actions">
            <button type="button" onClick={onRestore} aria-label="展开写信窗口">
              <Maximize2 size={15} />
              展开
            </button>
            <button type="button" onClick={onClose} aria-label="关闭写信窗口">
              <X size={15} />
              关闭
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className="composer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="composer"
        style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <header onPointerDown={beginDrag}>
          <span className="composer-title-copy">
            <strong>{title}</strong>
            <small>{draft.to.trim() || '新建邮件'}</small>
          </span>
          <div className="composer-header-actions">
            <button type="button" onClick={onMinimize} aria-label="最小化写信窗口">
              <Minus size={15} />
              最小化
            </button>
            <button type="button" onClick={onClose} aria-label="关闭写信窗口">
              <X size={15} />
              关闭
            </button>
          </div>
        </header>

        <ComposerPrimaryFields
          draft={draft}
          contacts={contacts}
          richComposer={richComposer}
          dropActive={dropActive}
          onPatchDraft={patchDraft}
          onAddContact={onAddContact}
          onPickAttachments={onPickAttachments}
          onRemoveAttachment={onRemoveAttachment}
          onAttachmentDrop={onAttachmentDrop}
          onAttachmentDragEnter={onAttachmentDragEnter}
          onAttachmentDragLeave={onAttachmentDragLeave}
          onAttachmentDragOver={onAttachmentDragOver}
          onAttachmentPaste={onAttachmentPaste}
        />

        <ComposerQuickTools
          draft={draft}
          richComposer={richComposer}
          dropActive={dropActive}
          signature={draftIdentity?.signature.trim() ?? ''}
          onPatchDraft={patchDraft}
          onRichComposerChange={onRichComposerChange}
          onInsertSignature={onInsertSignature}
          onPickAttachments={onPickAttachments}
          onAttachmentDrop={onAttachmentDrop}
          onAttachmentDragEnter={onAttachmentDragEnter}
          onAttachmentDragLeave={onAttachmentDragLeave}
          onAttachmentDragOver={onAttachmentDragOver}
        />

        <ComposerAdvancedTools
          draft={draft}
          accounts={accounts}
          identities={draftIdentities}
          accountId={accountId}
          identityId={draftIdentity?.id || 0}
          templates={templates}
          templateName={templateName}
          onPatchDraft={patchDraft}
          onApplyTemplate={onApplyTemplate}
          onDeleteTemplate={onDeleteTemplate}
          onTemplateNameChange={onTemplateNameChange}
          onSaveTemplate={onSaveTemplate}
        />

        <footer>
          <span>
            {status}
            {autosave && !isDraftEmpty(draft) ? ` · 自动保存 ${formatDate(autosave.saved_at)}` : ''}
          </span>
          <div>
            <button className="secondary" onClick={onSaveDraft}>
              <Save size={14} />
              保存草稿
            </button>
            <button className="secondary" onClick={onQueueDraft}>
              {draft.send_at.trim() ? '稍后发送' : '发件箱'}
            </button>
            <button onClick={onSendDraft}>
              <Send size={14} />
              发送
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

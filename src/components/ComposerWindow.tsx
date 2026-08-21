import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
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
  OutboundAttachmentInput,
} from '../app/types';
import { formatDate } from '../mailUtils';
import type { CrossAccountRiskItem } from '../app/crossAccountRisk';
import ConfirmDialog from './ConfirmDialog';
import ComposerAdvancedTools from './composer/ComposerAdvancedTools';
import ComposerPrimaryFields from './composer/ComposerPrimaryFields';
import ComposerQuickTools from './composer/ComposerQuickTools';
import useModalAccessibility from '../hooks/useModalAccessibility';
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
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const COMPOSER_VIEWPORT_MARGIN = 10;

function clampComposerPosition(
  panel: HTMLElement | null,
  current: ComposerPosition,
): ComposerPosition {
  if (!panel) return current;
  const rect = panel.getBoundingClientRect();
  const naturalLeft = rect.left - current.x;
  const naturalTop = rect.top - current.y;
  const minX = COMPOSER_VIEWPORT_MARGIN - naturalLeft;
  const maxX = window.innerWidth - COMPOSER_VIEWPORT_MARGIN - naturalLeft - rect.width;
  const minY = COMPOSER_VIEWPORT_MARGIN - naturalTop;
  const maxY = window.innerHeight - COMPOSER_VIEWPORT_MARGIN - naturalTop - rect.height;
  return {
    x: Math.min(Math.max(current.x, Math.min(minX, maxX)), Math.max(minX, maxX)),
    y: Math.min(Math.max(current.y, Math.min(minY, maxY)), Math.max(minY, maxY)),
  };
}

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
  onDraftChange: React.Dispatch<React.SetStateAction<DraftInput>>;
  onApplyTemplate: (template: ComposeTemplate) => void;
  onDeleteTemplate: (template: ComposeTemplate) => void;
  onTemplateNameChange: (value: string) => void;
  onSaveTemplate: () => void;
  onInsertSignature: () => void;
  onPickAttachments: () => void;
  onRemoveAttachment: (index: number) => void;
  onAttachmentDrop: React.DragEventHandler<HTMLElement>;
  onAttachmentDragEnter: React.DragEventHandler<HTMLElement>;
  onAttachmentDragLeave: React.DragEventHandler<HTMLElement>;
  onAttachmentDragOver: React.DragEventHandler<HTMLElement>;
  onAttachmentPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
  buildInlineImageAttachments: (files: File[]) => Promise<OutboundAttachmentInput[]>;
  onInlineImagesAdded: (attachments: OutboundAttachmentInput[]) => void;
  onSaveDraft: () => void;
  onQueueDraft: () => void;
  onSendDraft: () => void;
  onSendRiskConfirm: () => void;
  onSendRiskCancel: () => void;
  sendRiskConfirm: CrossAccountRiskItem[] | null;
  crossAccountRisks: CrossAccountRiskItem[];
  sendProgress: number | null;
  sendProgressMessage: string | null;
  attachmentProgress: number | null;
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
  onApplyTemplate,
  onDeleteTemplate,
  onTemplateNameChange,
  onSaveTemplate,
  onInsertSignature,
  onPickAttachments,
  onRemoveAttachment,
  onAttachmentDrop,
  onAttachmentDragEnter,
  onAttachmentDragLeave,
  onAttachmentDragOver,
  onAttachmentPaste,
  buildInlineImageAttachments,
  onInlineImagesAdded,
  onSaveDraft,
  onQueueDraft,
  onSendDraft,
  onSendRiskConfirm,
  onSendRiskCancel,
  sendRiskConfirm,
  crossAccountRisks,
  sendProgress,
  sendProgressMessage,
  attachmentProgress,
}: ComposerWindowProps) {
  const [position, setPosition] = useState<ComposerPosition>({ x: 0, y: 0 });
  const dragRef = useRef<ComposerDragState | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const minimizedRestoreRef = useRef<HTMLButtonElement | null>(null);
  const composerOpenerRef = useRef<HTMLElement | null>(null);
  const title = draft.subject.trim() || '新邮件';
  const accountId = draft.account_id || fallbackAccountId || accounts[0]?.id || 0;
  const draftIdentities = identities.filter((identity) => identity.account_id === accountId);
  const draftIdentity =
    draftIdentities.find((identity) => identity.id === draft.identity_id)
    ?? draftIdentities.find((identity) => identity.is_default)
    ?? draftIdentities[0]
    ?? null;

  function patchDraft(patch: Partial<DraftInput>) {
    onDraftChange((current) => ({ ...current, ...patch }));
  }

  useEffect(() => {
    composerOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => {
      const opener = composerOpenerRef.current;
      // The background inert cleanup runs later in the same React commit.
      // Restore in a microtask so the original compose trigger can receive
      // focus after every modal attribute has been removed.
      queueMicrotask(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, []);

  useModalAccessibility({
    open: !minimized,
    dialogRef: panelRef,
    backdropRef,
    focusTrapDisabled: sendRiskConfirm !== null,
  });

  useEffect(() => {
    if (minimized) {
      minimizedRestoreRef.current?.focus({ preventScroll: true });
      return;
    }
    const panel = panelRef.current;
    const firstField = panel?.querySelector<HTMLElement>('input[type="text"], input:not([type]), textarea');
    (firstField ?? panel)?.focus({ preventScroll: true });
  }, [minimized]);

  useEffect(() => {
    if (minimized) return undefined;
    const handleResize = () => {
      setPosition((current) => clampComposerPosition(panelRef.current, current));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [minimized]);

  function beginDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select, label, a')) return;
    const panel = panelRef.current;
    const rect = panel?.getBoundingClientRect();
    const naturalLeft = rect ? rect.left - position.x : 0;
    const naturalTop = rect ? rect.top - position.y : 0;
    const minX = COMPOSER_VIEWPORT_MARGIN - naturalLeft;
    const maxX = rect
      ? window.innerWidth - COMPOSER_VIEWPORT_MARGIN - naturalLeft - rect.width
      : 0;
    const minY = COMPOSER_VIEWPORT_MARGIN - naturalTop;
    const maxY = rect
      ? window.innerHeight - COMPOSER_VIEWPORT_MARGIN - naturalTop - rect.height
      : 0;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      minX: Math.min(minX, maxX),
      maxX: Math.max(minX, maxX),
      minY: Math.min(minY, maxY),
      maxY: Math.max(minY, maxY),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const nextX = Math.min(
      Math.max(drag.originX + event.clientX - drag.startX, drag.minX),
      drag.maxX,
    );
    const nextY = Math.min(
      Math.max(drag.originY + event.clientY - drag.startY, drag.minY),
      drag.maxY,
    );
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
      <aside className="composer-minimized-layer" aria-label="已最小化的新邮件">
        <section className="composer-minimized" aria-label="已最小化的新邮件">
          <button ref={minimizedRestoreRef} className="composer-mini-main" type="button" onClick={onRestore}>
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
      </aside>
    );
  }

  const normalizedSendProgress = sendProgress == null ? null : Math.max(0, Math.min(100, Math.round(sendProgress)));
  const normalizedAttachmentProgress = attachmentProgress == null ? null : Math.max(0, Math.min(100, Math.round(attachmentProgress)));
  const attachmentProgressMessage = sendProgressMessage && /\u9644\u4ef6/.test(sendProgressMessage)
    ? sendProgressMessage
    : normalizedAttachmentProgress == null
      ? ''
      : `附件处理中（${normalizedAttachmentProgress}%）`;

  return (
    <div
      ref={backdropRef}
      className="composer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="写信窗口"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={panelRef}
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

        {crossAccountRisks.length > 0 && (
          <div className="composer-risk-banner" role="alert">
            <AlertTriangle size={15} />
            <div>
              {crossAccountRisks.map((risk) => (
                <p key={risk.id}>
                  <strong>{risk.message}</strong>：{risk.detail}
                </p>
              ))}
            </div>
          </div>
        )}

        <ComposerPrimaryFields
          draft={draft}
          contacts={contacts}
          richComposer={richComposer}
          dropActive={dropActive}
          onPatchDraft={patchDraft}
          onPickAttachments={onPickAttachments}
          onRemoveAttachment={onRemoveAttachment}
          onAttachmentDrop={onAttachmentDrop}
          onAttachmentDragEnter={onAttachmentDragEnter}
          onAttachmentDragLeave={onAttachmentDragLeave}
          onAttachmentDragOver={onAttachmentDragOver}
          onAttachmentPaste={onAttachmentPaste}
          buildInlineImageAttachments={buildInlineImageAttachments}
          onInlineImagesAdded={onInlineImagesAdded}
        />

        <ComposerQuickTools
          draft={draft}
          dropActive={dropActive}
          signature={draftIdentity?.signature.trim() ?? ''}
          onPatchDraft={patchDraft}
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
          <div className="composer-footer-status">
            {normalizedAttachmentProgress !== null && (
              <div className="composer-attachment-progress-wrapper" aria-live="polite">
                <div
                  className="composer-attachment-progress"
                  role="progressbar"
                  aria-label="附件处理进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={normalizedAttachmentProgress}
                >
                  <div
                    className="composer-attachment-progress-fill"
                    style={{ transform: `scaleX(${normalizedAttachmentProgress / 100})` }}
                  />
                </div>
                <div className="composer-attachment-progress-message" title={attachmentProgressMessage}>
                  {attachmentProgressMessage}
                </div>
              </div>
            )}
            {normalizedSendProgress !== null && (
              <div className="composer-send-progress-wrapper">
                <div
                  className="composer-send-progress"
                  role="progressbar"
                  aria-label="发送进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={normalizedSendProgress}
                >
                  <div
                    className="composer-send-progress-fill"
                    style={{ transform: `scaleX(${normalizedSendProgress / 100})` }}
                  />
                </div>
                {sendProgressMessage ? (
                  <div className="composer-send-progress-message" title={sendProgressMessage}>
                    {sendProgressMessage}
                  </div>
                ) : null}
              </div>
            )}
            <span>
              {status}
              {autosave && !isDraftEmpty(draft) ? ` · 自动保存 ${formatDate(autosave.saved_at)}` : ''}
            </span>
          </div>
          <div className="composer-footer-actions">
            <button className="dialog-button dialog-button-secondary" onClick={onSaveDraft}>
              <Save size={14} />
              保存草稿
            </button>
            <button className="dialog-button dialog-button-secondary" onClick={onQueueDraft}>
              {draft.send_at.trim() ? '稍后发送' : '发件箱'}
            </button>
            <button className="dialog-button dialog-button-primary" onClick={onSendDraft}>
              <Send size={14} />
              发送
            </button>
          </div>
        </footer>
      </section>

      <ConfirmDialog
        open={sendRiskConfirm !== null}
        title="跨邮箱发送风险"
        description="发送前请确认以下风险。你可以返回修改发件账号或收件人。"
        summaryText={sendRiskConfirm?.map((risk) => `• ${risk.message}：${risk.detail}`).join('\n') ?? ''}
        danger
        confirmText="继续发送"
        cancelText="返回修改"
        onConfirm={onSendRiskConfirm}
        onCancel={onSendRiskCancel}
      />
    </div>
  );
}

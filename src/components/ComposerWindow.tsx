import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Mail,
  Maximize2,
  PanelBottomClose,
  Send,
  UsersRound,
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
import type { CrossAccountRiskItem } from '../app/crossAccountRisk';
import ConfirmDialog from './ConfirmDialog';
import ComposerAdvancedTools, { ComposerSenderContext, type ComposerPopoverMode } from './composer/ComposerAdvancedTools';
import ComposerContactsPanel, { type AddContactsResult, type ComposerRecipientField } from './composer/ComposerContactsPanel';
import ComposerPrimaryFields from './composer/ComposerPrimaryFields';
import ComposerQuickTools, { ComposerRichToolbar } from './composer/ComposerQuickTools';
import ComposerSchedulePicker from './composer/ComposerSchedulePicker';
import useModalAccessibility from '../hooks/useModalAccessibility';
import { useWheelContainment } from '../hooks/useWheelContainment';
import { startDraggingCurrentWindow } from '../tauriBridge';
import './composer/composer.css';
import './composer/composer-polish.css';

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

function formatClock(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatScheduleLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

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
  standaloneWindow?: boolean;
  platform?: 'macos' | 'windows' | 'linux' | 'web';
  focusRequest?: number;
  draft: DraftInput;
  accounts: Account[];
  identities: MailIdentity[];
  fallbackAccountId: number;
  contacts: Contact[];
  onAddContacts: (contacts: Contact[], field: ComposerRecipientField) => AddContactsResult;
  onOpenContactsSettings?: () => void;
  onScanRecentContacts?: () => Promise<void>;
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
  onSaveDraft: () => Promise<void> | void;
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
  standaloneWindow = false,
  platform = 'web',
  focusRequest = 0,
  draft,
  accounts,
  identities,
  fallbackAccountId,
  contacts,
  onAddContacts,
  onOpenContactsSettings,
  onScanRecentContacts,
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
  const scheduleAnchorRef = useRef<HTMLButtonElement | null>(null);
  const templateButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const sendMenuRef = useRef<HTMLDivElement | null>(null);
  const sendMenuItemRefs = useRef<HTMLButtonElement[]>([]);
  const minimizedRestoreRef = useRef<HTMLButtonElement | null>(null);
  const composerOpenerRef = useRef<HTMLElement | null>(null);
  const [contactsOpen, setContactsOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 900,
  );
  const [isNarrowContactsViewport, setIsNarrowContactsViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 900,
  );
  const [isMobileComposerViewport, setIsMobileComposerViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 720,
  );
  const [ccOpen, setCcOpen] = useState(() => Boolean(draft.cc.trim()));
  const [bccOpen, setBccOpen] = useState(() => Boolean(draft.bcc.trim()));
  const [activeRecipientField, setActiveRecipientField] = useState<ComposerRecipientField>('to');
  const [formattingOpen, setFormattingOpen] = useState(true);
  const [popoverMode, setPopoverMode] = useState<ComposerPopoverMode>(null);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  useWheelContainment(sendMenuRef, sendMenuOpen);
  const [scheduleOpenRequest, setScheduleOpenRequest] = useState(0);
  const [scheduleClearConfirmOpen, setScheduleClearConfirmOpen] = useState(false);
  const [saveDraftPending, setSaveDraftPending] = useState(false);
  const contactsPanelVisible = standaloneWindow || !isNarrowContactsViewport || contactsOpen;
  const title = draft.subject.trim() || '新邮件';
  const windowHeading = draft.in_reply_to ? '回复邮件' : '新邮件';
  const accountId = draft.account_id || fallbackAccountId || accounts[0]?.id || 0;
  const draftAccount = accounts.find((entry) => entry.id === accountId) ?? null;
  const draftContacts = contacts.filter((contact) => contact.account_id === accountId);
  const draftIdentities = identities.filter((identity) => identity.account_id === accountId);
  const draftIdentity =
    draftIdentities.find((identity) => identity.id === draft.identity_id)
    ?? draftIdentities.find((identity) => identity.is_default)
    ?? draftIdentities[0]
    ?? null;
  const explicitSaveStatus = /^正在保存|保存失败|网络异常/.test(status);
  const autosaveLabel = explicitSaveStatus
    ? status
    : autosave && !isDraftEmpty(draft)
      ? `已自动保存 · ${formatClock(autosave.saved_at)}`
      : isDraftEmpty(draft)
        ? ''
        : '正在保存…';

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    if (saveDraftPending) panel.setAttribute('inert', '');
    else panel.removeAttribute('inert');
    return () => panel.removeAttribute('inert');
  }, [saveDraftPending]);

  function patchDraft(patch: Partial<DraftInput>) {
    onDraftChange((current) => ({ ...current, ...patch }));
  }

  function closePopover() {
    const opener = popoverMode === 'templates' ? templateButtonRef : moreButtonRef;
    setPopoverMode(null);
    queueMicrotask(() => opener.current?.focus({ preventScroll: true }));
  }

  function toggleComposerPopover(mode: Exclude<ComposerPopoverMode, null>) {
    setSendMenuOpen(false);
    setPopoverMode((current) => current === mode ? null : mode);
  }

  async function handleSaveDraft() {
    if (saveDraftPending) return;
    setSaveDraftPending(true);
    let saved = false;
    try {
      await onSaveDraft();
      saved = true;
    } catch {
      // The controller keeps the draft open and exposes the failure in status.
    } finally {
      setSaveDraftPending(false);
    }
    if (saved) closePopover();
  }

  function closeSendMenu() {
    setSendMenuOpen(false);
    queueMicrotask(() => scheduleAnchorRef.current?.focus({ preventScroll: true }));
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
    open: !standaloneWindow && !minimized && isMobileComposerViewport,
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
  }, [focusRequest, minimized]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const contactsMedia = window.matchMedia('(max-width: 899px)');
    const mobileMedia = window.matchMedia('(max-width: 720px)');
    const updateViewportMode = () => {
      setIsNarrowContactsViewport(contactsMedia.matches);
      setIsMobileComposerViewport(mobileMedia.matches);
      if (contactsMedia.matches) setContactsOpen(false);
    };
    updateViewportMode();
    contactsMedia.addEventListener?.('change', updateViewportMode);
    mobileMedia.addEventListener?.('change', updateViewportMode);
    return () => {
      contactsMedia.removeEventListener?.('change', updateViewportMode);
      mobileMedia.removeEventListener?.('change', updateViewportMode);
    };
  }, []);

  useEffect(() => {
    setPosition((current) => clampComposerPosition(panelRef.current, current));
  }, [contactsPanelVisible]);

  useEffect(() => {
    if (draft.cc.trim()) setCcOpen(true);
    if (draft.bcc.trim()) setBccOpen(true);
    if (!draft.send_at.trim()) setScheduleClearConfirmOpen(false);
  }, [draft.bcc, draft.cc, draft.send_at]);

  useEffect(() => {
    if (!sendMenuOpen) return undefined;
    sendMenuItemRefs.current[0]?.focus({ preventScroll: true });
    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('.composer-send-split')) return;
      closeSendMenu();
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSendMenu();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      const items = sendMenuItemRefs.current.filter(Boolean);
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Home' || event.key === 'End') {
        (event.key === 'Home' ? items[0] : items[items.length - 1]).focus({ preventScroll: true });
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(currentIndex + delta + items.length) % items.length].focus({ preventScroll: true });
    }
    document.addEventListener('pointerdown', closeOnPointerDown, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [sendMenuOpen]);

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
  const composerBusy = normalizedSendProgress !== null || normalizedAttachmentProgress !== null;

  function beginNativeDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select, label, a, [role="button"]')) return;
    void startDraggingCurrentWindow().catch(() => undefined);
  }

  function handlePrimarySend() {
    if (composerBusy) return;
    if (draft.send_at.trim()) onQueueDraft();
    else onSendDraft();
  }

  const resolvedPlatform = (
    platform !== 'web'
      ? platform
      : typeof document !== 'undefined' && document.body.dataset.composerWindowPlatform === 'macos'
        ? 'macos'
        : typeof document !== 'undefined' && document.body.dataset.composerWindowPlatform === 'windows'
          ? 'windows'
          : platform
  );

  return (
    <div
      ref={backdropRef}
      className={`composer-backdrop ${standaloneWindow ? 'is-native-window' : isMobileComposerViewport ? 'is-modal' : 'is-floating'}`}
      data-composer-platform={standaloneWindow ? resolvedPlatform : undefined}
      role="dialog"
      aria-modal={!standaloneWindow && isMobileComposerViewport ? 'true' : undefined}
      aria-label="写信窗口"
      onClick={(event) => {
        if (!standaloneWindow && isMobileComposerViewport && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={panelRef}
        className={`composer${contactsPanelVisible ? ' has-contacts-panel' : ''}`}
        aria-busy={saveDraftPending || undefined}
        style={standaloneWindow ? undefined : { transform: `translate(${position.x}px, ${position.y}px)` }}
        onMouseDown={standaloneWindow ? undefined : (event) => event.stopPropagation()}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className={`composer-workspace${contactsPanelVisible ? ' has-contacts' : ''}`}>
          <div className="composer-editor-pane">
            <header className="composer-editor-header" onPointerDown={standaloneWindow ? beginNativeDrag : beginDrag}>
              {standaloneWindow && (
                <div
                  className="composer-titlebar-drag-region"
                  data-tauri-drag-region
                  onPointerDown={beginNativeDrag}
                  aria-hidden="true"
                />
              )}
              <span className="composer-title-copy">
                <strong>{windowHeading}</strong>
                <span
                  className="composer-autosave-status"
                  aria-live="polite"
                  title={explicitSaveStatus ? autosaveLabel : autosave ? `恢复点：${autosave.saved_at}` : autosaveLabel}
                >
                  {autosave && !isDraftEmpty(draft) && !explicitSaveStatus
                    ? <CheckCircle2 size={16} aria-hidden="true" />
                    : null}
                  {autosaveLabel}
                </span>
              </span>
              <div className="composer-header-actions">
                {!standaloneWindow && isNarrowContactsViewport && (
                  <button
                    type="button"
                    className="composer-contact-toggle"
                    aria-label="切换联系人面板"
                    aria-expanded={contactsOpen}
                    aria-pressed={contactsOpen}
                    aria-controls="composer-contacts-panel"
                    title="切换联系人面板"
                    onClick={() => setContactsOpen((current) => !current)}
                  >
                    <UsersRound size={17} aria-hidden="true" />
                    <span>联系人</span>
                  </button>
                )}
                {!standaloneWindow && (
                  <>
                    <button type="button" onClick={onMinimize} aria-label="收起写信" title="收起写信">
                      <PanelBottomClose size={17} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={onClose} aria-label="关闭写信窗口" title="关闭写信窗口">
                      <X size={17} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </header>

            <ComposerSenderContext
              accounts={accounts}
              identities={draftIdentities}
              accountId={accountId}
              identityId={draftIdentity?.id || 0}
              onPatchDraft={patchDraft}
            />

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
              contacts={draftContacts}
              richComposer={richComposer}
              dropActive={dropActive}
              ccOpen={ccOpen}
              bccOpen={bccOpen}
              onToggleCc={() => setCcOpen((current) => !current)}
              onToggleBcc={() => setBccOpen((current) => !current)}
              onRecipientFieldFocus={setActiveRecipientField}
              formattingToolbar={formattingOpen ? (editorRef) => <ComposerRichToolbar editorRef={editorRef} /> : undefined}
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

            <ComposerAdvancedTools
              mode={popoverMode}
              anchorRef={popoverMode === 'templates' ? templateButtonRef : moreButtonRef}
              templates={templates}
              templateName={templateName}
              onClose={closePopover}
              onApplyTemplate={onApplyTemplate}
              onDeleteTemplate={onDeleteTemplate}
              onTemplateNameChange={onTemplateNameChange}
              onSaveTemplate={onSaveTemplate}
              onSaveDraft={handleSaveDraft}
              saveDraftPending={saveDraftPending}
            />

            <footer>
              <div className="composer-footer-progress" aria-live="polite">
                {normalizedAttachmentProgress !== null && (
                  <div className="composer-attachment-progress-wrapper">
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
                    <span className="composer-attachment-progress-message" title={attachmentProgressMessage}>
                      {attachmentProgressMessage}
                    </span>
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
                    {sendProgressMessage ? <span>{sendProgressMessage}</span> : null}
                  </div>
                )}
              </div>
              <div className="composer-footer-main">
                <ComposerQuickTools
                  draft={draft}
                  dropActive={dropActive}
                  signature={draftIdentity?.signature.trim() || draftAccount?.signature.trim() || ''}
                  onInsertSignature={onInsertSignature}
                  onPickAttachments={onPickAttachments}
                  onAttachmentDrop={onAttachmentDrop}
                  onAttachmentDragEnter={onAttachmentDragEnter}
                  onAttachmentDragLeave={onAttachmentDragLeave}
                  onAttachmentDragOver={onAttachmentDragOver}
                  onToggleFormatting={() => setFormattingOpen((current) => !current)}
                  onOpenTemplates={() => toggleComposerPopover('templates')}
                  onOpenMore={() => toggleComposerPopover('more')}
                  templateButtonRef={templateButtonRef}
                  moreButtonRef={moreButtonRef}
                  formattingExpanded={formattingOpen}
                  hideRichToolbar
                />
                {draft.send_at.trim() ? (
                  <div className="composer-schedule-status">
                    <ComposerSchedulePicker
                      value={draft.send_at}
                      onChange={(value) => patchDraft({ send_at: value })}
                      openRequest={scheduleOpenRequest}
                      triggerLabel={`将于 ${formatScheduleLabel(draft.send_at)} 发送`}
                      compactTriggerLabel={formatScheduleLabel(draft.send_at)}
                    />
                    <button
                      type="button"
                      className="composer-schedule-clear"
                      aria-label="取消定时发送"
                      onClick={() => setScheduleClearConfirmOpen(true)}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                    {scheduleClearConfirmOpen && (
                      <div className="composer-schedule-clear-confirm" role="alertdialog" aria-label="取消定时发送确认">
                        <span>取消定时发送？</span>
                        <button type="button" onClick={() => setScheduleClearConfirmOpen(false)}>保留定时</button>
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() => {
                            patchDraft({ send_at: '' });
                            setScheduleClearConfirmOpen(false);
                          }}
                        >
                          确认取消
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <ComposerSchedulePicker
                    value={draft.send_at}
                    onChange={(value) => patchDraft({ send_at: value })}
                    openRequest={scheduleOpenRequest}
                    anchorRef={scheduleAnchorRef}
                    showTrigger={false}
                  />
                )}
                <div className="composer-send-split">
                  <button
                    type="button"
                    className="composer-send-primary"
                    disabled={composerBusy}
                    onClick={handlePrimarySend}
                  >
                    <Send size={17} aria-hidden="true" />
                    {draft.send_at.trim() ? (
                      <>
                        <span className="composer-send-label-full">定时发送 · {formatScheduleLabel(draft.send_at)}</span>
                        <span className="composer-send-label-compact">定时发送</span>
                      </>
                    ) : '发送'}
                  </button>
                  <button
                    type="button"
                    className="composer-send-menu-trigger"
                    ref={scheduleAnchorRef}
                    aria-label="发送选项"
                    aria-expanded={sendMenuOpen}
                    aria-haspopup="menu"
                    disabled={composerBusy}
                    onClick={() => setSendMenuOpen((current) => !current)}
                  >
                    <ChevronDown size={17} aria-hidden="true" />
                  </button>
                  {sendMenuOpen && (
                    <div
                      ref={sendMenuRef}
                      className="composer-send-menu"
                      role="menu"
                      aria-label="发送选项"
                    >
                      <button ref={(element) => { if (element) sendMenuItemRefs.current[0] = element; }} type="button" role="menuitem" onClick={() => { closeSendMenu(); setPopoverMode(null); onSendDraft(); }}>
                        立即发送
                      </button>
                      <button ref={(element) => { if (element) sendMenuItemRefs.current[1] = element; }} type="button" role="menuitem" onClick={() => { closeSendMenu(); setPopoverMode(null); onQueueDraft(); }}>
                        发件箱
                      </button>
                      <button ref={(element) => { if (element) sendMenuItemRefs.current[2] = element; }} type="button" role="menuitem" onClick={() => { closeSendMenu(); setPopoverMode(null); setScheduleOpenRequest((current) => current + 1); }}>
                        定时发送…
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </footer>
          </div>

          {contactsPanelVisible && (
            <ComposerContactsPanel
              contacts={draftContacts}
              draft={draft}
              activeRecipientField={activeRecipientField}
              onAddContacts={onAddContacts}
              onClose={() => setContactsOpen(false)}
              showClose={isNarrowContactsViewport}
              onOpenContactsSettings={onOpenContactsSettings}
              onScanRecentContacts={onScanRecentContacts}
            />
          )}
        </div>
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

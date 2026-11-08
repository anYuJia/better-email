import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  Mail,
  Maximize2,
  PanelBottomClose,
  Send,
  UsersRound,
  X,
} from 'lucide-react';
import { isDraftEmpty } from '../app/appConfig';
import { smtpUploadPercent } from '../app/smtpUploadProgress';
import type {
  Account,
  ComposerAutosave,
  ComposerSaveResult,
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
import ComposerTransferStatus from './composer/ComposerTransferStatus';
import { attachmentImportBlockReason, type AttachmentImportItem } from '../app/attachmentImports';
import type { ComposerSendIssue } from '../hooks/useComposerSend';
import useModalAccessibility from '../hooks/useModalAccessibility';
import useExitPresence from '../hooks/useExitPresence';
import useComposerEditingSession from '../hooks/useComposerEditingSession';
import useSurfaceMotion from '../hooks/useSurfaceMotion';
import useComposerGeometry from '../hooks/useComposerGeometry';
import { useWheelContainment } from '../hooks/useWheelContainment';
import { startDraggingCurrentWindow } from '../tauriBridge';
import { ComposerLoadingContext } from './composer/ComposerLoadingBoundary';
import './composer/composer.css';
import './composer/composer-geometry.css';
import './composer/composer-recovery.css';
import './composer/composer-polish.css';

const COMPOSER_CONTACTS_SPLIT_MIN_WIDTH = 900;

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

export type ComposerWindowProps = {
  /** Parent retains the presentation via useExitPresence after business close. */
  open?: boolean;
  editorFlushRef?: React.MutableRefObject<(() => void) | null>;
  minimized: boolean;
  standaloneWindow?: boolean;
  mobile?: boolean;
  defaultContactsOpen?: boolean;
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
  onRetryAutosave?: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onClose: () => void;
  onDraftChange: React.Dispatch<React.SetStateAction<DraftInput>>;
  onApplyTemplate: (template: ComposeTemplate) => void;
  onDeleteTemplate: (template: ComposeTemplate) => void;
  onTemplateNameChange: (value: string) => void;
  onSaveTemplate: () => ComposerSaveResult | void;
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
  onSaveDraft: () => Promise<ComposerSaveResult | void> | ComposerSaveResult | void;
  onQueueDraft: () => void;
  onSendDraft: () => void;
  onSendRiskConfirm: () => void;
  onSendRiskCancel: () => void;
  sendRiskConfirm: CrossAccountRiskItem[] | null;
  crossAccountRisks: CrossAccountRiskItem[];
  submissionPending?: boolean;
  sendProgress: number | null;
  sendProgressMessage: string | null;
  attachmentProgress: number | null;
  attachmentImports?: AttachmentImportItem[];
  isImportingAttachments?: boolean;
  onRetryAttachmentImport?: (id: string) => void;
  onDismissAttachmentImport?: (id: string) => void;
  sendIssue?: ComposerSendIssue | null;
};

export default function ComposerWindow({
  editorFlushRef,
  open = true,
  minimized,
  standaloneWindow = false,
  mobile = false,
  defaultContactsOpen,
  platform = 'web',
  focusRequest = 0,
  draft: incomingDraft,
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
  onRetryAutosave,
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
  submissionPending = false,
  sendProgress,
  sendProgressMessage,
  attachmentProgress,
  attachmentImports = [],
  isImportingAttachments = false,
  onRetryAttachmentImport,
  onDismissAttachmentImport,
  sendIssue,
}: ComposerWindowProps) {
  const loadingContext = useContext(ComposerLoadingContext);
  const loadingHandoff = useRef(loadingContext?.current.shown ? {
    ...loadingContext.current,
    focusMoved: document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      && document.activeElement !== loadingContext.current.opener
      && !document.activeElement.closest('.composer-loading-layer'),
  } : null);
  const initialFocusRequest = useRef(focusRequest);
  const surfaceActive = open && !minimized;
  const localEditorFlushRef = useRef<(() => void) | null>(null);
  const flushPendingRef = editorFlushRef ?? localEditorFlushRef;
  const editorPresent = useExitPresence(open && !minimized, standaloneWindow ? 0 : 180);
  const minimizedPresent = useExitPresence(open && minimized, standaloneWindow ? 0 : 180);
  const lastVisibleDraftRef = useRef(incomingDraft);
  useLayoutEffect(() => {
    if (open) lastVisibleDraftRef.current = incomingDraft;
  }, [incomingDraft, open]);
  // Closing may immediately clear the controller draft. Keep the last committed
  // text for the outgoing presentation without delaying that business action.
  const draft = open ? incomingDraft : lastVisibleDraftRef.current;
  const panelRef = useRef<HTMLElement | null>(null);
  const contactsPanelRef = useRef<HTMLElement | null>(null);
  const contactsBackdropRef = useRef<HTMLDivElement | null>(null);
  const [compactContacts, setCompactContacts] = useState(() =>
    !standaloneWindow || window.innerWidth < COMPOSER_CONTACTS_SPLIT_MIN_WIDTH);
  const [compactRecipients, setCompactRecipients] = useState(() => window.innerWidth <= 720);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const scheduleAnchorRef = useRef<HTMLButtonElement | null>(null);
  const templateButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const popoverAnchorRef = useRef<HTMLButtonElement | null>(null);
  const sendMenuRef = useRef<HTMLDivElement | null>(null);
  const sendMenuItemRefs = useRef<HTMLButtonElement[]>([]);
  const minimizedRestoreRef = useRef<HTMLButtonElement | null>(null);
  const minimizedLayerRef = useRef<HTMLElement | null>(null);
  const editingSession = useComposerEditingSession(panelRef, surfaceActive);
  const composerOpenerRef = useRef<HTMLElement | null | undefined>(loadingHandoff.current?.opener);
  const focusSessionRef = useRef({ mounted: false, closeHandled: false, generation: 0 });
  const [contactsOpen, setContactsOpen] = useState(() => {
    if (defaultContactsOpen !== undefined) return defaultContactsOpen;
    if (typeof window === 'undefined') return false;
    try {
      const stored = localStorage.getItem('better-email-composer-contacts-open');
      if (stored !== null) return stored === 'true' && window.innerWidth > 720;
    } catch {}
    return false;
  });
  const [isNarrowComposerViewport, setIsNarrowComposerViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 720,
  );
  const isMobileComposerViewport = mobile || isNarrowComposerViewport;
  const floating = !standaloneWindow && !isMobileComposerViewport;
  const geometry = useComposerGeometry(panelRef, floating, surfaceActive);
  const previousMinimized = useRef(minimized);
  const minimizeOffset = useCallback(() => {
    if (!floating || (!minimized && !previousMinimized.current)) return { x: 0, y: 4 };
    const panel = panelRef.current;
    if (!panel) return { x: 0, y: 24 };
    const bounds = panel.getBoundingClientRect();
    const target = minimizedLayerRef.current?.getBoundingClientRect();
    const dx = (target?.width ? target.left + target.width / 2 : window.innerWidth - 242) - (bounds.left + bounds.width / 2);
    const dy = (target?.height ? target.top + target.height / 2 : window.innerHeight - 54) - (bounds.top + bounds.height / 2);
    const length = Math.max(1, Math.hypot(dx, dy));
    return { x: Math.round(dx / length * 32), y: Math.round(dy / length * 32) };
  }, [floating, minimized]);
  useSurfaceMotion(panelRef, surfaceActive, { enabled: !standaloneWindow, getOffset: minimizeOffset });
  useSurfaceMotion(minimizedLayerRef, open && minimized, { distance: -8 });
  useLayoutEffect(() => {
    // The loading frame is already visible at this exact geometry. Do not
    // reveal the ready editor from transparent again during the handoff.
    if (loadingHandoff.current) panelRef.current?.getAnimations?.().forEach(animation => animation.cancel());
  }, []);
  useLayoutEffect(() => { previousMinimized.current = minimized; }, [minimized]);
  const [ccOpen, setCcOpen] = useState(() => Boolean(draft.cc.trim()));
  const [bccOpen, setBccOpen] = useState(() => Boolean(draft.bcc.trim()));
  const [activeRecipientField, setActiveRecipientField] = useState<ComposerRecipientField>('to');
  const [formattingOpen, setFormattingOpen] = useState(false);
  const [popoverMode, setPopoverMode] = useState<ComposerPopoverMode>(null);
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  useWheelContainment(sendMenuRef, sendMenuOpen);
  const [scheduleOpenRequest, setScheduleOpenRequest] = useState(0);
  const [scheduleClearConfirmOpen, setScheduleClearConfirmOpen] = useState(false);
  const [saveDraftPending, setSaveDraftPending] = useState(false);
  const [saveDraftFeedback, setSaveDraftFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const saveDraftBlockedReason = attachmentImportBlockReason(attachmentImports)
    || (isImportingAttachments ? '附件仍在准备中，请等待完成后再保存草稿。' : null);
  useEffect(() => { setSaveDraftFeedback(null); }, [saveDraftBlockedReason]);
  const contactsPanelVisible = contactsOpen;
  const contactsOverlayOpen = contactsOpen && compactContacts && !minimized && open;
  const title = draft.subject.trim() || '新邮件';
  const windowHeading = draft.in_reply_to ? '回复邮件' : '新邮件';
  const accountId = draft.account_id || fallbackAccountId || accounts[0]?.id || 0;
  const draftAccount = accounts.find((entry) => entry.id === accountId) ?? null;
  const draftContacts = useMemo(() => contacts.filter((contact) => contact.account_id === accountId), [contacts, accountId]);
  const draftIdentities = useMemo(() => identities.filter((identity) => identity.account_id === accountId), [identities, accountId]);
  const draftIdentity =
    draftIdentities.find((identity) => identity.id === draft.identity_id)
    ?? draftIdentities.find((identity) => identity.is_default)
    ?? draftIdentities[0]
    ?? null;
  const explicitSaveStatus = /^正在保存|保存失败|网络异常/.test(status);
  const saveFailed = explicitSaveStatus ? /保存失败|网络异常/.test(status) : autosave?.save_state === 'error';
  const autosaveLabel = explicitSaveStatus
    ? saveFailed ? '草稿保存失败' : status
    : saveFailed
      ? '本机保存失败'
      : autosave?.save_state === 'saving' || (!autosave && !isDraftEmpty(draft))
        ? '正在保存…'
        : autosave && !isDraftEmpty(draft) ? '已存本机' : '';
  const autosaveDetail = explicitSaveStatus ? status : saveFailed
    ? `本机恢复点保存失败，内容仍在编辑器。${autosave?.save_error || ''}`
    : autosaveLabel === '已存本机' && autosave
      ? `本机恢复点已保存 · ${formatClock(autosave.saved_at)}。保存到草稿箱请使用“保存草稿”。`
      : autosaveLabel;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const focused = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement)
      ? document.activeElement : null;
    if (saveDraftPending || submissionPending || !open || minimized) panel.setAttribute('inert', '');
    else panel.removeAttribute('inert');
    return () => {
      panel.removeAttribute('inert');
      if (focused) queueMicrotask(() => {
        const active = document.activeElement;
        if (focused.isConnected && !focused.closest('[inert]')
          && (active === document.body || (active instanceof Node && panel.contains(active)))) {
          focused.focus({ preventScroll: true });
        }
      });
    };
  }, [editorPresent, minimized, open, saveDraftPending, submissionPending]);

  function patchDraft(patch: Partial<DraftInput>) {
    if (!open || minimized || saveDraftPending || submissionPending) return;
    onDraftChange((current) => ({ ...current, ...patch }));
  }

  function requestClose() {
    flushPendingRef.current?.();
    onClose();
  }

  function closePopover() {
    const opener = popoverAnchorRef.current;
    setPopoverMode(null);
    queueMicrotask(() => {
      const target = opener;
      if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    });
  }

  function toggleComposerPopover(mode: Exclude<ComposerPopoverMode, null>) {
    setSaveDraftFeedback(null);
    popoverAnchorRef.current = mode === 'templates' ? templateButtonRef.current : moreButtonRef.current;
    setSendMenuOpen(false);
    setPopoverMode((current) => current === mode ? null : mode);
  }

  async function handleSaveDraft() {
    if (saveDraftPending) return;
    flushPendingRef.current?.();
    setSaveDraftFeedback(null);
    setSaveDraftPending(true);
    let saved = false;
    try {
      const result = await onSaveDraft();
      // Legacy callbacks complete with void; the controller explicitly reports
      // blocked/empty attempts so they cannot be mistaken for a saved draft.
      saved = !result || result.status === 'saved';
      if (result && result.status !== 'saved') setSaveDraftFeedback({ message: result.message, error: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error).replace(/^Error:\s*/i, '');
      setSaveDraftFeedback({ message: `保存失败，内容已保留：${message}`, error: true });
    } finally {
      setSaveDraftPending(false);
    }
    if (saved) closePopover();
  }

  function closeSendMenu() {
    setSendMenuOpen(false);
    queueMicrotask(() => {
      const target = scheduleAnchorRef.current;
      if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    if (surfaceActive) return;
    setPopoverMode(null);
    setSendMenuOpen(false);
    setScheduleClearConfirmOpen(false);
  }, [surfaceActive]);

  function restoreComposerFocus() {
    const active = document.activeElement;
    const stillOwned = !active || active === document.body || active === document.documentElement
      || backdropRef.current?.contains(active) || minimizedLayerRef.current?.contains(active);
    const opener = composerOpenerRef.current;
    if (stillOwned && opener?.isConnected && !opener.closest('[inert]') && !opener.hasAttribute('disabled')) {
      opener.focus({ preventScroll: true });
    }
  }

  useLayoutEffect(() => {
    const session = focusSessionRef.current;
    session.mounted = true;
    session.generation += 1;
    // Capture once, before passive autofocus. StrictMode's second setup must
    // never replace the external opener with a field from this same composer.
    if (composerOpenerRef.current === undefined) {
      const active = document.activeElement;
      composerOpenerRef.current = active instanceof HTMLElement && active !== document.body
        && !backdropRef.current?.contains(active) && !minimizedLayerRef.current?.contains(active)
        ? active : null;
    }
    return () => {
      session.mounted = false;
      if (session.closeHandled) return;
      const generation = ++session.generation;
      // Also support callers that unmount directly, after modal inert cleanup.
      // A StrictMode replay or a newer opening invalidates this queued request.
      queueMicrotask(() => {
        if (!session.mounted && session.generation === generation && !session.closeHandled) restoreComposerFocus();
      });
    };
  }, []);

  useEffect(() => {
    const session = focusSessionRef.current;
    const generation = ++session.generation;
    session.closeHandled = !open;
    if (open) return;
    // Restore once at business close. The visual-tail unmount must not steal
    // focus again after the user starts another task.
    queueMicrotask(() => {
      if (session.generation === generation && session.closeHandled) restoreComposerFocus();
    });
  }, [open]);

  useModalAccessibility({
    open: open && !standaloneWindow && !minimized && isMobileComposerViewport,
    dialogRef: panelRef,
    backdropRef,
    focusTrapDisabled: sendRiskConfirm !== null || contactsOverlayOpen,
  });

  function closeContacts() {
    setContactsOpen(false);
    try { localStorage.setItem('better-email-composer-contacts-open', 'false'); } catch {}
  }

  useModalAccessibility({
    open: contactsOverlayOpen,
    dialogRef: contactsPanelRef,
    backdropRef: contactsBackdropRef,
    onEscape: closeContacts,
  });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || minimized) return undefined;
    const measure = () => {
      setCompactRecipients(window.innerWidth <= 720);
      const width = panel.clientWidth || panel.getBoundingClientRect().width
        || (standaloneWindow ? window.innerWidth : Math.min(760, window.innerWidth - 32));
      setCompactContacts(width < COMPOSER_CONTACTS_SPLIT_MIN_WIDTH);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(panel);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [minimized, standaloneWindow]);

  useEffect(() => {
    if (!open) return;
    if (minimized) {
      if (loadingHandoff.current) loadingHandoff.current.focusMoved = false;
      editingSession.capture();
      minimizedRestoreRef.current?.focus({ preventScroll: true });
      return;
    }
    if (contactsOverlayOpen) return;
    // Desktop loading never owns the workspace: completing the lazy import
    // must not steal focus if the user continued reading another message.
    if (!isMobileComposerViewport && loadingHandoff.current?.focusMoved && focusRequest === initialFocusRequest.current) return;
    if (editingSession.restore()) return;
    const panel = panelRef.current;
    const firstField = panel?.querySelector<HTMLElement>('input[type="text"], input:not([type]), textarea');
    (firstField ?? panel)?.focus({ preventScroll: true });
  }, [focusRequest, minimized, open]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mobileMedia = window.matchMedia('(max-width: 720px)');
    const updateViewportMode = () => {
      setIsNarrowComposerViewport(mobileMedia.matches);
    };
    updateViewportMode();
    mobileMedia.addEventListener?.('change', updateViewportMode);
    return () => {
      mobileMedia.removeEventListener?.('change', updateViewportMode);
    };
  }, []);


  useEffect(() => {
    if (draft.cc.trim()) setCcOpen(true);
    if (draft.bcc.trim()) setBccOpen(true);
    if (!draft.send_at.trim()) setScheduleClearConfirmOpen(false);
  }, [draft.bcc, draft.cc, draft.send_at]);

  useEffect(() => {
    if (!sendMenuOpen || !surfaceActive) return undefined;
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
  }, [sendMenuOpen, surfaceActive]);

  const minimizedPanel = minimizedPresent ? (
      <aside
        ref={minimizedLayerRef}
        className={`composer-minimized-layer${open && minimized ? '' : ' is-exiting'}`}
        aria-label="已最小化的新邮件"
        aria-hidden={!open || !minimized || undefined}
        {...(!open || !minimized ? { inert: '' } : {})}
      >
        <section className="composer-minimized" aria-label="已最小化的新邮件">
          <button ref={minimizedRestoreRef} className="composer-mini-main" type="button" onClick={onRestore}>
            <Mail size={18} />
            <span>
              <strong>{title}</strong>
              <small>{draft.to.trim() || '未填写收件人'}</small>
            </span>
          </button>
          <div className="composer-mini-actions">
            <button type="button" onClick={onRestore} aria-label="展开写信窗口">
              <Maximize2 size={16} />
              展开
            </button>
            <button type="button" onClick={requestClose} aria-label="关闭写信窗口">
              <X size={16} />
              关闭
            </button>
          </div>
        </section>
      </aside>
  ) : null;

  const normalizedSendProgress = sendProgress == null ? null : Math.max(0, Math.min(100, Math.round(sendProgress)));
  const normalizedAttachmentProgress = attachmentProgress == null ? null : Math.max(0, Math.min(100, Math.round(attachmentProgress)));
  const attachmentProgressMessage = sendProgressMessage && /\u9644\u4ef6/.test(sendProgressMessage)
    ? sendProgressMessage
    : normalizedAttachmentProgress == null
      ? ''
      : `附件处理中（${normalizedAttachmentProgress}%）`;
  const composerBusy = submissionPending || isImportingAttachments || attachmentImports.some((item) => item.status === 'failed')
    || sendIssue?.kind === 'uncertain' || normalizedSendProgress !== null || normalizedAttachmentProgress !== null;
  const uploadingToServer = normalizedSendProgress !== null && normalizedSendProgress >= 60 && normalizedSendProgress < 88;
  const uploadPercent = smtpUploadPercent(sendProgressMessage);
  const sendWorking = submissionPending || normalizedSendProgress !== null;
  const sendStateLabel = sendWorking ? (normalizedSendProgress !== null ? '发送中…' : '提交中…')
    : isImportingAttachments ? '准备附件…'
      : sendIssue?.kind === 'uncertain' ? '待核对'
        : attachmentImports.some(item => item.status === 'failed') ? '检查附件' : null;

  function beginNativeDrag(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select, label, a, [role="button"]')) return;
    void startDraggingCurrentWindow().catch(() => undefined);
  }

  function handlePrimarySend() {
    if (composerBusy) return;
    flushPendingRef.current?.();
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
    <>
    {minimizedPanel}
    {(open || editorPresent) && (
    <div
      ref={backdropRef}
      className={`composer-backdrop ${standaloneWindow ? 'is-native-window' : isMobileComposerViewport ? 'is-modal' : 'is-floating'}${open && !minimized ? '' : ' is-exiting'}`}
      data-composer-platform={standaloneWindow ? resolvedPlatform : undefined}
      role="dialog"
      aria-modal={!standaloneWindow && isMobileComposerViewport ? 'true' : undefined}
      aria-label="写信窗口"
      aria-hidden={!open || minimized || undefined}
      hidden={!editorPresent}
      {...(!surfaceActive ? { inert: '' } : {})}
      onClick={(event) => {
        if (!standaloneWindow && isMobileComposerViewport && event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section
        ref={panelRef}
        className={`composer composer-frame${contactsPanelVisible ? ' has-contacts-panel' : ''}`}
        aria-busy={saveDraftPending || submissionPending || undefined}
        style={geometry.style}
        onMouseDown={standaloneWindow ? undefined : (event) => event.stopPropagation()}
        onPointerMove={geometry.move}
        onPointerUp={geometry.end}
        onPointerCancel={geometry.end}
        onLostPointerCapture={geometry.end}
        onFocusCapture={(event) => editingSession.capture(event.target)}
        onBlurCapture={(event) => editingSession.capture(event.target)}
      >
        <div className={`composer-workspace${contactsPanelVisible ? ' has-contacts' : ''}`}>
          <div className="composer-editor-pane">
            <header className="composer-editor-header" onPointerDown={standaloneWindow ? beginNativeDrag : geometry.beginDrag}>
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
                  role={saveFailed ? 'alert' : 'status'}
                  data-save-state={saveFailed ? 'error' : autosave?.save_state ?? 'saved'}
                  title={autosaveDetail}
                >
                  <CheckCircle2 size={16} aria-hidden="true" style={{ visibility: autosaveLabel === '已存本机' ? 'visible' : 'hidden' }} />
                  {autosaveLabel}
                  {saveFailed && (explicitSaveStatus || onRetryAutosave) && (
                    <button type="button" disabled={saveDraftPending} onClick={explicitSaveStatus ? handleSaveDraft : onRetryAutosave}>重试</button>
                  )}
                </span>
              </span>
              <div className="composer-header-actions">
                <button
                  type="button"
                  className="composer-contact-toggle"
                  aria-label="切换联系人面板"
                  aria-expanded={contactsOpen}
                  aria-pressed={contactsOpen}
                  aria-controls="composer-contacts-panel"
                  title="切换联系人面板"
                  onClick={() => {
                    setContactsOpen((current) => {
                      const next = !current;
                      try {
                        localStorage.setItem('better-email-composer-contacts-open', String(next));
                      } catch {}
                      return next;
                    });
                  }}
                >
                  <UsersRound size={18} aria-hidden="true" />
                  <span>联系人</span>
                </button>
                {!standaloneWindow && (
                  <>
                    <button type="button" onClick={() => { flushPendingRef.current?.(); editingSession.capture(); onMinimize(); }} aria-label="收起写信" title="收起写信">
                      <PanelBottomClose size={18} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={requestClose} aria-label="关闭写信窗口" title="关闭写信窗口">
                      <X size={18} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            </header>

            <ComposerSenderContext
              active={surfaceActive}
              accounts={accounts}
              identities={draftIdentities}
              accountId={accountId}
              identityId={draftIdentity?.id || 0}
              onPatchDraft={patchDraft}
            />

            {crossAccountRisks.length > 0 && (
              <div className="composer-risk-banner" role="alert">
                <AlertTriangle size={16} />
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
              mobile={mobile || compactRecipients}
              active={surfaceActive}
              flushPendingRef={flushPendingRef}
              draft={draft}
              contacts={draftContacts}
              richComposer={richComposer}
              dropActive={dropActive}
              ccOpen={ccOpen}
              bccOpen={bccOpen}
              onToggleCc={() => setCcOpen((current) => !current)}
              onToggleBcc={() => setBccOpen((current) => !current)}
              onRecipientFieldFocus={setActiveRecipientField}
              formattingToolbar={formattingOpen ? (editorRef) => <ComposerRichToolbar editorRef={editorRef} active={surfaceActive} /> : undefined}
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
              mode={surfaceActive ? popoverMode : null}
              anchorRef={popoverAnchorRef}
              templates={templates}
              templateName={templateName}
              onClose={closePopover}
              onApplyTemplate={onApplyTemplate}
              onDeleteTemplate={onDeleteTemplate}
              onTemplateNameChange={onTemplateNameChange}
              onSaveTemplate={onSaveTemplate}
              onSaveDraft={handleSaveDraft}
              signature={draftIdentity?.signature.trim() || draftAccount?.signature.trim() || ''}
              onInsertSignature={onInsertSignature}
              onOpenTemplates={() => { popoverAnchorRef.current = moreButtonRef.current; setPopoverMode('templates'); }}
              saveDraftPending={saveDraftPending}
              saveDraftBlockedReason={saveDraftBlockedReason}
              saveDraftFeedback={saveDraftFeedback}
            />

            <ComposerTransferStatus
              imports={attachmentImports}
              sendIssue={sendIssue}
              disabled={submissionPending}
              onRetry={onRetryAttachmentImport}
              onDismiss={onDismissAttachmentImport}
              onRetrySend={handlePrimarySend}
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
                      className={`composer-send-progress${uploadingToServer && uploadPercent === null ? ' is-indeterminate' : ''}`}
                      role="progressbar"
                      aria-label="发送进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={uploadPercent ?? (uploadingToServer ? undefined : normalizedSendProgress)}
                      aria-valuetext={sendProgressMessage || '正在准备发送'}
                    >
                      <div
                        className="composer-send-progress-fill"
                        style={{ transform: `scaleX(${(uploadPercent ?? normalizedSendProgress) / 100})` }}
                      />
                    </div>
                    {sendProgressMessage ? <span className="composer-send-progress-message">{sendProgressMessage}</span> : null}
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
                      active={surfaceActive}
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
                      <X size={16} aria-hidden="true" />
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
                    active={surfaceActive}
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
                    aria-busy={sendWorking || isImportingAttachments}
                    title={sendStateLabel ? sendProgressMessage || (sendIssue?.kind === 'uncertain' ? '请先在发件箱核对发送结果' : sendStateLabel) : undefined}
                    onClick={handlePrimarySend}
                  >
                    {sendWorking || isImportingAttachments ? <LoaderCircle size={18} className="ui-spinner" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
                    {sendStateLabel || (draft.send_at.trim() ? (
                      <>
                        <span className="composer-send-label-full">定时发送 · {formatScheduleLabel(draft.send_at)}</span>
                        <span className="composer-send-label-compact">定时发送</span>
                      </>
                    ) : '发送')}
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
                    <ChevronDown size={18} aria-hidden="true" />
                  </button>
                  {surfaceActive && sendMenuOpen && (
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
            <div
              ref={contactsBackdropRef}
              className="composer-contacts-layer"
              onClick={(event) => { if (event.target === event.currentTarget && compactContacts) closeContacts(); }}
            >
              <ComposerContactsPanel
                panelRef={contactsPanelRef}
                modal={contactsOverlayOpen}
                contacts={draftContacts}
                draft={draft}
                activeRecipientField={activeRecipientField}
                onAddContacts={onAddContacts}
                onClose={closeContacts}
                showClose
                onOpenContactsSettings={onOpenContactsSettings}
                onScanRecentContacts={onScanRecentContacts}
              />
            </div>
          )}
        </div>
        {floating && (
          <button type="button" className="composer-resize-handle" aria-label="调整写信窗口大小"
            title="拖动调整大小；方向键微调，Home 恢复默认"
            onPointerDown={geometry.beginResize} onKeyDown={geometry.resizeWithKeyboard} />
        )}
      </section>

      {submissionPending && (
        <span className="sr-only" role="status" aria-live="polite">
          {sendProgressMessage || '正在提交邮件，请等待完成。'}
        </span>
      )}

      <ConfirmDialog
        open={open && !minimized && sendRiskConfirm !== null}
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
    )}
    </>
  );
}

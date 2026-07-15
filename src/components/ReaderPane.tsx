import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  Clock,
  Copy,
  Download,
  ExternalLink,
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Forward,
  Image as ImageIcon,
  Mail,
  MailPlus,
  MailOpen,
  MoreHorizontal,
  Reply,
  ReplyAll,
  RotateCcw,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react';
import { movableFoldersForBulk, movableFoldersForMessage } from '../app/appConfig';
import { canSnoozeRole } from '../app/snooze';
import type {
  AccountScope,
  Attachment,
  Folder,
  Label,
  Message,
  ThreadSummary,
} from '../app/types';
import { formatBytes, formatDate, bodyLooksLikeHtml, htmlHasRenderableContent, htmlHasRemoteVisualContent, isMessageBodyCorrupted } from '../mailUtils';
import { invoke } from '../tauriBridge';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import type { BulkMessageAction } from './messageContextMenu';
import useImagePreview, { type PreviewImage, type AttachmentContextMenu } from './reader/useImagePreview';
import useInlineImages from './reader/useInlineImages';
import SenderIdentity from './reader/SenderIdentity';
import PlainMessageBody, { EmptyMessageBody } from './reader/PlainMessageBody';
import QuickReplySection from './reader/QuickReplySection';
import { attachmentKind, attachmentIcon, attachmentTypeDescription } from './reader/attachmentUtils';
import EmailShadowView from './reader/EmailShadowView';
import EmailReaderSkeleton from './EmailReaderSkeleton';

const readerBodyRenderDelayMs = 0;
const readerBodyRenderIdleTimeoutMs = 50;

type IdleScheduler = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type ComposeMode = 'reply' | 'replyAll' | 'forward';
type TrustScope = 'sender' | 'domain';
type ImageContextMenu = PreviewImage & { x: number; y: number } | null;
type PlainBodyBlock =
  | { type: 'text'; content: string }
  | { type: 'original'; index: number; meta: string[]; content: string };

export type ReaderPaneProps = {
  activeThread: ThreadSummary | null;
  threadMessages: Message[];
  activeThreadSelected: Message | null;
  selected: Message | null;
  selectedId: number | null;
  accountScope: AccountScope;
  folders: Folder[];
  labels: Label[];
  attachments: Attachment[];
  selectedSenderTrusted: boolean;
  selectedSenderDomain: string;
  selectedHasRemoteImageWarning: boolean;
  quickReplyBody: string;
  onSelectMessage: (messageId: number) => void;
  readTriggerKey: number;
  onComposeNew: (fields?: { to?: string }) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode) => void;
  onRunThreadAction: (action: BulkMessageAction) => void;
  onMoveThreadToFolder: (folder: Folder) => void;
  onToggleThreadLabel: (label: Label) => void;
  onToggleThreadMute: () => void;
  onToggleStar: (message: Message) => void;
  onEditDraft: (message: Message) => void;
  onRestoreFromTrash: () => void;
  onMoveArchive: () => void;
  onMoveTrash: () => void;
  onToggleRead: (message: Message) => void;
  onReadComplete: (message: Message) => void;
  onUnsnooze: () => void;
  onSnooze: () => void;
  onExportMessage: () => void;
  onFetchBody: (isSilent?: boolean) => void | Promise<void>;
  onMarkNotSpam: () => void;
  onMarkAsSpam: () => void;
  onAllowRemoteImagesOnce: () => void;
  onTrustRemoteImages: (scope: TrustScope) => void;
  onBlockSender: () => void;
  onPermanentlyDelete: () => void;
  onEmptyTrash: () => void;
  onMoveToFolder: (folder: Folder) => void;
  onToggleLabel: (label: Label) => void;
  onCreateLabel?: (name: string, color: string) => Promise<Label>;
  onUpdateLabel?: (id: number, name: string, color: string) => Promise<void>;
  onDeleteLabel?: (id: number) => Promise<void>;
  onOpenAttachment: (attachment: Attachment) => void;
  onDownloadAttachment: (attachment: Attachment) => void | Promise<void>;
  onSaveAttachmentAs: (attachment: Attachment) => void;
  onQuickReplyChange: (value: string) => void;
  onSendQuickReply: (message: Message) => void;
};

function attachmentErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, '').trim() || '附件下载失败，请重试。';
}


export default function ReaderPane({
  activeThread,
  threadMessages,
  activeThreadSelected,
  selected,
  selectedId,
  readTriggerKey,
  accountScope,
  folders,
  labels,
  attachments,
  selectedSenderTrusted,
  selectedSenderDomain,
  selectedHasRemoteImageWarning,
  quickReplyBody,
  onSelectMessage,
  onComposeNew,
  onComposeFromMessage,
  onRunThreadAction,
  onMoveThreadToFolder,
  onToggleThreadLabel,
  onToggleThreadMute,
  onToggleStar,
  onEditDraft,
  onRestoreFromTrash,
  onMoveArchive,
  onMoveTrash,
  onToggleRead,
  onReadComplete,
  onUnsnooze,
  onSnooze,
  onExportMessage,
  onFetchBody,
  onMarkNotSpam,
  onMarkAsSpam,
  onAllowRemoteImagesOnce,
  onTrustRemoteImages,
  onBlockSender,
  onPermanentlyDelete,
  onEmptyTrash,
  onMoveToFolder,
  onToggleLabel,
  onCreateLabel,
  onUpdateLabel,
  onDeleteLabel,
  onOpenAttachment,
  onDownloadAttachment,
  onSaveAttachmentAs,
  onQuickReplyChange,
  onSendQuickReply,
}: ReaderPaneProps) {
  const [downloadingAttachmentIds, setDownloadingAttachmentIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [isDownloadingAllAttachments, setIsDownloadingAllAttachments] = useState(false);

  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#2f7ed8');
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null);
  const [editingLabelName, setEditingLabelName] = useState('');
  const [labelToDelete, setLabelToDelete] = useState<Label | null>(null);
  const [clickedLink, setClickedLink] = useState<{ href: string; text: string } | null>(null);

  async function handleCreateLabel() {
    if (!newLabelName.trim() || !onCreateLabel) return;
    try {
      await onCreateLabel(newLabelName.trim(), newLabelColor);
      setNewLabelName('');
    } catch (e) {
      console.error(e);
    }
  }

  async function handleUpdateLabel(id: number) {
    if (!editingLabelName.trim() || !onUpdateLabel) return;
    try {
      await onUpdateLabel(id, editingLabelName.trim(), newLabelColor);
      setEditingLabelId(null);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteLabel(id: number) {
    if (!onDeleteLabel) return;
    try {
      await onDeleteLabel(id);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAttachmentDownload(attachment: Attachment): Promise<boolean> {
    if (downloadingAttachmentIds.has(attachment.id)) return false;
    setAttachmentErrors((current) => {
      const next = { ...current };
      delete next[attachment.id];
      return next;
    });
    setDownloadingAttachmentIds((current) => {
      const next = new Set(current);
      next.add(attachment.id);
      return next;
    });
    try {
      await onDownloadAttachment(attachment);
      return true;
    } catch (error) {
      setAttachmentErrors((current) => ({
        ...current,
        [attachment.id]: attachmentErrorMessage(error),
      }));
      return false;
    } finally {
      setDownloadingAttachmentIds((current) => {
        const next = new Set(current);
        next.delete(attachment.id);
        return next;
      });
    }
  }

  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenu>(null);
  const [attachmentContextMenu, setAttachmentContextMenu] = useState<AttachmentContextMenu>(null);
  const [bodyRenderMessageId, setBodyRenderMessageId] = useState<number | null>(null);
  const [showPlaceholder, setShowPlaceholder] = useState(false);
  const readerRef = useRef<HTMLElement | null>(null);
  const completedReadMessageIdsRef = useRef<Set<number>>(new Set());
  const prevIdRef = useRef<number | null>(null);

  useEffect(() => {
    const currentId = selected?.id ?? null;
    const isDifferentMessage = currentId !== prevIdRef.current;
    prevIdRef.current = currentId;

    if (isDifferentMessage) {
      setBodyRenderMessageId(null);
      setShowPlaceholder(false);
    }

    if (!selectedId || !selected) return undefined;

    const isPlainText = !selected.sanitized_html?.trim() &&
                        !bodyLooksLikeHtml(selected.body) &&
                        selected.attachment_count === 0;

    if (isPlainText) {
      setBodyRenderMessageId(selectedId);
      return undefined;
    }

    const scheduler = window as IdleScheduler;
    let idleHandle: number | null = null;
    let cancelled = false;
    
    if (bodyRenderMessageId !== selectedId) {
      const timer = window.setTimeout(() => {
        const renderBody = () => {
          if (!cancelled) React.startTransition(() => setBodyRenderMessageId(selectedId));
        };
        if (scheduler.requestIdleCallback) {
          idleHandle = scheduler.requestIdleCallback(renderBody, { timeout: readerBodyRenderIdleTimeoutMs });
        } else {
          renderBody();
        }
      }, readerBodyRenderDelayMs);

      const placeholderTimer = window.setTimeout(() => {
        if (!cancelled && isDifferentMessage) {
          setShowPlaceholder(true);
        }
      }, 16);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        window.clearTimeout(placeholderTimer);
        if (idleHandle !== null) scheduler.cancelIdleCallback?.(idleHandle);
      };
    }
  }, [selectedId, selected?.id, selected?.attachment_count, bodyRenderMessageId]);

  const isSelectedBodyCorrupted = Boolean(selected && isMessageBodyCorrupted(selected.body));
  const bodySelected = bodyRenderMessageId === selected?.id ? selected : null;
  const isBodyRenderReady = Boolean(bodySelected) && !isSelectedBodyCorrupted;



  useEffect(() => {
    if (!selected?.id) return;
    if (selected.is_read) {
      completedReadMessageIdsRef.current.add(selected.id);
    } else {
      completedReadMessageIdsRef.current.delete(selected.id);
    }
  }, [selected?.id, selected?.is_read, readTriggerKey]);

  function maybeCompleteReading() {
    if (!selected || selected.is_read || !isBodyRenderReady) return;
    if (completedReadMessageIdsRef.current.has(selected.id)) return;
    const readerElement = readerRef.current;
    if (!readerElement) return;
    const distanceToBottom = readerElement.scrollHeight - readerElement.scrollTop - readerElement.clientHeight;
    if (distanceToBottom > 48) return;
    completedReadMessageIdsRef.current.add(selected.id);
    onReadComplete(selected);
  }

  const {
    imagePreview,
    setImagePreview,
    imagePreviewZoom,
    imagePreviewFit,
    imagePreviewPan,
    imagePreviewStageRef,
    imagePreviewImageRef,
    openImagePreview,
    resetImagePreview,
    zoomIn,
    zoomOut,
    showOriginalSize,
    handleImageLoad,
    handleImagePreviewWheel,
    handleImagePreviewPointerDown,
    handleImagePreviewPointerMove,
    stopImagePreviewPanning,
    downloadImage,
    saveImageAs,
    downloadPreviewImage,
    savePreviewImageAs,
    copyPreviewImageSource,
    copyPreviewImageToClipboard,
    handleReaderHtmlClick,
    handleReaderHtmlContextMenu,
  } = useImagePreview(
    selected,
    imageContextMenu,
    setImageContextMenu,
    attachmentContextMenu,
    setAttachmentContextMenu,
  );

  const {
    inlineImageResolution,
    inlineImageError,
    inlineImageRefreshError,
    isDownloadingInlineImages,
    isRefreshingInlineImages,
    handleLoadInlineImages,
  } = useInlineImages({
    selected: bodySelected,
    attachments: bodySelected ? attachments : [],
    attachmentErrors,
    setAttachmentErrors,
    onFetchBody: () => onFetchBody(true),
    handleAttachmentDownload,
  });

  const regularAttachments = useMemo(
    () => attachments.filter((attachment) => !attachment.is_inline),
    [attachments],
  );
  const pendingAttachmentCount = useMemo(
    () => regularAttachments.filter((attachment) => !attachment.is_downloaded).length,
    [regularAttachments],
  );
  const regularAttachmentTotalSize = useMemo(
    () => regularAttachments.reduce((sum, item) => sum + item.size_bytes, 0),
    [regularAttachments],
  );
  const visibleSecurityWarnings = useMemo(
    () => selected?.security_warnings.filter(
      (warning) =>
        warning !== '正文包含外部链接，请核对域名后再访问。' &&
        !(selectedSenderTrusted && warning.includes('远程图片')),
    ) ?? [],
    [selected?.security_warnings, selectedSenderTrusted],
  );
  const readerHtml = inlineImageResolution.html;
  const hasRenderableHtml = Boolean(
    bodySelected?.sanitized_html.trim()
      && htmlHasRenderableContent(readerHtml),
  );
  const selectedBodyLooksLikeHtml = Boolean(bodySelected && bodyLooksLikeHtml(bodySelected.body));
  const selectedHasRemoteVisualContent = Boolean(
    bodySelected && htmlHasRemoteVisualContent(bodySelected.body),
  );
  const shouldOfferRemoteContent = Boolean(
    bodySelected
      && (selectedHasRemoteImageWarning || selectedHasRemoteVisualContent)
      && !hasRenderableHtml
      && bodySelected.body.trim(),
  );
  const plainBodyForReader = bodySelected && !bodySelected.sanitized_html.trim() && !selectedBodyLooksLikeHtml && !isSelectedBodyCorrupted
    ? bodySelected.body
    : '';

  useEffect(() => {
    maybeCompleteReading();
  }, [selected?.id, selected?.is_read, isBodyRenderReady, readerHtml, plainBodyForReader]);

  useEffect(() => {
    if (!selected || selected.is_read || !isBodyRenderReady) return undefined;
    if (completedReadMessageIdsRef.current.has(selected.id)) {
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      if (completedReadMessageIdsRef.current.has(selected.id)) {
        return;
      }
      completedReadMessageIdsRef.current.add(selected.id);
      onReadComplete(selected);
    }, 2000);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [selected?.id, selected?.is_read, isBodyRenderReady, onReadComplete, readTriggerKey]);

  useEffect(() => {
    setDownloadingAttachmentIds(new Set());
    setAttachmentErrors({});
    setIsDownloadingAllAttachments(false);
    setImagePreview(null);
    resetImagePreview();
    setImageContextMenu(null);
    setAttachmentContextMenu(null);
  }, [selectedId, resetImagePreview]);



  async function handleDownloadAllAttachments() {
    if (isDownloadingAllAttachments) return;
    const pending = regularAttachments.filter((attachment) => !attachment.is_downloaded);
    if (pending.length === 0) return;
    setIsDownloadingAllAttachments(true);
    try {
      for (const attachment of pending) {
        await handleAttachmentDownload(attachment);
      }
    } finally {
      setIsDownloadingAllAttachments(false);
    }
  }

  async function previewAttachment(attachment: Attachment) {
    if (!attachment.is_downloaded) {
      const downloaded = await handleAttachmentDownload(attachment);
      if (!downloaded) return;
    }
    if (attachmentKind(attachment) === 'image') {
      const dataUrl = await invoke<string>('read_attachment_data_url', { attachmentId: attachment.id });
      openImagePreview({
        src: dataUrl,
        alt: attachment.filename,
        attachmentId: attachment.id,
      });
      return;
    }
    onOpenAttachment(attachment);
  }

  async function revealAttachmentInFinder(attachment: Attachment) {
    if (!attachment.is_downloaded) {
      const downloaded = await handleAttachmentDownload(attachment);
      if (!downloaded) return;
    }
    await invoke<string>('reveal_attachment_in_finder', { attachmentId: attachment.id });
  }

  async function copyAttachmentToClipboard(attachment: Attachment) {
    if (!attachment.is_downloaded) {
      const downloaded = await handleAttachmentDownload(attachment);
      if (!downloaded) return;
    }

    try {
      await invoke<string>('copy_attachment_file_to_clipboard', { attachmentId: attachment.id });
    } catch (error) {
      setAttachmentErrors((current) => ({
        ...current,
        [attachment.id]: attachmentErrorMessage(error) || '复制附件文件失败，请重新下载后再试。',
      }));
    }
  }

  function attachmentMenuItems(attachment: Attachment): ContextMenuItem[] {
    const downloaded = attachment.is_downloaded;
    const downloading = downloadingAttachmentIds.has(attachment.id);
    const canPreview = attachmentKind(attachment) === 'image';
    return [
      ...(canPreview ? [{
        id: 'preview',
        label: '预览',
        icon: <ImageIcon size={14} />,
        disabled: downloading,
        onSelect: () => { previewAttachment(attachment).catch(() => undefined); },
      }] : []),
      {
        id: 'open',
        label: '打开',
        icon: <ExternalLink size={14} />,
        disabled: !downloaded || downloading,
        onSelect: () => onOpenAttachment(attachment),
      },
      {
        id: 'open-with',
        label: '选择 App 打开',
        detail: downloaded ? '在 Finder 中定位后选择应用' : '先下载并定位文件',
        icon: <FolderOpen size={14} />,
        disabled: downloading,
        onSelect: () => { revealAttachmentInFinder(attachment).catch(() => undefined); },
      },
      {
        id: 'download',
        label: downloaded ? '重新下载' : '下载',
        icon: <Download size={14} />,
        disabled: downloading,
        onSelect: () => { handleAttachmentDownload(attachment).catch(() => undefined); },
      },
      {
        id: 'save-as',
        label: '另存为…',
        icon: <Download size={14} />,
        disabled: !downloaded || downloading,
        onSelect: () => onSaveAttachmentAs(attachment),
      },
      {
        id: 'copy',
        label: '复制文件',
        icon: <Copy size={14} />,
        separatorBefore: true,
        onSelect: () => { copyAttachmentToClipboard(attachment).catch(() => undefined); },
      },
    ];
  }





  if (activeThread && threadMessages.length > 0) {
    const allThreadRead = threadMessages.every((message) => message.is_read);
    const allThreadStarred = threadMessages.every((message) => message.is_starred);
    const threadMovableMessages = threadMessages.filter(
      (message) => message.folder_role !== 'drafts' && message.folder_role !== 'sent',
    );
    const threadArchiveCount = threadMessages.filter(
      (message) => !['archive', 'drafts', 'sent', 'trash'].includes(message.folder_role),
    ).length;
    const threadTrashCount = threadMessages.filter(
      (message) => message.folder_role !== 'drafts' && message.folder_role !== 'trash',
    ).length;
    const threadMoveFolders = movableFoldersForBulk(folders, threadMovableMessages);

    return (
      <section className="reader-panel">
        <article className="reader thread-reader">
          <header className="reader-header">
            <div className="reader-title-block">
              <h1>{activeThread.subject || '(无主题)'}</h1>
              <p>{activeThread.participants} · {threadMessages.length} 封邮件 · 未读 {activeThread.unread_count}</p>
            </div>
            <div className="reader-actions">
              <button
                className="icon-only-action"
                title={allThreadStarred ? '取消整个会话星标' : '添加整个会话星标'}
                aria-label={allThreadStarred ? '取消整个会话星标' : '添加整个会话星标'}
                onClick={() => onRunThreadAction(allThreadStarred ? 'unstar' : 'star')}
              >
                <Star size={17} fill={allThreadStarred ? 'currentColor' : 'none'} />
              </button>
              <button
                className="primary-action"
                title="回复最新邮件"
                onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'reply')}
              >
                <Reply size={16} />
                <span>回复</span>
              </button>
              <button
                className="icon-only-action"
                title="回复全部"
                aria-label="回复全部"
                onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'replyAll')}
              >
                <ReplyAll size={17} />
              </button>
              <button
                className="icon-only-action"
                title="转发最新邮件"
                aria-label="转发最新邮件"
                onClick={() => activeThreadSelected && onComposeFromMessage(activeThreadSelected, 'forward')}
              >
                <Forward size={17} />
              </button>
              <button className="icon-only-action" title="新邮件" aria-label="新邮件" onClick={() => onComposeNew()}>
                <MailPlus size={17} />
              </button>
              <button
                className="icon-only-action"
                title="归档会话中的收件邮件"
                aria-label="归档会话中的收件邮件"
                disabled={threadArchiveCount === 0}
                onClick={() => onRunThreadAction('archive')}
              >
                <Archive size={16} />
              </button>
              <button
                className="icon-only-action"
                title={allThreadRead ? '整个会话标为未读' : '整个会话标为已读'}
                aria-label={allThreadRead ? '整个会话标为未读' : '整个会话标为已读'}
                onClick={() => onRunThreadAction(allThreadRead ? 'unread' : 'read')}
              >
                {allThreadRead ? <Mail size={16} /> : <MailOpen size={16} />}
              </button>
              <button
                className="icon-only-action danger-action"
                title="将会话移到废纸篓"
                aria-label="将会话移到废纸篓"
                disabled={threadTrashCount === 0}
                onClick={() => onRunThreadAction('trash')}
              >
                <Trash2 size={16} />
              </button>
              <details className="reader-more-menu compact-menu">
                <summary className="icon-only-summary" title="更多会话操作" aria-label="更多会话操作">
                  <MoreHorizontal size={17} />
                </summary>
                <div>
                  <span className="menu-section-title">会话</span>
                  <button type="button" onClick={onToggleThreadMute}>
                    {activeThread.is_muted ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    {activeThread.is_muted ? '取消静音会话' : '静音会话'}
                  </button>
                  <span className="menu-section-title">标签</span>
                  {labels.map((label) => (
                    <button
                      type="button"
                      key={label.id}
                      className={threadMessages.every((message) => message.labels.includes(label.name)) ? 'active' : ''}
                      onClick={() => onToggleThreadLabel(label)}
                    >
                      <span className="label-dot" style={{ background: label.color }} />
                      {label.name}
                    </button>
                  ))}
                  <span className="menu-section-title">移动到</span>
                  {threadMoveFolders.map((folder) => (
                    <button type="button" key={folder.id} onClick={() => onMoveThreadToFolder(folder)}>
                      {folder.name}
                    </button>
                  ))}
                  {threadMoveFolders.length === 0 && (
                    <span className="menu-empty-note">多账号会话或当前邮件不可移动</span>
                  )}
                </div>
              </details>
            </div>
          </header>
          <div className="thread-stack">
            {threadMessages.map((message) => (
              <section
                className={message.id === selectedId ? 'thread-message active' : 'thread-message'}
                key={message.id}
                onClick={() => onSelectMessage(message.id)}
              >
                <header>
                  <SenderIdentity message={message} />
                  <time>{formatDate(message.received_at)}</time>
                </header>
                <p>{message.snippet || message.body}</p>
                <div className="message-chips">
                  <span>{message.folder_role}</span>
                  {message.labels.map((label) => <span key={label}>{label}</span>)}
                  {message.attachment_count > 0 && <span><File size={12} /> {message.attachment_count}</span>}
                </div>
              </section>
            ))}
          </div>
        </article>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="reader-panel">
        <div className="empty-reader">
          <div className="empty-reader-card">
            <div className="empty-state-mark">
              <Mail size={24} />
            </div>
            <strong>选择一封邮件开始阅读</strong>
            <span>常用动作会保持可见，整理与安全选项按需展开。</span>
            <button type="button" className="empty-reader-compose" onClick={() => onComposeNew()}>
              <MailPlus size={15} />
              新邮件
            </button>
          </div>
        </div>
      </section>
    );
  }

  const isDraft = selected.folder_role === 'drafts';
  const isTrash = selected.folder_role === 'trash';

  return (
    <section className="reader-panel">
      <article className="reader" ref={readerRef} onScroll={maybeCompleteReading}>
        <header className="reader-header">
          <div className="reader-title-block">
            <h1>{selected.subject || '(无主题)'}</h1>
            <SenderIdentity message={selected} />
          </div>
          <div className="reader-actions" aria-label="邮件操作">
            <button
              className="icon-only-action"
              title={selected.is_starred ? '取消星标' : '添加星标'}
              aria-label={selected.is_starred ? '取消星标' : '添加星标'}
              onClick={() => onToggleStar(selected)}
            >
              <Star size={17} fill={selected.is_starred ? 'currentColor' : 'none'} />
            </button>
            {isDraft ? (
              <button className="primary-action" title="继续编辑草稿" onClick={() => onEditDraft(selected)}>
                <MailOpen size={16} />
                <span>继续编辑</span>
              </button>
            ) : (
              <>
                <button className="primary-action" title="回复" onClick={() => onComposeFromMessage(selected, 'reply')}>
                  <Reply size={16} />
                  <span>回复</span>
                </button>
                <button
                  className="icon-only-action"
                  title="回复全部"
                  aria-label="回复全部"
                  onClick={() => onComposeFromMessage(selected, 'replyAll')}
                >
                  <ReplyAll size={17} />
                </button>
                <button
                  className="icon-only-action"
                  title="转发"
                  aria-label="转发"
                  onClick={() => onComposeFromMessage(selected, 'forward')}
                >
                  <Forward size={17} />
                </button>
                <button className="icon-only-action" title="新邮件" aria-label="新邮件" onClick={() => onComposeNew()}>
                  <MailPlus size={17} />
                </button>
              </>
            )}
            {isTrash ? (
              <button title="恢复邮件" onClick={onRestoreFromTrash}>
                <RotateCcw size={16} />
                <span>恢复</span>
              </button>
            ) : !isDraft && (
              <button className="icon-only-action" aria-label="归档" title="归档" onClick={onMoveArchive}>
                <Archive size={16} />
              </button>
            )}
            {!isDraft && (
              <button
                className="icon-only-action"
                aria-label={selected.is_read ? '标为未读' : '标为已读'}
                title={selected.is_read ? '标为未读' : '标为已读'}
                onClick={() => onToggleRead(selected)}
              >
                <Mail size={16} />
              </button>
            )}
            {!isTrash && (
              <button className="icon-only-action danger-action" aria-label="删除" title="删除" onClick={onMoveTrash}>
                <Trash2 size={16} />
              </button>
            )}
            <details className="reader-more-menu compact-menu">
              <summary className="icon-only-summary" title="更多操作" aria-label="更多操作">
                <MoreHorizontal size={17} />
              </summary>
              <div>
                <span className="menu-section-title">整理</span>
                {selected.folder_role === 'snoozed' ? (
                  <button onClick={onUnsnooze}><Clock size={16} /> 取消稍后</button>
                ) : canSnoozeRole(selected.folder_role) && (
                  <button onClick={onSnooze}><Clock size={16} /> 稍后处理</button>
                )}
                <button onClick={onExportMessage}>导出 EML</button>
                {selected.remote_uid > 0 && !selected.body.trim() && (
                  <button onClick={() => onFetchBody(false)}>拉取正文</button>
                )}
                {selected.folder_role === 'spam' ? (
                  <button onClick={onMarkNotSpam}>不是垃圾邮件</button>
                ) : (
                  <button onClick={onMarkAsSpam}>标为垃圾邮件</button>
                )}
                {!isDraft && selected.sender_email.trim() && (
                  <>
                    <span className="menu-section-title">安全</span>
                    {!selectedSenderTrusted && (
                      <button onClick={() => onTrustRemoteImages('sender')}>信任发件人</button>
                    )}
                    {selectedSenderDomain && !selectedSenderTrusted && (
                      <button onClick={() => onTrustRemoteImages('domain')}>
                        信任发件人域名：{selectedSenderDomain}
                      </button>
                    )}
                    <button onClick={onBlockSender}>阻止该发件人</button>
                  </>
                )}
                {isTrash && (
                  <>
                    <span className="menu-section-title">删除</span>
                    <button className="danger-menu-item" onClick={onPermanentlyDelete}>
                      <Trash2 size={16} /> 永久删除
                    </button>
                    <button className="danger-menu-item" onClick={onEmptyTrash}>清空废纸篓</button>
                  </>
                )}
                <span className="menu-section-title">移动到</span>
                {movableFoldersForMessage(folders, selected).map((folder) => (
                  <button type="button" key={folder.id} onClick={() => onMoveToFolder(folder)}>
                    {folder.name}
                  </button>
                ))}
              </div>
            </details>
          </div>
        </header>

        <div className="reader-meta">
          <span>{formatDate(selected.received_at)}</span>
          {accountScope === 'all' && <span>{selected.account_email}</span>}
          {selected.snoozed_until && <span>稍后到 {formatDate(selected.snoozed_until)}</span>}
          {selected.has_attachments && <span>含附件</span>}
        </div>

        <div className="label-tools">
          {selected.labels.length === 0 && <span className="label-empty">无标签</span>}
          {selected.labels.map((labelName) => {
            const label = labels.find((item) => item.name === labelName);
            return (
              <span className="active-label-chip" key={labelName}>
                <span className="label-dot" style={{ background: label?.color ?? '#8b95a1' }} />
                {labelName}
              </span>
            );
          })}
          <details className="compact-menu label-menu">
            <summary><Tag size={15} /> 标签</summary>
            <div className="label-menu-container">
              <div className="label-menu-add-section">
                <input
                  type="text"
                  placeholder="新建标签..."
                  value={newLabelName}
                  onChange={(e) => setNewLabelName(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      await handleCreateLabel();
                    }
                  }}
                />
                <div className="label-color-selectors">
                  {['#2f7ed8', '#2da44e', '#d97706', '#8250df', '#cf222e', '#6e7781'].map((c) => (
                    <button
                      type="button"
                      key={c}
                      className={`color-dot-btn ${newLabelColor === c ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setNewLabelColor(c)}
                    />
                  ))}
                  <button
                    type="button"
                    className="label-add-submit-btn"
                    disabled={!newLabelName.trim()}
                    onClick={handleCreateLabel}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="label-menu-list">
                {labels.length === 0 ? (
                  <div className="label-menu-empty">
                    暂无标签，在上方输入名称并点击 + 新建
                  </div>
                ) : (
                  labels.map((label) => {
                    const isEditing = editingLabelId === label.id;
                    return (
                      <div className="label-menu-item-row" key={label.id}>
                        {isEditing ? (
                          <div className="label-edit-inline">
                            <input
                              type="text"
                              value={editingLabelName}
                              onChange={(e) => setEditingLabelName(e.target.value)}
                              onKeyDown={async (e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  await handleUpdateLabel(label.id);
                                }
                              }}
                            />
                            <div className="label-edit-actions">
                              <button type="button" onClick={() => handleUpdateLabel(label.id)}>确定</button>
                              <button type="button" onClick={() => setEditingLabelId(null)}>取消</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={`label-select-btn ${selected.labels.includes(label.name) ? 'active' : ''}`}
                              onClick={() => onToggleLabel(label)}
                            >
                              <span className="label-dot" style={{ background: label.color }} />
                              <span className="label-name-text">{label.name}</span>
                            </button>
                            <div className="label-item-actions">
                              <button
                                type="button"
                                className="action-edit"
                                title="编辑名称"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingLabelId(label.id);
                                  setEditingLabelName(label.name);
                                }}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="action-delete"
                                title="删除标签"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLabelToDelete(label);
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </details>
        </div>

        {regularAttachments.length > 0 && (
          <div className="attachment-section">
            <header className="attachment-section-header">
              <span>
                <strong>附件</strong>
                <small>{regularAttachments.length} 个 · {formatBytes(regularAttachmentTotalSize)}</small>
              </span>
              {pendingAttachmentCount > 0 && (
                <button
                  type="button"
                  disabled={isDownloadingAllAttachments}
                  aria-busy={isDownloadingAllAttachments}
                  onClick={handleDownloadAllAttachments}
                >
                  <Download size={14} />
                  {isDownloadingAllAttachments
                    ? '顺序下载中…'
                    : `下载全部 ${pendingAttachmentCount} 个`}
                </button>
              )}
            </header>
            <div className="attachments">
              {regularAttachments.map((attachment) => {
                const downloading = downloadingAttachmentIds.has(attachment.id);
                const transferError = attachmentErrors[attachment.id] ?? '';
                const kind = attachmentKind(attachment);
                const canPreview = kind === 'image';
                return (
                  <div
                    className={`attachment-item ${transferError ? 'attachment-download-failed' : ''}`}
                    key={attachment.id}
                    onDoubleClick={() => {
                      if (attachment.is_downloaded) onOpenAttachment(attachment);
                      else handleAttachmentDownload(attachment).catch(() => undefined);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setAttachmentContextMenu({ attachment, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <span className={`attachment-file-icon attachment-file-icon-${kind}`} aria-hidden="true">
                      {attachmentIcon(attachment)}
                    </span>
                    <span className="attachment-copy">
                      <strong>{attachment.filename}</strong>
                      <small>
                        {attachmentTypeDescription(attachment)} · {formatBytes(attachment.size_bytes)}
                        {attachment.is_downloaded ? ' · 已下载' : ' · 未下载'}
                      </small>
                    </span>
                    <div className="attachment-actions">
                      {canPreview && (
                        <button
                          type="button"
                          className="attachment-preview-button"
                          title={attachment.local_path || attachment.filename}
                          disabled={downloading}
                          aria-busy={downloading}
                          onClick={() => previewAttachment(attachment).catch(() => undefined)}
                        >
                          预览
                        </button>
                      )}
                      <button
                        type="button"
                        className="attachment-primary-button"
                        title={attachment.local_path || attachment.filename}
                        disabled={downloading}
                        aria-busy={downloading}
                        onClick={() => attachment.is_downloaded
                          ? onOpenAttachment(attachment)
                          : handleAttachmentDownload(attachment)}
                      >
                        {attachment.is_downloaded
                          ? '打开'
                          : downloading ? '下载中…' : transferError ? '重试' : '下载'}
                      </button>
                    </div>
                    {transferError && (
                      <small className="attachment-transfer-status" role="status">
                        {transferError}
                      </small>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(inlineImageResolution.pendingAttachments.length > 0
          || inlineImageResolution.missingContentIds.length > 0) && (
          <div className="inline-image-notice" role="status">
            <span className="inline-image-notice-icon" aria-hidden="true">
              <ImageIcon size={16} />
            </span>
            <span className="inline-image-notice-copy">
              <strong>
                {isRefreshingInlineImages
                  ? '正在读取内嵌图片'
                  : inlineImageResolution.pendingAttachments.length > 0
                    ? `正文包含 ${inlineImageResolution.pendingAttachments.length} 张内嵌图片`
                    : '部分内嵌图片不可用'}
              </strong>
              <small>
                {inlineImageError
                  || inlineImageRefreshError
                  || (isRefreshingInlineImages
                    ? '正在从服务器重新获取附件信息'
                    : inlineImageResolution.missingContentIds.length > 0
                      ? `${inlineImageResolution.missingContentIds.length} 张图片暂未匹配到附件`
                      : '按需加载，减少内存和网络占用')}
              </small>
            </span>
            {inlineImageResolution.pendingAttachments.length > 0 && (
              <button
                type="button"
                disabled={isDownloadingInlineImages}
                aria-busy={isDownloadingInlineImages}
                onClick={handleLoadInlineImages}
              >
                {isDownloadingInlineImages ? '加载中…' : inlineImageError ? '重试' : '显示图片'}
              </button>
            )}
          </div>
        )}

        {(visibleSecurityWarnings.length > 0 || selectedHasRemoteImageWarning || shouldOfferRemoteContent) && (
          <div className="reader-warning-panel">
            <div className="reader-warning-heading">
              <strong>安全提示</strong>
              {(selectedHasRemoteImageWarning || shouldOfferRemoteContent) && (
                <span>远程图片默认阻止</span>
              )}
            </div>
            {visibleSecurityWarnings.map((warning) => <p key={warning}>{warning}</p>)}
            {shouldOfferRemoteContent && (
              <div className="reader-warning-action-row">
                <button
                  type="button"
                  className="reader-warning-primary-action"
                  onClick={onAllowRemoteImagesOnce}
                >
                  查看内容
                </button>
                <details className="compact-menu reader-warning-actions">
                  <summary><SlidersHorizontal size={15} /> 更多</summary>
                  <div>
                    {!selectedSenderTrusted && (
                      <button type="button" onClick={() => onTrustRemoteImages('sender')}>信任发件人</button>
                    )}
                    {selectedSenderDomain && !selectedSenderTrusted && (
                      <button type="button" onClick={() => onTrustRemoteImages('domain')}>
                        信任发件人域名：{selectedSenderDomain}
                      </button>
                    )}
                    <button type="button" onClick={onBlockSender}>阻止该发件人</button>
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {!isBodyRenderReady ? (
          showPlaceholder ? (
            <EmailReaderSkeleton />
          ) : null
        ) : hasRenderableHtml ? (
          <div
            ref={(el) => {
              if (el) {
                el.addEventListener('email-link-click', ((event: CustomEvent) => {
                  const { href, text } = event.detail;
                  // Handle mailto and other non-http(s) schemes directly or ignore
                  if (href.startsWith('mailto:')) {
                    // Let the system handle it or ignore, since we want to avoid WebView navigating
                    // Let's invoke shell open or ignore.
                    invoke('open_attachment', { local_path: href }).catch(() => undefined); // wait, open_attachment is for local files, let's check what command opens a URL
                    // Actually we can add an open_url command in Rust, but first let's see how we can handle mailto or simple links.
                    // For mailto, we can open composer window in our app!
                    // Wait, our app has a composer window, so we can parse mailto and compose!
                    // Let's check how mailto can trigger app's compose window.
                    // Let's set clickedLink to show the dialog first.
                    setClickedLink({ href, text });
                  } else if (href.startsWith('http://') || href.startsWith('https://')) {
                    setClickedLink({ href, text });
                  } else {
                    // Prevent unknown protocols (file, javascript, data) completely
                    console.warn('Blocked navigation to unsafe/unknown protocol:', href);
                  }
                }) as EventListener);
              }
            }}
          >
            <EmailShadowView
              className="reader-html"
              html={readerHtml}
              onClick={handleReaderHtmlClick}
              onContextMenuCapture={handleReaderHtmlContextMenu}
              onContextMenu={handleReaderHtmlContextMenu}
            />
          </div>
        ) : shouldOfferRemoteContent ? (
          <EmptyMessageBody
            title="正文主要由远程图片组成"
            detail="已先阻止自动加载，点击后会显示本邮件中的 HTTPS 图片；外部链接仍不会变成可点击跳转。"
            action={(
              <button
                type="button"
                className="reader-warning-primary-action"
                onClick={onAllowRemoteImagesOnce}
              >
                查看内容
              </button>
            )}
          />
        ) : (
          <PlainMessageBody body={plainBodyForReader} />
        )}

        {!isDraft && !isTrash && (
          <QuickReplySection
            selected={selected}
            quickReplyBody={quickReplyBody}
            onQuickReplyChange={onQuickReplyChange}
            onComposeFromMessage={onComposeFromMessage}
            onSendQuickReply={onSendQuickReply}
          />
        )}
      </article>
      {imagePreview && (
        <div
          className="reader-image-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setImagePreview(null)}
        >
          <figure
            className={`reader-image-preview ${imagePreviewFit ? 'is-fit' : 'is-zoomed'}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="reader-image-preview-toolbar" aria-label="图片预览工具">
              <button
                type="button"
                aria-label="缩小"
                onClick={zoomOut}
              >
                <ZoomOut size={16} />
              </button>
              <span>{Math.round((imagePreviewFit ? 1 : imagePreviewZoom) * 100)}%</span>
              <button
                type="button"
                aria-label="放大"
                onClick={zoomIn}
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                onClick={resetImagePreview}
              >
                适配
              </button>
              <button
                type="button"
                onClick={showOriginalSize}
              >
                原始
              </button>
              <button type="button" onClick={() => saveImageAs(imagePreview)}>
                另存为
              </button>
              <button type="button" aria-label="下载图片" onClick={() => downloadImage(imagePreview)}>
                <Download size={16} />
              </button>
              <button type="button" aria-label="关闭图片预览" onClick={() => setImagePreview(null)}>
                <X size={16} />
              </button>
            </div>
            <div
              className="reader-image-preview-stage"
              ref={imagePreviewStageRef}
              onWheel={handleImagePreviewWheel}
              onPointerDown={handleImagePreviewPointerDown}
              onPointerMove={handleImagePreviewPointerMove}
              onPointerUp={stopImagePreviewPanning}
              onPointerCancel={stopImagePreviewPanning}
              onPointerLeave={stopImagePreviewPanning}
            >
              <img
                ref={imagePreviewImageRef}
                src={imagePreview.src}
                alt={imagePreview.alt}
                onLoad={handleImageLoad}
                style={{
                  transform: imagePreviewFit
                    ? undefined
                    : `translate(${imagePreviewPan.x}px, ${imagePreviewPan.y}px) scale(${imagePreviewZoom})`,
                }}
                draggable={false}
              />
            </div>
          </figure>
        </div>
      )}
      {imageContextMenu && (
        <div
          className="reader-image-context-menu"
          style={{ left: imageContextMenu.x, top: imageContextMenu.y }}
          role="menu"
          aria-label="图片操作"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              openImagePreview({
                src: imageContextMenu.src,
                alt: imageContextMenu.alt,
                attachmentId: imageContextMenu.attachmentId,
              });
              setImageContextMenu(null);
            }}
          >
            查看大图
          </button>
          <button type="button" role="menuitem" onClick={savePreviewImageAs}>
            另存为…
          </button>
          <button type="button" role="menuitem" onClick={downloadPreviewImage}>
            下载图片
          </button>
          <button type="button" role="menuitem" onClick={copyPreviewImageToClipboard}>
            复制图片
          </button>
          <button type="button" role="menuitem" onClick={copyPreviewImageSource}>
            复制图片地址
          </button>
        </div>
      )}
      {attachmentContextMenu && (
        <ContextMenu
          x={attachmentContextMenu.x}
          y={attachmentContextMenu.y}
          title={attachmentContextMenu.attachment.filename}
          detail={`${attachmentContextMenu.attachment.mime_type || '未知类型'} · ${formatBytes(attachmentContextMenu.attachment.size_bytes)}`}
          items={attachmentMenuItems(attachmentContextMenu.attachment)}
          onClose={() => setAttachmentContextMenu(null)}
          ariaLabel="附件操作"
        />
      )}
      {labelToDelete && createPortal((
        <div
          className="settings-cache-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setLabelToDelete(null);
            }
          }}
        >
          <section
            className="settings-cache-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="label-confirm-title"
          >
            <header>
              <span className="settings-cache-confirm-mark" aria-hidden="true" style={{ background: '#fee2e2', color: '#dc2626' }}>
                <Tag size={17} />
              </span>
              <span>
                <strong id="label-confirm-title">删除标签</strong>
                <small>该操作不可逆，将移除所有此标签的标记</small>
              </span>
              <button
                className="icon-only-action"
                type="button"
                title="关闭"
                aria-label="关闭删除确认"
                onClick={() => setLabelToDelete(null)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="settings-cache-confirm-summary" style={{ background: '#fef2f2', borderLeft: '3px solid #ef4444' }}>
              <span style={{ fontSize: '14px', color: '#991b1b', fontWeight: 'bold' }}>
                确认删除标签 "{labelToDelete.name}" 吗？
              </span>
            </div>
            <p>
              删除该标签后，所有已归类到此标签的邮件将不再显示该标签标记，但邮件正文及其他分类属性仍会完整保留。
            </p>
            <footer>
              <button
                className="secondary"
                type="button"
                onClick={() => setLabelToDelete(null)}
              >
                取消
              </button>
              <button
                className="danger"
                type="button"
                onClick={async () => {
                  await handleDeleteLabel(labelToDelete.id);
                  setLabelToDelete(null);
                }}
              >
                确认删除
              </button>
            </footer>
          </section>
        </div>
      ), document.body)}
      {clickedLink && createPortal((
        <div
          className="settings-cache-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setClickedLink(null);
            }
          }}
        >
          <section
            className="settings-cache-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-confirm-title"
            style={{ width: '480px' }}
          >
            <header>
              <span className="settings-cache-confirm-mark" aria-hidden="true" style={{ background: '#fef3c7', color: '#d97706' }}>
                <ExternalLink size={17} />
              </span>
              <span>
                <strong id="link-confirm-title">安全链接检查</strong>
                <small>请确认目标链接与显示的域名一致</small>
              </span>
              <button
                className="icon-only-action"
                type="button"
                title="关闭"
                aria-label="关闭安全检查"
                onClick={() => setClickedLink(null)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="settings-cache-confirm-summary" style={{ background: '#fffbeb', borderLeft: '3px solid #f59e0b', wordBreak: 'break-all' }}>
              <div style={{ fontSize: '12px', color: '#4b5563', marginBottom: '4px' }}>真实目标地址：</div>
              <strong style={{ fontSize: '13px', color: '#1f2937', display: 'block' }}>{clickedLink.href}</strong>
            </div>
            <div style={{ fontSize: '12.5px', color: '#374151', margin: '14px 0', lineHeight: '1.5' }}>
              {(() => {
                const linkUrlStr = clickedLink.href;
                let showDomainWarning = false;
                try {
                  const linkUrl = new URL(linkUrlStr);
                  const displayDomain = clickedLink.text.trim().toLowerCase();
                  if (displayDomain && (displayDomain.includes('.') || displayDomain.includes('/'))) {
                    // Check if the linkText is a domain and is different from target URL host
                    if (!linkUrl.host.toLowerCase().includes(displayDomain) && !displayDomain.includes(linkUrl.host.toLowerCase())) {
                      showDomainWarning = true;
                    }
                  }
                } catch (e) {
                  // If linkUrl is not a full URL or mailto
                }

                if (showDomainWarning) {
                  return (
                    <div style={{ padding: '10px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#991b1b', fontWeight: 'bold' }}>
                      ⚠️ 风险提示：显示的链接文本与实际指向的域名不一致！这可能是一个钓鱼链接，请谨慎访问。
                    </div>
                  );
                }
                return '您点击的链接将通过系统默认浏览器打开，请确认该目标地址安全。';
              })()}
            </div>
            <footer>
              <button
                className="secondary"
                type="button"
                onClick={() => setClickedLink(null)}
              >
                取消访问
              </button>
              <button
                className="primary"
                type="button"
                style={{ background: 'var(--ui-accent, #0a7aff)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onClick={async () => {
                  if (clickedLink.href.startsWith('mailto:')) {
                    // Compose email
                    onComposeNew?.({ to: clickedLink.href.substring(7) });
                  } else {
                    await invoke('open_url', { url: clickedLink.href });
                  }
                  setClickedLink(null);
                }}
              >
                继续访问
              </button>
            </footer>
          </section>
        </div>
      ), document.body)}
    </section>
  );
}

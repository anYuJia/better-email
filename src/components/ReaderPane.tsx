import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Image as ImageIcon,
  Mail,
  MailPlus,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react';
import type {
  AccountScope,
  Attachment,
  Folder,
  Label,
  Message,
  MessageSummary,
  ThreadSummary,
} from '../app/types';
import { formatBytes, formatDate, bodyLooksLikeHtml, htmlHasRenderableContent, htmlHasRemoteVisualContent, isMessageBodyCorrupted, parseMailtoUrl } from '../mailUtils';
import { invoke, localFileAssetUrl } from '../tauriBridge';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import type { BulkMessageAction } from './messageContextMenu';
import useImagePreview, { type PreviewImage, type AttachmentContextMenu } from './reader/useImagePreview';
import useInlineImages from './reader/useInlineImages';
import PlainMessageBody, { EmptyMessageBody } from './reader/PlainMessageBody';
import QuickReplySection from './reader/QuickReplySection';
import { attachmentKind, attachmentIcon } from './reader/attachmentUtils';
import EmailShadowView from './reader/EmailShadowView';
import EmailReaderSkeleton from './EmailReaderSkeleton';
import AttachmentList from './reader/AttachmentList';
import LinkSafetyDialog from './reader/LinkSafetyDialog';
import ReaderLabelMenu from './reader/ReaderLabelMenu';
import ReaderSecurityBanner from './reader/ReaderSecurityBanner';
import ReaderToolbar from './reader/ReaderToolbar';
import ThreadReaderList from './reader/ThreadReaderList';

const readerBodyRenderDelayMs = 0;
const readerBodyRenderIdleTimeoutMs = 50;

type IdleScheduler = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type ComposeMode = 'reply' | 'replyAll' | 'forward';
type TrustScope = 'sender' | 'domain';
type ImageContextMenu = PreviewImage & { x: number; y: number } | null;
type ComposeNewFields = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
};

export type ReaderPaneProps = {
  activeThread: ThreadSummary | null;
  threadMessages: MessageSummary[];
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
  onComposeNew: (fields?: ComposeNewFields) => void;
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

  const [clickedLink, setClickedLink] = useState<{ href: string; text: string } | null>(null);

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
      const assetUrl = await localFileAssetUrl(attachment.local_path);
      openImagePreview({
        src: assetUrl,
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
    return (
      <section className="reader-panel">
        <article className="reader thread-reader">
          <ThreadReaderList
            activeThread={activeThread}
            threadMessages={threadMessages}
            activeThreadSelected={activeThreadSelected}
            selectedId={selectedId}
            folders={folders}
            labels={labels}
            onSelectMessage={onSelectMessage}
            onRunThreadAction={onRunThreadAction}
            onComposeNew={onComposeNew}
            onComposeFromMessage={onComposeFromMessage}
            onMoveThreadToFolder={onMoveThreadToFolder}
            onToggleThreadLabel={onToggleThreadLabel}
            onToggleThreadMute={onToggleThreadMute}
          />
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
        <ReaderToolbar
          selected={selected}
          folders={folders}
          onToggleStar={onToggleStar}
          onEditDraft={onEditDraft}
          onComposeFromMessage={onComposeFromMessage}
          onComposeNew={onComposeNew}
          onRestoreFromTrash={onRestoreFromTrash}
          onMoveArchive={onMoveArchive}
          onToggleRead={onToggleRead}
          onMoveTrash={onMoveTrash}
          onUnsnooze={onUnsnooze}
          onSnooze={onSnooze}
          onExportMessage={onExportMessage}
          onFetchBody={onFetchBody}
          onMarkNotSpam={onMarkNotSpam}
          onMarkAsSpam={onMarkAsSpam}
          onPermanentlyDelete={onPermanentlyDelete}
          onEmptyTrash={onEmptyTrash}
          onMoveToFolder={onMoveToFolder}
        />

        <div className="reader-meta">
          <span>{formatDate(selected.received_at)}</span>
          {accountScope === 'all' && <span>{selected.account_email}</span>}
          {selected.snoozed_until && <span>稍后到 {formatDate(selected.snoozed_until)}</span>}
          {selected.has_attachments && <span>含附件</span>}
        </div>

        <ReaderLabelMenu
          selectedLabels={selected.labels}
          labels={labels}
          onToggleLabel={onToggleLabel}
          onCreateLabel={onCreateLabel}
          onUpdateLabel={onUpdateLabel}
          onDeleteLabel={onDeleteLabel}
        />

        {regularAttachments.length > 0 && (
          <AttachmentList
            attachments={regularAttachments}
            pendingAttachmentCount={pendingAttachmentCount}
            totalSize={regularAttachmentTotalSize}
            downloadingIds={downloadingAttachmentIds}
            errors={attachmentErrors}
            isDownloadingAll={isDownloadingAllAttachments}
            onDownloadAll={handleDownloadAllAttachments}
            onDownload={handleAttachmentDownload}
            onPreview={previewAttachment}
            onOpen={onOpenAttachment}
            onContextMenu={setAttachmentContextMenu}
          />
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

        <ReaderSecurityBanner
          warnings={visibleSecurityWarnings}
          showRemoteImageNote={selectedHasRemoteImageWarning || shouldOfferRemoteContent}
        />

        {!isBodyRenderReady ? (
          showPlaceholder ? (
            <EmailReaderSkeleton />
          ) : null
        ) : hasRenderableHtml ? (
          <div
            className="reader-html-container"
          >
            <EmailShadowView
              className="reader-html"
              html={readerHtml}
              onClick={handleReaderHtmlClick}
              onContextMenuCapture={handleReaderHtmlContextMenu}
              onContextMenu={handleReaderHtmlContextMenu}
              onLinkClick={(href, text) => {
                const lowerHref = href.toLowerCase();
                if (lowerHref.startsWith('mailto:')) {
                  onComposeNew(parseMailtoUrl(href));
                } else if (lowerHref.startsWith('http://') || lowerHref.startsWith('https://')) {
                  setClickedLink({ href, text });
                } else {
                  console.warn('Blocked navigation to unsafe/unknown protocol:', href);
                }
              }}
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

      {clickedLink && (
        <LinkSafetyDialog
          link={clickedLink}
          onClose={() => setClickedLink(null)}
          onComposeNew={onComposeNew}
        />
      )}
    </section>
  );
}

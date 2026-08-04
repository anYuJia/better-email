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
import useReaderAttachments from '../hooks/useReaderAttachments';
import InlineImageNotice from './reader/InlineImageNotice';
import ImagePreviewOverlay from './reader/ImagePreviewOverlay';
import ImageContextMenuOverlay from './reader/ImageContextMenuOverlay';
import useReaderCompletion from '../hooks/useReaderCompletion';
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
  const [clickedLink, setClickedLink] = useState<{ href: string; text: string } | null>(null);
  const {
    readerRef,
    bodySelected,
    isBodyRenderReady,
    showPlaceholder,
    maybeCompleteReading,
  } = useReaderCompletion({
    selected,
    selectedId,
    readTriggerKey,
    onReadComplete,
  });






  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenu>(null);
  const [attachmentContextMenu, setAttachmentContextMenu] = useState<AttachmentContextMenu>(null);




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
    downloadingAttachmentIds,
    attachmentErrors,
    setAttachmentErrors,
    isDownloadingAllAttachments,
    regularAttachments,
    pendingAttachmentCount,
    regularAttachmentTotalSize,
    handleAttachmentDownload,
    handleDownloadAllAttachments,
    previewAttachment,
    revealAttachmentInFinder,
    copyAttachmentToClipboard,
    attachmentMenuItems,
    resetAttachmentState,
  } = useReaderAttachments({
    attachments,
    selectedId,
    onDownloadAttachment,
    onOpenAttachment,
    onSaveAttachmentAs,
    openImagePreview,
  });


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
  const isSelectedBodyCorrupted = Boolean(bodySelected && isMessageBodyCorrupted(bodySelected.body));
  const plainBodyForReader = bodySelected && !bodySelected.sanitized_html.trim() && !selectedBodyLooksLikeHtml && !isSelectedBodyCorrupted
    ? bodySelected.body
    : '';

  useEffect(() => {
    maybeCompleteReading();
  }, [selected?.id, selected?.is_read, isBodyRenderReady, readerHtml, plainBodyForReader]);











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

        <InlineImageNotice
          inlineImageResolution={inlineImageResolution}
          inlineImageError={inlineImageError}
          inlineImageRefreshError={inlineImageRefreshError}
          isDownloadingInlineImages={isDownloadingInlineImages}
          isRefreshingInlineImages={isRefreshingInlineImages}
          onLoadInlineImages={handleLoadInlineImages}
        />



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
        <ImagePreviewOverlay
          imagePreview={imagePreview}
          imagePreviewFit={imagePreviewFit}
          imagePreviewZoom={imagePreviewZoom}
          imagePreviewPan={imagePreviewPan}
          imagePreviewStageRef={imagePreviewStageRef}
          imagePreviewImageRef={imagePreviewImageRef}
          zoomIn={zoomIn}
          zoomOut={zoomOut}
          showOriginalSize={showOriginalSize}
          resetImagePreview={resetImagePreview}
          saveImageAs={saveImageAs}
          downloadImage={downloadImage}
          handleImageLoad={handleImageLoad}
          handleImagePreviewWheel={handleImagePreviewWheel}
          handleImagePreviewPointerDown={handleImagePreviewPointerDown}
          handleImagePreviewPointerMove={handleImagePreviewPointerMove}
          stopImagePreviewPanning={stopImagePreviewPanning}
          onClose={() => setImagePreview(null)}
        />
      )}
      {imageContextMenu && (
        <ImageContextMenuOverlay
          imageContextMenu={imageContextMenu}
          openImagePreview={openImagePreview}
          setImageContextMenu={setImageContextMenu}
          savePreviewImageAs={savePreviewImageAs}
          downloadPreviewImage={downloadPreviewImage}
          copyPreviewImageToClipboard={copyPreviewImageToClipboard}
          copyPreviewImageSource={copyPreviewImageSource}
        />
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

import { lazy, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  ArrowLeft,
} from 'lucide-react';
import type {
  AccountScope,
  OutboxItem,
  Attachment,
  Folder,
  Label,
  Message,
  MessageSummary,
  ThreadSummary,
} from '../app/types';
import { formatBytes, formatDate, bodyLooksLikeHtml, htmlHasRenderableContent, htmlHasRemoteVisualContent, isMessageBodyCorrupted } from '../mailUtils';
import ContextMenu from './ContextMenu';
import type { BulkMessageAction } from './messageContextMenu';
import useImagePreview, { type PreviewImage, type AttachmentContextMenu } from './reader/useImagePreview';
import useInlineImages from './reader/useInlineImages';
import useReaderAttachments from '../hooks/useReaderAttachments';
import InlineImageNotice from './reader/InlineImageNotice';
import ReaderBodyContent from './ReaderBodyContent';
import ImageContextMenuOverlay from './reader/ImageContextMenuOverlay';
import useReaderCompletion from '../hooks/useReaderCompletion';
import useReaderScrollPosition from '../hooks/useReaderScrollPosition';
import useReaderReveal from '../hooks/useReaderReveal';
import QuickReplySection, { type QuickReplyHandle } from './reader/QuickReplySection';
import AttachmentList from './reader/AttachmentList';
import ReaderLabelMenu from './reader/ReaderLabelMenu';
import ReaderSecurityBanner from './reader/ReaderSecurityBanner';
import ReaderToolbar from './reader/ReaderToolbar';
import SenderIdentity from './reader/SenderIdentity';
import ReaderTranslationPanel from './reader/ReaderTranslationPanel';
import useMessageTranslation from '../hooks/useMessageTranslation';
import type { ReaderReplyTarget } from '../hooks/useComposerController';
import type { ReaderBodyFetchState } from '../hooks/useReaderBodyLoading';
import EmailReaderSkeleton, { EmailBodySkeleton } from './EmailReaderSkeleton';
import DeferredSurface from './DeferredSurface';
import ReaderDeliveryStatus from './reader/ReaderDeliveryStatus';
import { EmptyMessageBody } from './reader/PlainMessageBody';
import { MAX_AUTO_RENDER_BODY_LENGTH } from '../app/messageBodyPolicy';
import type { MessageDetailLoadState } from '../hooks/useMailboxSelectionController';
import type { ThreadLoadState } from '../hooks/useMailboxNavigation';
import ThreadReaderPlaceholder from './reader/ThreadReaderPlaceholder';

const ImagePreviewOverlay = lazy(() => import('./reader/ImagePreviewOverlay'));
const ThreadReaderList = lazy(() => import('./reader/ThreadReaderList'));

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
  deliveryStatus?: OutboxItem;
  onResolveDelivery?: (outboxId: number, delivered: boolean) => Promise<void>;
  onCancelDelivery?: (item: OutboxItem) => Promise<void>;
  activeThread: ThreadSummary | null;
  threadLoadState?: ThreadLoadState;
  onRetryThread?: () => void;
  threadMessages: MessageSummary[];
  activeThreadSelected: Message | null;
  selected: Message | null;
  mailboxPending?: boolean;
  mailboxError?: string | null;
  selectedSummary?: MessageSummary | null;
  onRepairCredentials?: (accountId: number) => void;
  selectedId: number | null;
  activeSelectedId: number | null;
  detailLoadState?: MessageDetailLoadState;
  onRetryDetail?: () => void;
  attachmentsLoaded: boolean;
  accountScope: AccountScope;
  folders: Folder[];
  labels: Label[];
  attachments: Attachment[];
  selectedSenderTrusted: boolean;
  selectedSenderDomain: string;
  selectedHasRemoteImageWarning: boolean;
  selectedSenderIsExternal: boolean;
  selectedExternalBlocked: boolean;
  selectedWarnExternalSender: boolean;
  selectedInterceptsHttps: boolean;
  onOpenHttpsLink: (href: string) => void;
  onAiError?: (message: string) => void;
  quickReplyBody: string;
  readerReplyRef?: MutableRefObject<ReaderReplyTarget | null>;
  quickReplyComposerActive?: boolean;
  quickReplySaveError?: string | null;
  onRetryQuickReplySave?: () => void;
  submissionPending?: boolean;
  onSelectMessage: (messageId: number) => void;
  readTriggerKey: number;
  onComposeNew: (fields?: ComposeNewFields) => void;
  onComposeFromMessage: (message: Message, mode: ComposeMode, prefillBody?: string) => void;
  onRunThreadAction: (action: BulkMessageAction) => void;
  onRequestSnooze: (messages: MessageSummary[]) => void;
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
  bodyFetchState?: ReaderBodyFetchState | null;
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
  onRefreshAttachments?: (messageId: number) => Promise<void>;
  onDownloadAttachment: (attachment: Attachment) => void | Promise<Attachment | null | undefined>;
  onSaveAttachmentAs: (attachment: Attachment) => void;
  onQuickReplyChange: (value: string) => void;
  onSendQuickReply: (message: Message) => void;
  onBackToList?: () => void;
  scrollPositions?: Map<string, number>;
};

function NarrowReaderNavigation({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null;
  return (
    <nav className="narrow-reader-navigation" aria-label="阅读导航">
      <button type="button" data-narrow-reader-back onClick={onBack}>
        <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        返回邮件列表
      </button>
    </nav>
  );
}

function ReaderPane({
  deliveryStatus,
  onResolveDelivery,
  onCancelDelivery,
  activeThread,
  threadLoadState = null,
  onRetryThread,
  threadMessages,
  activeThreadSelected,
  selected: providedSelected,
  mailboxPending = false,
  mailboxError = null,
  selectedSummary,
  onRepairCredentials,
  selectedId,
  activeSelectedId,
  detailLoadState = { status: 'idle' },
  onRetryDetail,
  attachmentsLoaded,
  readTriggerKey,
  accountScope,
  folders,
  labels,
  attachments,
  selectedSenderTrusted,
  selectedSenderDomain,
  selectedHasRemoteImageWarning,
  selectedSenderIsExternal,
  selectedExternalBlocked,
  selectedWarnExternalSender,
  selectedInterceptsHttps,
  onOpenHttpsLink,
  onAiError,
  quickReplyBody,
  readerReplyRef,
  quickReplyComposerActive,
  quickReplySaveError,
  onRetryQuickReplySave,
  submissionPending,
  onSelectMessage,
  onComposeNew,
  onComposeFromMessage,
  onRunThreadAction,
  onRequestSnooze,
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
  bodyFetchState = null,
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
  onRefreshAttachments,
  onDownloadAttachment,
  onSaveAttachmentAs,
  onQuickReplyChange,
  onSendQuickReply,
  onBackToList,
  scrollPositions,
}: ReaderPaneProps) {
  const currentThreadLoadState = threadLoadState?.threadKey === activeThread?.thread_key ? threadLoadState : null;
  const threadUnavailable = Boolean(activeThread && (currentThreadLoadState || threadMessages.length === 0));
  const selected = mailboxPending || threadUnavailable ? null : providedSelected;
  const [linksRevealed, setLinksRevealed] = useState(false);
  const quickReplyRef = useRef<QuickReplyHandle>(null);
  const [expandedBody, setExpandedBody] = useState<{ id: number; source: string } | null>(null);
  const selectedBodySource = selected ? selected.body || selected.sanitized_html : '';
  const isBodyExpanded = Boolean(selected && expandedBody?.id === selected.id
    && expandedBody.source === selectedBodySource);
  const requiresExplicitRender = Boolean(selected
    && Math.max(selected.body.length, selected.sanitized_html.length) > MAX_AUTO_RENDER_BODY_LENGTH
    && !isBodyExpanded);
  const invalidBody = useMemo(() => !requiresExplicitRender && Boolean(selected && isMessageBodyCorrupted(selected.body)), [requiresExplicitRender, selected?.body]);
  const activeBodyFetchState: ReaderBodyFetchState | null = bodyFetchState?.messageId === selected?.id ? bodyFetchState
    : selected && invalidBody
      ? { messageId: selected.id, status: 'error', errorKind: 'invalid-content', error: '已保存的正文格式无法解析。邮件和附件仍保留在本机。' } : null;
  const isActiveMessage = Boolean(selected && selected.id === activeSelectedId);
  const canCompleteReading = isActiveMessage && !activeThread && activeBodyFetchState == null;
  useEffect(() => setExpandedBody(null), [selected?.id]);
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
    canRenderBody: !requiresExplicitRender,
    canCompleteReading,
  });






  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenu>(null);
  const [attachmentContextMenu, setAttachmentContextMenu] = useState<AttachmentContextMenu>(null);




  const {
    imagePreview,
    imagePreviewZoom,
    imagePreviewFit,
    imagePreviewPan,
    isImagePreviewPanning,
    imagePreviewLoading,
    imagePreviewError,
    imagePreviewStageRef,
    imagePreviewImageRef,
    openImagePreview,
    openImagePreviewFromContextMenu,
    closeImagePreview,
    restoreImagePreviewFocus,
    resetImagePreview,
    zoomIn,
    zoomOut,
    showOriginalSize,
    handleImageLoad,
    handleImagePreviewError,
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
    attachmentMenuItems,
  } = useReaderAttachments({
    attachments,
    selectedId,
    onDownloadAttachment,
    onOpenAttachment,
    onRefreshAttachments,
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
    selected: requiresExplicitRender ? null : bodySelected,
    attachments: bodySelected && !requiresExplicitRender ? attachments : [],
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
  const hasRenderableHtml = useMemo(() => Boolean(
    !requiresExplicitRender && bodySelected?.sanitized_html.trim()
      && htmlHasRenderableContent(readerHtml),
  ), [requiresExplicitRender, bodySelected?.sanitized_html, readerHtml]);
  const selectedBodyLooksLikeHtml = useMemo(() => !requiresExplicitRender && Boolean(bodySelected && bodyLooksLikeHtml(bodySelected.body)), [requiresExplicitRender, bodySelected?.body]);
  const selectedHasRemoteVisualContent = useMemo(() => !requiresExplicitRender && Boolean(
    bodySelected && htmlHasRemoteVisualContent(bodySelected.body),
  ), [requiresExplicitRender, bodySelected?.body]);
  const shouldOfferRemoteContent = Boolean(
    bodySelected
      && (selectedHasRemoteImageWarning || selectedHasRemoteVisualContent)
      && !hasRenderableHtml
      && bodySelected.body.trim(),
  );
  const isSelectedBodyCorrupted = useMemo(() => !requiresExplicitRender && Boolean(bodySelected && isMessageBodyCorrupted(bodySelected.body)), [requiresExplicitRender, bodySelected?.body]);
  const plainBodyForReader = !requiresExplicitRender && bodySelected && !bodySelected.sanitized_html.trim() && !selectedBodyLooksLikeHtml && !isSelectedBodyCorrupted
    ? bodySelected.body
    : '';
  const selectedHasLinks = useMemo(() => {
    if (!bodySelected || requiresExplicitRender) return false;
    if (/href\s*=\s*["']https?:\/\//i.test(bodySelected.sanitized_html)) return true;
    return /https?:\/\/[^\s"'<>]+/i.test(bodySelected.body);
  }, [requiresExplicitRender, bodySelected?.sanitized_html, bodySelected?.body]);
  const linksHidden = Boolean(selectedInterceptsHttps && !linksRevealed);

  useEffect(() => {
    setLinksRevealed(false);
  }, [selectedId]);
  // 正文真正渲染出来、且展示的就是当前选中的邮件时才显示快速回复框：
  // 切换加载期间、正文未就绪、附件列表未加载完
  // 或内嵌图片尚未解析完成时都不出现，避免回复框先于内容出现
  // （含"有图片的邮件先出回复框、图片后加载出来"的情况）
  const inlineImagesSettled = Boolean(
    inlineImageResolution.pendingAttachments.length === 0 || inlineImageError,
  );
  // A successfully loaded empty message is still replyable. Loading and failed
  // fetches must not be mistaken for that empty state (including cached reloads).
  const canShowQuickReply = isBodyRenderReady && isActiveMessage && attachmentsLoaded
    && inlineImagesSettled && activeBodyFetchState == null;

  const replyTargetKey = selected && !activeThread && selected.folder_role !== 'drafts' && selected.folder_role !== 'trash' && canShowQuickReply
    ? `${selected.account_id}:${selected.id}` : null;
  useLayoutEffect(() => {
    if (!readerReplyRef || !replyTargetKey) return undefined;
    const target = { key: replyTargetKey, focus: () => quickReplyRef.current?.focus() };
    readerReplyRef.current = target;
    return () => { if (readerReplyRef.current === target) readerReplyRef.current = null; };
  }, [readerReplyRef, replyTargetKey]);

  // Thread summaries remember scroll without participating in the single
  // message's "read to the bottom" completion policy.
  const threadReaderRef = useRef<HTMLElement | null>(null);
  useReaderScrollPosition(
    activeThread ? threadReaderRef : readerRef,
    activeThread ? `thread:${accountScope}:${activeThread.thread_key}`
      : selected ? `${selected.account_id}:${selected.id}` : null,
    activeThread ? !threadUnavailable
      : isBodyRenderReady && attachmentsLoaded && activeBodyFetchState == null,
    scrollPositions,
  );
  useReaderReveal(
    readerRef,
    selected && !activeThread ? `${selected.account_id}:${selected.id}` : null,
    isBodyRenderReady && activeBodyFetchState == null,
  );

  useEffect(() => {
    maybeCompleteReading();
  }, [maybeCompleteReading, readerHtml, plainBodyForReader]);

  const {
    needsTranslation,
    translationState,
    translate: translateMessage,
    toggleTranslation,
  } = useMessageTranslation(requiresExplicitRender ? null : selected, { sourceHtml: readerHtml, onError: onAiError });

  if (mailboxPending) {
    return <section className="reader-panel" aria-busy={!mailboxError}><NarrowReaderNavigation onBack={onBackToList} /><article className="reader">
      {mailboxError ? <EmptyMessageBody title="邮件列表加载失败" detail="请在邮件列表中重试，已缓存的邮件仍保留。" /> : <EmailBodySkeleton />}
    </article></section>;
  }
  if (activeThread) {
    return (
      <section className="reader-panel" ref={threadReaderRef} tabIndex={-1} aria-busy={currentThreadLoadState?.status === 'loading'}>
        <NarrowReaderNavigation onBack={onBackToList} />
        <article className="reader thread-reader">
          {threadUnavailable ? <ThreadReaderPlaceholder thread={activeThread}
            state={currentThreadLoadState?.status ?? 'empty'} onRetry={onRetryThread && (() => {
              threadReaderRef.current?.focus({ preventScroll: true });
              onRetryThread();
            })} /> : <Suspense fallback={<ThreadReaderPlaceholder thread={activeThread} />}>
            <ThreadReaderList
              activeThread={activeThread}
              threadMessages={threadMessages}
              activeThreadSelected={activeThreadSelected}
              selectedId={selectedId}
              folders={folders}
              labels={labels}
              onSelectMessage={onSelectMessage}
              onRunThreadAction={onRunThreadAction}
              onRequestSnooze={onRequestSnooze}
              onComposeFromMessage={onComposeFromMessage}
              onMoveThreadToFolder={onMoveThreadToFolder}
              onToggleThreadLabel={onToggleThreadLabel}
              onToggleThreadMute={onToggleThreadMute}
            />
          </Suspense>}
        </article>
      </section>
    );
  }

  if (!selected) {
    const detailFailed = detailLoadState.status === 'error' && detailLoadState.messageId === activeSelectedId;
    const summary = selectedSummary?.id === activeSelectedId ? selectedSummary : null;
    if (summary) {
      return <section className="reader-panel">
        <NarrowReaderNavigation onBack={onBackToList} />
        <article className="reader">
          <header className="reader-header">
            <h1 className="reader-title-block">{summary.subject || '(无主题)'}</h1>
            <SenderIdentity message={summary} onComposeNew={onComposeNew} />
            <div className="reader-actions-placeholder" aria-hidden="true" />
            <div className="reader-context-row">
              <div className="reader-meta"><time dateTime={summary.received_at}>{formatDate(summary.received_at)}</time></div>
            </div>
          </header>
          {detailFailed ? <EmptyMessageBody role="alert" title="无法加载这封邮件" detail="邮件仍保留在列表中，请重试。"
            action={<button type="button" className="reader-warning-primary-action" onClick={onRetryDetail}>重新加载邮件</button>} /> : <EmailBodySkeleton />}
        </article>
      </section>;
    }
    return (
      <section className="reader-panel">
        <NarrowReaderNavigation onBack={onBackToList} />
        {activeSelectedId && !detailFailed ? <article className="reader" aria-busy="true" aria-label="正在加载邮件"><EmailReaderSkeleton /></article>
          : detailFailed ? <article className="reader"><EmptyMessageBody
            role="alert"
            title="无法加载这封邮件"
            detail="邮件列表仍可使用。请重试，或选择另一封邮件。"
            action={<button type="button" className="reader-warning-primary-action" onClick={onRetryDetail}>重新加载邮件</button>}
          /></article> : <div className="empty-reader">
          <div className="empty-reader-quiet" aria-live="polite"><span>未选择邮件</span></div>
        </div>}
      </section>
    );
  }

  const isDraft = selected.folder_role === 'drafts';
  const isTrash = selected.folder_role === 'trash';

  return (
    <section className="reader-panel" ref={readerRef} onScroll={maybeCompleteReading}>
      <NarrowReaderNavigation onBack={onBackToList} />
      <article className="reader">
        <ReaderToolbar
          selected={selected}
          folders={folders}
          selectedSenderTrusted={selectedSenderTrusted}
          selectedSenderDomain={selectedSenderDomain}
          selectedExternalBlocked={selectedExternalBlocked}
          onTrustRemoteImages={onTrustRemoteImages}
          onBlockSender={onBlockSender}
          needsTranslation={needsTranslation}
          translationActive={translationState.status === 'success' && translationState.showTranslation}
          translationCompleted={translationState.status === 'success'}
          translationLoading={translationState.status === 'translating'}
          onTranslateMessage={translateMessage}
          onToggleTranslation={toggleTranslation}
          onToggleStar={onToggleStar}
          onEditDraft={onEditDraft}
          onComposeNew={onComposeNew}
          onComposeFromMessage={onComposeFromMessage}
          onReply={() => {
            if (readerReplyRef) {
              onComposeFromMessage(selected, 'reply');
              return;
            }
            if (quickReplyRef.current) {
              quickReplyRef.current.focus();
              return;
            }
            // A body still loading (or requiring explicit approval) has no
            // inline editor. Preserve its saved reply in the full composer.
            onComposeFromMessage(selected, 'reply', quickReplyBody);
          }}
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
          metadata={(
            <>
              <div className="reader-meta">
                <time dateTime={selected.received_at}>{formatDate(selected.received_at)}</time>
                {accountScope === 'all' && <span className="reader-account-source" title={`所属账号：${selected.account_email}`}>{selected.account_email}</span>}
                {selected.snoozed_until && <span>稍后到 {formatDate(selected.snoozed_until)}</span>}
              </div>
              <ReaderLabelMenu
                selectedLabels={selected.labels}
                labels={labels}
                onToggleLabel={onToggleLabel}
                onCreateLabel={onCreateLabel}
                onUpdateLabel={onUpdateLabel}
                onDeleteLabel={onDeleteLabel}
              />
            </>
          )}
        />

        {deliveryStatus?.message_id === selected.id && <ReaderDeliveryStatus key={deliveryStatus.id} item={deliveryStatus} onResolve={onResolveDelivery} onCancel={onCancelDelivery} onRepairCredentials={onRepairCredentials ? () => onRepairCredentials(selected.account_id) : undefined} />}

        {regularAttachments.length > 0 && (
          <AttachmentList
            key={`attachments:${selected.account_id}:${selected.id}`}
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
          hasRenderableHtml={hasRenderableHtml}
          selectedSenderTrusted={selectedSenderTrusted}
          selectedSenderDomain={selectedSenderDomain}
          selectedSenderIsExternal={selectedSenderIsExternal}
          selectedExternalBlocked={selectedExternalBlocked}
          selectedWarnExternalSender={selectedWarnExternalSender}
          showLinkAction={Boolean(selectedInterceptsHttps && selectedHasLinks)}
          linkActionLabel={linksRevealed ? '隐藏链接' : '查看链接'}
          onLinkAction={() => setLinksRevealed((current) => !current)}
          onAllowRemoteImagesOnce={onAllowRemoteImagesOnce}
          onTrustSender={() => onTrustRemoteImages('sender')}
          onTrustDomain={() => onTrustRemoteImages('domain')}
        />

        {requiresExplicitRender && !activeBodyFetchState ? (
          <EmptyMessageBody
            title="这封邮件较大，尚未渲染完整内容"
            detail="正文完整保存在本机。按需加载可以保持阅读与切换流畅。"
            action={<button type="button" className="reader-warning-primary-action" onClick={() => setExpandedBody({ id: selected.id, source: selectedBodySource })}>加载完整邮件</button>}
          />
        ) : <ReaderBodyContent
          largeBodyApproved={isBodyExpanded}
          isBodyRenderReady={isBodyRenderReady}
          showPlaceholder={showPlaceholder}
          hasRenderableHtml={hasRenderableHtml}
          shouldOfferRemoteContent={shouldOfferRemoteContent}
          readerHtml={readerHtml}
          plainBodyForReader={plainBodyForReader}
          linksHidden={linksHidden}
          handleReaderHtmlClick={handleReaderHtmlClick}
          handleReaderHtmlContextMenu={handleReaderHtmlContextMenu}
          onAllowRemoteImagesOnce={onAllowRemoteImagesOnce}
          onOpenLink={onOpenHttpsLink}
          onComposeNew={onComposeNew}
          translation={translationState.status === 'success' && translationState.showTranslation
            ? {
              format: translationState.format,
              content: translationState.translation,
            }
            : null}
          bodyFetchStatus={activeBodyFetchState?.status ?? null}
          bodyFetchError={activeBodyFetchState?.error ?? null}
          bodyErrorKind={activeBodyFetchState?.errorKind}
          onRepairCredentials={onRepairCredentials ? () => onRepairCredentials(selected.account_id) : undefined}
          onExportMessage={onExportMessage}
          onRetryBodyFetch={selected.remote_uid > 0 ? () => onFetchBody(false) : undefined}
        />}

        <ReaderTranslationPanel
          state={translationState}
          needsTranslation={needsTranslation}
          onToggle={toggleTranslation}
        />



        {!isDraft && !isTrash && canShowQuickReply && (
          <QuickReplySection
            key={`quick-reply:${selected.account_id}:${selected.id}`}
            ref={quickReplyRef}
            submissionPending={submissionPending}
            saveError={quickReplySaveError}
            onRetrySave={onRetryQuickReplySave}
            selected={selected}
            quickReplyBody={quickReplyBody}
            continuingInComposer={quickReplyComposerActive}
            onQuickReplyChange={onQuickReplyChange}
            onComposeFromMessage={onComposeFromMessage}
            onSendQuickReply={onSendQuickReply}
          />
        )}
      </article>
      {imagePreview && (
        <Suspense fallback={<DeferredSurface label="正在打开图片预览" />}>
          <ImagePreviewOverlay
            imagePreview={imagePreview}
            imagePreviewFit={imagePreviewFit}
            imagePreviewZoom={imagePreviewZoom}
            imagePreviewPan={imagePreviewPan}
            imagePreviewLoading={imagePreviewLoading}
            imagePreviewError={imagePreviewError}
            imagePreviewStageRef={imagePreviewStageRef}
            imagePreviewImageRef={imagePreviewImageRef}
            zoomIn={zoomIn}
            zoomOut={zoomOut}
            showOriginalSize={showOriginalSize}
            resetImagePreview={resetImagePreview}
            saveImageAs={saveImageAs}
            downloadImage={downloadImage}
            handleImageLoad={handleImageLoad}
            handleImagePreviewError={handleImagePreviewError}
            handleImagePreviewWheel={handleImagePreviewWheel}
            handleImagePreviewPointerDown={handleImagePreviewPointerDown}
            handleImagePreviewPointerMove={handleImagePreviewPointerMove}
            stopImagePreviewPanning={stopImagePreviewPanning}
            isPanning={isImagePreviewPanning}
            onClose={closeImagePreview}
            onBackgroundRestored={restoreImagePreviewFocus}
          />
        </Suspense>
      )}
      {imageContextMenu && (
        <ImageContextMenuOverlay
          imageContextMenu={imageContextMenu}
          openImagePreview={openImagePreviewFromContextMenu}
          setImageContextMenu={setImageContextMenu}
          savePreviewImageAs={savePreviewImageAs}
          downloadPreviewImage={downloadPreviewImage}
          copyPreviewImageToClipboard={copyPreviewImageToClipboard}
          copyPreviewImageSource={copyPreviewImageSource}
        />
      )}
      <ContextMenu menu={attachmentContextMenu ? {
        targetKey: attachmentContextMenu.attachment.id,
        x: attachmentContextMenu.x,
        y: attachmentContextMenu.y,
        title: attachmentContextMenu.attachment.filename,
        detail: `${attachmentContextMenu.attachment.mime_type || '未知类型'} · ${formatBytes(attachmentContextMenu.attachment.size_bytes)}`,
        items: attachmentMenuItems(attachmentContextMenu.attachment),
        onClose: () => setAttachmentContextMenu(null),
        ariaLabel: '附件操作',
      } : null} />
    </section>
  );
}

export default memo(ReaderPane);

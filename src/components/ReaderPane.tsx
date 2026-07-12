import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { resolveCidInlineImages } from '../app/inlineImages';
import { canSnoozeRole } from '../app/snooze';
import type {
  AccountScope,
  Attachment,
  Folder,
  Label,
  Message,
  ThreadSummary,
} from '../app/types';
import { formatBytes, formatDate } from '../mailUtils';
import { invoke, localFileAssetUrl } from '../tauriBridge';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import type { BulkMessageAction } from './messageContextMenu';

type ComposeMode = 'reply' | 'replyAll' | 'forward';
type TrustScope = 'sender' | 'domain';
type ImageContextMenu = PreviewImage & { x: number; y: number } | null;
type PreviewImage = { src: string; alt: string; attachmentId: number | null };
type AttachmentContextMenu = { attachment: Attachment; x: number; y: number } | null;
const IMAGE_PREVIEW_MIN_ZOOM = 0.25;
const IMAGE_PREVIEW_MAX_ZOOM = 8;
const IMAGE_PREVIEW_BUTTON_ZOOM_STEP = 0.04;
const IMAGE_PREVIEW_WHEEL_ZOOM_STEP = 0.025;
const IMAGE_PREVIEW_KEYBOARD_PAN_STEP = 18;
const IMAGE_PREVIEW_WHEEL_PAN_RATIO = 0.72;
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
  onComposeNew: () => void;
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
  onUnsnooze: () => void;
  onSnooze: () => void;
  onExportMessage: () => void;
  onFetchBody: () => void | Promise<void>;
  onMarkNotSpam: () => void;
  onMarkAsSpam: () => void;
  onAllowRemoteImagesOnce: () => void;
  onTrustRemoteImages: (scope: TrustScope) => void;
  onBlockSender: () => void;
  onPermanentlyDelete: () => void;
  onEmptyTrash: () => void;
  onMoveToFolder: (folder: Folder) => void;
  onToggleLabel: (label: Label) => void;
  onOpenAttachment: (attachment: Attachment) => void;
  onDownloadAttachment: (attachment: Attachment) => void | Promise<void>;
  onSaveAttachmentAs: (attachment: Attachment) => void;
  onQuickReplyChange: (value: string) => void;
  onSendQuickReply: (message: Message) => void;
};

function senderInitial(message: Message) {
  return (message.sender_name || message.sender_email || '?').trim().slice(0, 1).toUpperCase();
}

function attachmentErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, '').trim() || '附件下载失败，请重试。';
}

function SenderIdentity({ message }: { message: Message }) {
  return (
    <div className="reader-sender">
      <span className={`reader-avatar avatar-tone-${Math.abs(message.id) % 6}`} aria-hidden="true">
        {senderInitial(message)}
      </span>
      <span className="reader-sender-copy">
        <strong>{message.sender_name || message.sender_email}</strong>
        <span>
          {message.sender_email}
          {message.recipients ? ` 发给 ${message.recipients}` : ''}
        </span>
      </span>
    </div>
  );
}

const originalMessageMarkerPattern = /^\s*-{2,}\s*(?:原始邮件|original message|forwarded message)\s*-{2,}\s*$/i;
const originalMessageMetaPattern = /^\s*(?:发件人|收件人|抄送|时间|日期|主题|from|to|cc|date|subject)\s*[:：]/i;

function stripQuotePrefix(line: string) {
  return line.replace(/^\s*(?:>\s*)+/, '').trimEnd();
}

function formatPlainTextContent(lines: string[]) {
  return lines
    .map((line) => stripQuotePrefix(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parsePlainBody(body: string): PlainBodyBlock[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: PlainBodyBlock[] = [];
  let textBuffer: string[] = [];
  let originalIndex = 0;

  const flushText = () => {
    const content = textBuffer.join('\n').trim();
    if (content) blocks.push({ type: 'text', content });
    textBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!originalMessageMarkerPattern.test(line)) {
      textBuffer.push(line);
      continue;
    }

    flushText();
    originalIndex += 1;

    const meta: string[] = [];
    const content: string[] = [];
    let sawContent = false;

    index += 1;
    for (; index < lines.length; index += 1) {
      const nextLine = lines[index];
      if (originalMessageMarkerPattern.test(nextLine)) {
        index -= 1;
        break;
      }
      if (!sawContent && originalMessageMetaPattern.test(nextLine)) {
        meta.push(nextLine.trim());
        continue;
      }
      if (!sawContent && !nextLine.trim()) {
        continue;
      }
      sawContent = true;
      content.push(nextLine);
    }

    blocks.push({
      type: 'original',
      index: originalIndex,
      meta,
      content: formatPlainTextContent(content),
    });
  }

  flushText();

  if (blocks.length === 0 && body.trim()) {
    return [{ type: 'text', content: body.trim() }];
  }
  return blocks;
}

function PlainMessageBody({ body }: { body: string }) {
  const blocks = useMemo(() => parsePlainBody(body), [body]);
  const originalBlockCount = useMemo(
    () => blocks.filter((item) => item.type === 'original').length,
    [blocks],
  );

  return (
    <div className="body-text">
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <div className="plain-body-copy" key={`text-${index}`}>
              {block.content}
            </div>
          );
        }

        return (
          <section className="original-message-block" key={`original-${block.index}-${index}`}>
            <header>
              <span>原始邮件</span>
              {originalBlockCount > 1 && (
                <small>{block.index}</small>
              )}
            </header>
            {block.meta.length > 0 && (
              <dl>
                {block.meta.map((item) => {
                  const [label, ...valueParts] = item.split(/[:：]/);
                  return (
                    <React.Fragment key={item}>
                      <dt>{label.trim()}</dt>
                      <dd>{valueParts.join(':').trim()}</dd>
                    </React.Fragment>
                  );
                })}
              </dl>
            )}
            {block.content && <pre>{block.content}</pre>}
          </section>
        );
      })}
    </div>
  );
}

export default function ReaderPane({
  activeThread,
  threadMessages,
  activeThreadSelected,
  selected,
  selectedId,
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
  const [isDownloadingInlineImages, setIsDownloadingInlineImages] = useState(false);
  const [isRefreshingInlineImages, setIsRefreshingInlineImages] = useState(false);
  const [inlineImageRefreshError, setInlineImageRefreshError] = useState('');
  const [inlineImageDataUrls, setInlineImageDataUrls] = useState<Record<number, string>>({});
  const [inlineImageAssetUrls, setInlineImageAssetUrls] = useState<Record<number, string>>({});
  const [imagePreview, setImagePreview] = useState<PreviewImage | null>(null);
  const [imagePreviewZoom, setImagePreviewZoom] = useState(1);
  const [imagePreviewFit, setImagePreviewFit] = useState(true);
  const [imagePreviewPan, setImagePreviewPan] = useState({ x: 0, y: 0 });
  const [isImagePreviewPanning, setIsImagePreviewPanning] = useState(false);
  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenu>(null);
  const [attachmentContextMenu, setAttachmentContextMenu] = useState<AttachmentContextMenu>(null);
  const imagePreviewDragRef = useRef<{ x: number; y: number } | null>(null);
  const imagePreviewStageRef = useRef<HTMLDivElement | null>(null);
  const imagePreviewImageRef = useRef<HTMLImageElement | null>(null);
  const inlineImageRefreshAttemptsRef = useRef<Set<number>>(new Set());
  const inlineImageDownloadAttemptsRef = useRef<Set<number>>(new Set());
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
  const inlineImageResolution = useMemo(
    () => resolveCidInlineImages(
      selected?.sanitized_html ?? '',
      attachments,
      (attachment) => inlineImageAssetUrls[attachment.id] ?? inlineImageDataUrls[attachment.id] ?? '',
    ),
    [attachments, inlineImageAssetUrls, inlineImageDataUrls, selected?.sanitized_html],
  );
  const inlineImageError = useMemo(
    () => inlineImageResolution.pendingAttachments
      .map((attachment) => attachmentErrors[attachment.id])
      .find(Boolean) ?? '',
    [attachmentErrors, inlineImageResolution.pendingAttachments],
  );
  const visibleSecurityWarnings = useMemo(
    () => selected?.security_warnings.filter(
      (warning) =>
        warning !== '正文包含外部链接，请核对域名后再访问。' &&
        !(selectedSenderTrusted && warning.includes('远程图片')),
    ) ?? [],
    [selected?.security_warnings, selectedSenderTrusted],
  );

  useEffect(() => {
    setDownloadingAttachmentIds(new Set());
    setAttachmentErrors({});
    setIsDownloadingAllAttachments(false);
    setIsDownloadingInlineImages(false);
    setIsRefreshingInlineImages(false);
    setInlineImageRefreshError('');
    setInlineImageDataUrls({});
    setInlineImageAssetUrls({});
    setImagePreview(null);
    setImagePreviewZoom(1);
    setImagePreviewFit(true);
    setImagePreviewPan({ x: 0, y: 0 });
    setIsImagePreviewPanning(false);
    imagePreviewDragRef.current = null;
    setImageContextMenu(null);
    setAttachmentContextMenu(null);
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    const readyInlineImages = attachments.filter((attachment) =>
      attachment.is_inline
      && attachment.is_downloaded
      && Boolean(attachment.local_path.trim())
      && Boolean(attachment.content_id.trim())
      && !inlineImageDataUrls[attachment.id]
      && !inlineImageAssetUrls[attachment.id]);
    if (readyInlineImages.length === 0) return;

    let cancelled = false;
    Promise.all(
      readyInlineImages.map(async (attachment) => {
        const assetUrl = await localFileAssetUrl(attachment.local_path);
        return [attachment.id, assetUrl] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setInlineImageAssetUrls((current) => {
          const next = { ...current };
          entries.forEach(([attachmentId, assetUrl]) => {
            if (assetUrl.trim()) next[attachmentId] = assetUrl;
          });
          return next;
        });
      })
      .catch((error) => {
        if (!cancelled) setInlineImageRefreshError(attachmentErrorMessage(error));
      });

    return () => {
      cancelled = true;
    };
  }, [attachments, inlineImageAssetUrls, inlineImageDataUrls, selected?.id]);

  useEffect(() => {
    if (!selected) return;
    const readyInlineImages = attachments.filter((attachment) =>
      attachment.is_inline
      && attachment.is_downloaded
      && Boolean(attachment.local_path.trim())
      && Boolean(attachment.content_id.trim())
      && !inlineImageDataUrls[attachment.id]);
    if (readyInlineImages.length === 0) return;

    let cancelled = false;
    readyInlineImages.forEach((attachment) => {
      invoke<string>('read_attachment_data_url', { attachmentId: attachment.id })
        .then((dataUrl) => {
          if (cancelled || !dataUrl.trim()) return;
          setInlineImageDataUrls((current) => ({
            ...current,
            [attachment.id]: dataUrl,
          }));
        })
        .catch((error) => {
          if (cancelled) return;
          setAttachmentErrors((current) => ({
            ...current,
            [attachment.id]: attachmentErrorMessage(error),
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [attachments, inlineImageDataUrls, selected?.id]);

  useEffect(() => {
    if (!selected) return;
    if (inlineImageResolution.missingContentIds.length === 0) return;
    if (inlineImageResolution.pendingAttachments.length > 0) return;
    if (selected.remote_uid <= 0) return;
    if (inlineImageRefreshAttemptsRef.current.has(selected.id)) return;

    inlineImageRefreshAttemptsRef.current.add(selected.id);
    setInlineImageRefreshError('');
    setIsRefreshingInlineImages(true);
    Promise.resolve(onFetchBody())
      .catch((error) => {
        setInlineImageRefreshError(attachmentErrorMessage(error));
      })
      .finally(() => {
        setIsRefreshingInlineImages(false);
      });
  }, [
    inlineImageResolution.missingContentIds.length,
    inlineImageResolution.pendingAttachments.length,
    onFetchBody,
    selected?.id,
    selected?.remote_uid,
  ]);

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

  function attachmentKind(attachment: Attachment) {
    const filename = attachment.filename.toLowerCase();
    const mimeType = attachment.mime_type.toLowerCase();
    if (/\.(ppt|pptx|key)$/i.test(filename)) return 'presentation';
    if (/\.(xls|xlsx|csv|numbers)$/i.test(filename)) return 'spreadsheet';
    if (/\.(doc|docx|rtf|pdf|txt|md|log)$/i.test(filename)) return 'document';
    if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(filename)) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || /\.(zip|rar|7z|tar|gz)$/i.test(filename)) return 'archive';
    if (mimeType.includes('presentation') || /\.(ppt|pptx|key)$/i.test(filename)) return 'presentation';
    if (mimeType.includes('spreadsheet') || /\.(xls|xlsx|csv|numbers)$/i.test(filename)) return 'spreadsheet';
    if (mimeType.includes('pdf') || mimeType.startsWith('text/') || /\.(pdf|txt|md|log|rtf|doc|docx)$/i.test(filename)) return 'document';
    return 'file';
  }

  function attachmentIcon(attachment: Attachment) {
    const kind = attachmentKind(attachment);
    const filename = attachment.filename.toLowerCase();
    if (kind === 'presentation') return <span className="attachment-file-type-mark">PPT</span>;
    if (kind === 'spreadsheet') return <span className="attachment-file-type-mark">XLS</span>;
    if (/\.pdf$/i.test(filename)) return <span className="attachment-file-type-mark">PDF</span>;
    if (/\.(doc|docx|rtf)$/i.test(filename)) return <span className="attachment-file-type-mark">DOC</span>;
    if (kind === 'archive') return <span className="attachment-file-type-mark">ZIP</span>;
    if (kind === 'image') return <FileImage size={15} strokeWidth={1.9} />;
    if (kind === 'audio') return <FileAudio size={15} strokeWidth={1.9} />;
    if (kind === 'video') return <FileVideo size={15} strokeWidth={1.9} />;
    if (kind === 'document') return <FileText size={15} strokeWidth={1.9} />;
    return <File size={15} strokeWidth={1.9} />;
  }

  function attachmentTypeDescription(attachment: Attachment) {
    const filename = attachment.filename.toLowerCase();
    const kind = attachmentKind(attachment);
    if (/\.pdf$/i.test(filename)) return 'PDF 文档';
    if (/\.(ppt|pptx|key)$/i.test(filename)) return 'PowerPoint 演示文稿';
    if (/\.(xls|xlsx|csv|numbers)$/i.test(filename)) return filename.endsWith('.csv') ? 'CSV 表格' : 'Excel 表格';
    if (/\.(doc|docx|rtf)$/i.test(filename)) return 'Word 文档';
    if (/\.(zip|rar|7z|tar|gz)$/i.test(filename)) return '压缩文件';
    if (kind === 'image') return '图片';
    if (kind === 'audio') return '音频';
    if (kind === 'video') return '视频';
    if (kind === 'document') return '文档';
    return '附件';
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

  async function handleLoadInlineImages() {
    if (isDownloadingInlineImages || inlineImageResolution.pendingAttachments.length === 0) {
      return;
    }
    setIsDownloadingInlineImages(true);
    try {
      for (const attachment of inlineImageResolution.pendingAttachments) {
        await handleAttachmentDownload(attachment);
      }
    } finally {
      setIsDownloadingInlineImages(false);
    }
  }

  useEffect(() => {
    if (!selected) return;
    if (inlineImageResolution.pendingAttachments.length === 0) return;
    if (inlineImageError) return;
    if (isDownloadingInlineImages) return;
    if (inlineImageDownloadAttemptsRef.current.has(selected.id)) return;

    inlineImageDownloadAttemptsRef.current.add(selected.id);
    void handleLoadInlineImages();
  }, [
    inlineImageError,
    inlineImageResolution.pendingAttachments.length,
    isDownloadingInlineImages,
    selected?.id,
  ]);

  useEffect(() => {
    if (!imagePreview && !imageContextMenu && !attachmentContextMenu) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setImagePreview(null);
        setImageContextMenu(null);
        setAttachmentContextMenu(null);
      }
      if (!imagePreview) return;
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomImagePreview(IMAGE_PREVIEW_BUTTON_ZOOM_STEP);
      }
      if (event.key === '-') {
        event.preventDefault();
        zoomImagePreview(-IMAGE_PREVIEW_BUTTON_ZOOM_STEP);
      }
      if (event.key === '0') {
        event.preventDefault();
        resetImagePreview();
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        setImagePreviewFit(false);
        updateImagePreviewPan((pan) => ({
          x: pan.x + (
            event.key === 'ArrowLeft'
              ? IMAGE_PREVIEW_KEYBOARD_PAN_STEP
              : event.key === 'ArrowRight'
                ? -IMAGE_PREVIEW_KEYBOARD_PAN_STEP
                : 0
          ),
          y: pan.y + (
            event.key === 'ArrowUp'
              ? IMAGE_PREVIEW_KEYBOARD_PAN_STEP
              : event.key === 'ArrowDown'
                ? -IMAGE_PREVIEW_KEYBOARD_PAN_STEP
                : 0
          ),
        }));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imagePreview, imageContextMenu, attachmentContextMenu]);

  useEffect(() => {
    if (!imageContextMenu) return undefined;

    function closeOnPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('.reader-image-context-menu')) return;
      setImageContextMenu(null);
    }
    function closeOnScroll() {
      setImageContextMenu(null);
    }

    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [imageContextMenu]);

  function imageFromEventTarget(target: EventTarget | null) {
    const imageElement = target instanceof Element ? target.closest('img') : null;
    if (!(imageElement instanceof HTMLImageElement)) return null;
    if (imageElement.dataset.betterEmailInlineCid) return null;
    const src = imageElement.currentSrc || imageElement.src;
    if (!src) return null;
    const attachmentId = Number(imageElement.dataset.betterEmailAttachmentId ?? 0) || null;
    return {
      src,
      alt: imageElement.alt || selected?.subject || '邮件图片',
      attachmentId,
    };
  }

  function handleReaderHtmlClick(event: React.MouseEvent<HTMLDivElement>) {
    const image = imageFromEventTarget(event.target);
    if (!image) return;

    event.preventDefault();
    setImageContextMenu(null);
    openImagePreview(image);
  }

  function handleReaderHtmlContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    const image = imageFromEventTarget(event.target);
    if (!image) return;

    event.preventDefault();
    event.stopPropagation();
    setImageContextMenu({
      ...image,
      x: Math.min(event.clientX, window.innerWidth - 188),
      y: Math.min(event.clientY, window.innerHeight - 132),
    });
  }

  function openImagePreview(image: PreviewImage) {
    setImagePreview(image);
    resetImagePreview();
  }

  function resetImagePreview() {
    setImagePreviewZoom(1);
    setImagePreviewFit(true);
    setImagePreviewPan({ x: 0, y: 0 });
    setIsImagePreviewPanning(false);
    imagePreviewDragRef.current = null;
  }

  function zoomImagePreview(delta: number) {
    setImagePreviewFit(false);
    setImagePreviewZoom((zoom) => {
      const nextZoom = Math.min(
        IMAGE_PREVIEW_MAX_ZOOM,
        Math.max(IMAGE_PREVIEW_MIN_ZOOM, Number((zoom + delta).toFixed(3))),
      );
      setImagePreviewPan((pan) => clampImagePreviewPan(pan, nextZoom));
      return nextZoom;
    });
  }

  function clampImagePreviewPan(
    pan: { x: number; y: number },
    zoom = imagePreviewZoom,
  ) {
    const stage = imagePreviewStageRef.current;
    const image = imagePreviewImageRef.current;
    if (!stage || !image) return pan;

    const baseWidth = image.offsetWidth;
    const baseHeight = image.offsetHeight;
    const stageWidth = stage.clientWidth;
    const stageHeight = stage.clientHeight;
    const maxX = Math.max(0, (baseWidth * zoom - stageWidth) / 2);
    const maxY = Math.max(0, (baseHeight * zoom - stageHeight) / 2);

    return {
      x: Math.min(maxX, Math.max(-maxX, pan.x)),
      y: Math.min(maxY, Math.max(-maxY, pan.y)),
    };
  }

  function updateImagePreviewPan(
    updater: (pan: { x: number; y: number }) => { x: number; y: number },
  ) {
    setImagePreviewPan((pan) => clampImagePreviewPan(updater(pan)));
  }

  function handleImagePreviewWheel(event: React.WheelEvent<HTMLDivElement>) {
    const shouldZoom = event.metaKey || event.ctrlKey;
    if (shouldZoom) {
      event.preventDefault();
      zoomImagePreview(event.deltaY > 0 ? -IMAGE_PREVIEW_WHEEL_ZOOM_STEP : IMAGE_PREVIEW_WHEEL_ZOOM_STEP);
      return;
    }

    if (!imagePreviewFit) {
      event.preventDefault();
      updateImagePreviewPan((pan) => ({
        x: pan.x - event.deltaX * IMAGE_PREVIEW_WHEEL_PAN_RATIO,
        y: pan.y - event.deltaY * IMAGE_PREVIEW_WHEEL_PAN_RATIO,
      }));
    }
  }

  function handleImagePreviewPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    setImagePreviewFit(false);
    setIsImagePreviewPanning(true);
    imagePreviewDragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleImagePreviewPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!isImagePreviewPanning || !imagePreviewDragRef.current) return;
    const previous = imagePreviewDragRef.current;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    imagePreviewDragRef.current = { x: event.clientX, y: event.clientY };
    updateImagePreviewPan((pan) => ({ x: pan.x + dx, y: pan.y + dy }));
  }

  function stopImagePreviewPanning() {
    setIsImagePreviewPanning(false);
    imagePreviewDragRef.current = null;
  }

  function imageDownloadName(image: PreviewImage) {
    const cleanAlt = image.alt.trim().replace(/[\\/:*?"<>|]+/g, '-');
    if (cleanAlt && /\.[a-z0-9]{2,5}$/i.test(cleanAlt)) return cleanAlt;
    if (cleanAlt) return `${cleanAlt}.png`;

    try {
      const pathName = new URL(image.src).pathname.split('/').pop() ?? '';
      const decoded = decodeURIComponent(pathName).replace(/[\\/:*?"<>|]+/g, '-');
      if (decoded && /\.[a-z0-9]{2,5}$/i.test(decoded)) return decoded;
    } catch {
      // Data URLs and local asset URLs can be invalid for URL parsing here.
    }
    return '邮件图片.png';
  }

  function downloadImage(image: PreviewImage) {
    const link = document.createElement('a');
    link.href = image.src;
    link.download = imageDownloadName(image);
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadPreviewImage() {
    if (!imageContextMenu) return;
    downloadImage(imageContextMenu);
    setImageContextMenu(null);
  }

  async function saveImageAs(image: PreviewImage) {
    if (image.attachmentId) {
      await invoke<string>('save_attachment_as', { attachmentId: image.attachmentId });
      return;
    }
    downloadImage(image);
  }

  async function savePreviewImageAs() {
    if (!imageContextMenu) return;
    try {
      await saveImageAs(imageContextMenu);
    } finally {
      setImageContextMenu(null);
    }
  }

  async function copyPreviewImageSource() {
    if (!imageContextMenu) return;
    try {
      await navigator.clipboard?.writeText(imageContextMenu.src);
    } catch {
      // Clipboard access can be unavailable in some WebView contexts.
    } finally {
      setImageContextMenu(null);
    }
  }

  async function copyPreviewImageToClipboard() {
    if (!imageContextMenu) return;
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard || typeof ClipboardItem === 'undefined' || !clipboard.write) {
        throw new Error('Clipboard image write is unavailable');
      }

      const response = await fetch(imageContextMenu.src);
      if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
      const blob = await response.blob();
      const mimeType = blob.type || 'image/png';
      await clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
    } catch {
      try {
        await navigator.clipboard?.writeText(imageContextMenu.src);
      } catch {
        // Clipboard access can be unavailable in some WebView contexts.
      }
    } finally {
      setImageContextMenu(null);
    }
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
              <button className="icon-only-action" title="新邮件" aria-label="新邮件" onClick={onComposeNew}>
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
            <button type="button" className="empty-reader-compose" onClick={onComposeNew}>
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
      <article className="reader">
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
                <button className="icon-only-action" title="新邮件" aria-label="新邮件" onClick={onComposeNew}>
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
                  <button onClick={onFetchBody}>拉取正文</button>
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
                      <button onClick={() => onTrustRemoteImages('sender')}>信任该发件人</button>
                    )}
                    {selectedSenderDomain && !selectedSenderTrusted && (
                      <button onClick={() => onTrustRemoteImages('domain')}>信任 {selectedSenderDomain}</button>
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
            <div>
              {labels.map((label) => (
                <button
                  type="button"
                  key={label.id}
                  className={selected.labels.includes(label.name) ? 'active' : ''}
                  onClick={() => onToggleLabel(label)}
                >
                  <span className="label-dot" style={{ background: label.color }} />
                  {label.name}
                </button>
              ))}
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

        {visibleSecurityWarnings.length > 0 && (
          <div className="reader-warning-panel">
            <div className="reader-warning-heading">
              <strong>安全提示</strong>
              {selectedHasRemoteImageWarning && (
                <span>远程图片默认阻止</span>
              )}
            </div>
            {visibleSecurityWarnings.map((warning) => <p key={warning}>{warning}</p>)}
            {selectedHasRemoteImageWarning && (
              <div className="reader-warning-action-row">
                <button
                  type="button"
                  className="reader-warning-primary-action"
                  onClick={onAllowRemoteImagesOnce}
                >
                  允许查看本邮件
                </button>
                <details className="compact-menu reader-warning-actions">
                  <summary><SlidersHorizontal size={15} /> 更多</summary>
                  <div>
                    <button type="button" onClick={() => onTrustRemoteImages('sender')}>信任该发件人</button>
                    {selectedSenderDomain && (
                      <button type="button" onClick={() => onTrustRemoteImages('domain')}>
                        信任 {selectedSenderDomain}
                      </button>
                    )}
                    <button type="button" onClick={onBlockSender}>阻止该发件人</button>
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {selected.sanitized_html ? (
          <div
            className="reader-html"
            onClick={handleReaderHtmlClick}
            onContextMenuCapture={handleReaderHtmlContextMenu}
            onContextMenu={handleReaderHtmlContextMenu}
            dangerouslySetInnerHTML={{ __html: inlineImageResolution.html }}
          />
        ) : (
          <PlainMessageBody body={selected.body} />
        )}

        {!isDraft && !isTrash && (
          <section className="quick-reply" aria-label="快速回复">
            <header>
              <div>
                <strong>回复</strong>
                <span>发给 {selected.sender_name || selected.sender_email}</span>
              </div>
              <Reply size={16} />
            </header>
            <textarea
              value={quickReplyBody}
              onChange={(event) => onQuickReplyChange(event.target.value)}
              placeholder="输入回复"
            />
            <footer>
              <span>{quickReplyBody.trim() ? `${quickReplyBody.trim().length} 字` : ''}</span>
              <div>
                <button type="button" onClick={() => onComposeFromMessage(selected, 'reply')}>写信窗口</button>
                <button type="button" onClick={() => onQuickReplyChange('')} disabled={!quickReplyBody.trim()}>
                  清空
                </button>
                <button className="quick-reply-send" type="button" onClick={() => onSendQuickReply(selected)} disabled={!quickReplyBody.trim()}>
                  发送回复
                </button>
              </div>
            </footer>
          </section>
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
                onClick={() => zoomImagePreview(-IMAGE_PREVIEW_BUTTON_ZOOM_STEP)}
              >
                <ZoomOut size={16} />
              </button>
              <span>{Math.round((imagePreviewFit ? 1 : imagePreviewZoom) * 100)}%</span>
              <button
                type="button"
                aria-label="放大"
                onClick={() => zoomImagePreview(IMAGE_PREVIEW_BUTTON_ZOOM_STEP)}
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
                onClick={() => {
                  setImagePreviewZoom(1);
                  setImagePreviewFit(false);
                  setImagePreviewPan({ x: 0, y: 0 });
                }}
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
                onLoad={() => setImagePreviewPan((pan) => clampImagePreviewPan(pan))}
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
    </section>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { Copy, Download, ExternalLink, FolderOpen, ImageIcon } from 'lucide-react';
import type { Attachment } from '../app/types';
import { attachmentKind } from '../components/reader/attachmentUtils';
import { attachmentErrorMessage } from '../components/reader/useInlineImages';
import type { PreviewImage } from '../components/reader/useImagePreview';
import type { ContextMenuItem } from '../components/ContextMenu';
import { localFileAssetUrl, invoke } from '../tauriBridge';

type ReaderAttachmentsOptions = {
  attachments: Attachment[];
  selectedId: number | null;
  onDownloadAttachment: (attachment: Attachment) => void | Promise<void>;
  onOpenAttachment: (attachment: Attachment) => void;
  onSaveAttachmentAs: (attachment: Attachment) => void;
  openImagePreview: (image: PreviewImage) => void;
};

export default function useReaderAttachments({
  attachments,
  selectedId,
  onDownloadAttachment,
  onOpenAttachment,
  onSaveAttachmentAs,
  openImagePreview,
}: ReaderAttachmentsOptions) {
  const [downloadingAttachmentIds, setDownloadingAttachmentIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [isDownloadingAllAttachments, setIsDownloadingAllAttachments] = useState(false);

  const handleAttachmentDownload = useCallback(async (attachment: Attachment): Promise<boolean> => {
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
  }, [downloadingAttachmentIds, onDownloadAttachment]);

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

  const handleDownloadAllAttachments = useCallback(async () => {
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
  }, [isDownloadingAllAttachments, regularAttachments, handleAttachmentDownload]);

  const previewAttachment = useCallback(async (attachment: Attachment) => {
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
  }, [handleAttachmentDownload, onOpenAttachment, openImagePreview]);

  const revealAttachmentInFinder = useCallback(async (attachment: Attachment) => {
    if (!attachment.is_downloaded) {
      const downloaded = await handleAttachmentDownload(attachment);
      if (!downloaded) return;
    }
    await invoke<string>('reveal_attachment_in_finder', { attachmentId: attachment.id });
  }, [handleAttachmentDownload]);

  const copyAttachmentToClipboard = useCallback(async (attachment: Attachment) => {
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
  }, [handleAttachmentDownload]);

  const attachmentMenuItems = useCallback((attachment: Attachment): ContextMenuItem[] => {
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
  }, [
    downloadingAttachmentIds,
    onOpenAttachment,
    onSaveAttachmentAs,
    previewAttachment,
    revealAttachmentInFinder,
    handleAttachmentDownload,
    copyAttachmentToClipboard,
  ]);

  function resetAttachmentState() {
    setDownloadingAttachmentIds(new Set());
    setAttachmentErrors({});
    setIsDownloadingAllAttachments(false);
  }

  return {
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
  };
}

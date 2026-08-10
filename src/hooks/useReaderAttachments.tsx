import { useCallback, useMemo, useState } from 'react';
import { Copy, Download, ExternalLink, FolderOpen, ImageIcon } from 'lucide-react';
import type { Attachment } from '../app/types';
import { attachmentKind } from '../components/reader/attachmentUtils';
import { attachmentErrorMessage } from '../components/reader/useInlineImages';
import type { PreviewImage } from '../components/reader/useImagePreview';
import type { ContextMenuItem } from '../components/ContextMenu';
import { localFileAssetUrl, invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type ReaderAttachmentsOptions = {
  attachments: Attachment[];
  selectedId: number | null;
  onDownloadAttachment: (attachment: Attachment) => void | Promise<Attachment | null | undefined>;
  onOpenAttachment: (attachment: Attachment) => void;
  onSaveAttachmentAs: (attachment: Attachment) => void;
  openImagePreview: (image: PreviewImage, trigger?: Element | null) => void;
};

export default function useReaderAttachments({
  attachments,
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

  const handleAttachmentDownload = useCallback(
    async (attachment: Attachment): Promise<Attachment | null> => {
      if (downloadingAttachmentIds.has(attachment.id)) return null;
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
        // 下载接口返回持久化后的新附件（local_path 等字段已经更新）。
        const fresh = await onDownloadAttachment(attachment);
        return fresh instanceof Object && fresh !== null ? fresh : null;
      } catch (error) {
        setAttachmentErrors((current) => ({
          ...current,
          [attachment.id]: attachmentErrorMessage(error),
        }));
        return null;
      } finally {
        setDownloadingAttachmentIds((current) => {
          const next = new Set(current);
          next.delete(attachment.id);
          return next;
        });
      }
    },
    [downloadingAttachmentIds, onDownloadAttachment],
  );

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

  const previewAttachment = useCallback(async (
    attachment: Attachment,
    trigger?: HTMLElement | null,
  ) => {
    // 未下载的图片附件：先下载，再用下载接口返回的新附件生成资源地址，
    // 绝不使用下载前为空（或过期）的 local_path。
    let current = attachment;
    if (!current.is_downloaded) {
      const downloaded = await handleAttachmentDownload(current);
      if (!downloaded) return;
      current = downloaded;
    }
    if (attachmentKind(current) === 'image') {
      try {
        const assetUrl = await localFileAssetUrl(current.local_path);
        if (!assetUrl.trim()) {
          throw new Error('附件本地文件不可用，请重新下载后再试。');
        }
        openImagePreview({
          src: assetUrl,
          alt: current.filename,
          attachmentId: current.id,
        }, trigger ?? null);
      } catch (error) {
        // 预览按钮会吞掉 rejected Promise，错误必须写入附件行，不能静默失败。
        setAttachmentErrors((currentErrors) => ({
          ...currentErrors,
          [current.id]: attachmentErrorMessage(error) || '无法生成附件预览地址，请重新下载后再试。',
        }));
      }
      return;
    }
    onOpenAttachment(current);
  }, [handleAttachmentDownload, onOpenAttachment, openImagePreview]);

  const revealAttachmentInFinder = useCallback(async (attachment: Attachment) => {
    if (!attachment.is_downloaded) {
      const downloaded = await handleAttachmentDownload(attachment);
      if (!downloaded) return;
    }
    await invoke<string>(IPC.RevealAttachmentInFinder, { attachmentId: attachment.id });
  }, [handleAttachmentDownload]);

  const copyAttachmentToClipboard = useCallback(async (attachment: Attachment) => {
    if (!attachment.is_downloaded) {
      const downloaded = await handleAttachmentDownload(attachment);
      if (!downloaded) return;
    }

    try {
      await invoke<string>(IPC.CopyAttachmentFileToClipboard, { attachmentId: attachment.id });
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

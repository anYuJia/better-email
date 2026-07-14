import { useState, useRef, useEffect, useMemo, useCallback, Dispatch, SetStateAction } from 'react';
import { resolveCidInlineImages } from '../../app/inlineImages';
import { localFileAssetUrl, invoke } from '../../tauriBridge';
import type { Message, Attachment } from '../../app/types';

function attachmentErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, '').trim() || '附件下载失败，请重试。';
}

type UseInlineImagesOptions = {
  selected: Message | null;
  attachments: Attachment[];
  attachmentErrors: Record<number, string>;
  setAttachmentErrors: Dispatch<SetStateAction<Record<number, string>>>;
  onFetchBody: () => void | Promise<void>;
  handleAttachmentDownload: (attachment: Attachment) => Promise<boolean>;
};

export default function useInlineImages({
  selected,
  attachments,
  attachmentErrors,
  setAttachmentErrors,
  onFetchBody,
  handleAttachmentDownload,
}: UseInlineImagesOptions) {
  const [inlineImageRefreshError, setInlineImageRefreshError] = useState('');
  const [inlineImageDataUrls, setInlineImageDataUrls] = useState<Record<number, string>>({});
  const [inlineImageAssetUrls, setInlineImageAssetUrls] = useState<Record<number, string>>({});
  const [isDownloadingInlineImages, setIsDownloadingInlineImages] = useState(false);
  const [isRefreshingInlineImages, setIsRefreshingInlineImages] = useState(false);

  const inlineImageRefreshAttemptsRef = useRef<Set<number>>(new Set());
  const inlineImageDownloadAttemptsRef = useRef<Set<number>>(new Set());

  // Reset states on selection change
  useEffect(() => {
    setInlineImageRefreshError('');
    setInlineImageDataUrls({});
    setInlineImageAssetUrls({});
    setIsDownloadingInlineImages(false);
    setIsRefreshingInlineImages(false);
    inlineImageRefreshAttemptsRef.current = new Set();
    inlineImageDownloadAttemptsRef.current = new Set();
  }, [selected?.id]);

  const inlineImageResolution = useMemo(
    () => resolveCidInlineImages(
      selected?.sanitized_html ?? '',
      attachments,
      (attachment) => inlineImageAssetUrls[attachment.id] ?? inlineImageDataUrls[attachment.id] ?? '',
    ),
    [attachments, inlineImageAssetUrls, inlineImageDataUrls, selected?.id],
  );

  const inlineImageError = useMemo(
    () => inlineImageResolution.pendingAttachments
      .map((attachment) => attachmentErrors[attachment.id])
      .filter(Boolean)
      .join('; '),
    [attachmentErrors, inlineImageResolution.pendingAttachments],
  );

  // Effect: Resolve Asset URLs when inline images are downloaded
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

  // Effect: Resolve Data URLs when inline images are downloaded (fallback)
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
  }, [attachments, inlineImageDataUrls, selected?.id, setAttachmentErrors]);

  // Effect: Auto-refresh body if inline images have missing content IDs
  useEffect(() => {
    if (!selected) return;
    if (inlineImageResolution.missingContentIds.length === 0) return;
    if (inlineImageResolution.pendingAttachments.length > 0) return;
    if (selected.remote_uid <= 0) return;
    if (selected.body.trim() || selected.sanitized_html.trim()) return;
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

  const handleLoadInlineImages = useCallback(async () => {
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
  }, [isDownloadingInlineImages, inlineImageResolution.pendingAttachments, handleAttachmentDownload]);

  // Effect: Auto-load inline images when pending
  useEffect(() => {
    if (!selected) return;
    if (inlineImageResolution.pendingAttachments.length === 0) return;
    if (inlineImageError) return;
    if (isDownloadingInlineImages) return;
    if (inlineImageDownloadAttemptsRef.current.has(selected.id)) return;

    inlineImageDownloadAttemptsRef.current.add(selected.id);
    void handleLoadInlineImages();
  }, [
    selected,
    inlineImageError,
    inlineImageResolution.pendingAttachments.length,
    isDownloadingInlineImages,
    handleLoadInlineImages,
  ]);

  return {
    inlineImageResolution,
    inlineImageError,
    inlineImageRefreshError,
    setInlineImageRefreshError,
    isDownloadingInlineImages,
    isRefreshingInlineImages,
    handleLoadInlineImages,
  };
}

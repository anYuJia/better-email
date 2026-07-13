import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '../../tauriBridge';
import type { Message, Attachment } from '../../app/types';

export type PreviewImage = { src: string; alt: string; attachmentId: number | null };
export type AttachmentContextMenu = { attachment: Attachment; x: number; y: number } | null;

const IMAGE_PREVIEW_MIN_ZOOM = 0.25;
const IMAGE_PREVIEW_MAX_ZOOM = 8;
const IMAGE_PREVIEW_BUTTON_ZOOM_STEP = 0.04;
const IMAGE_PREVIEW_WHEEL_ZOOM_STEP = 0.025;
const IMAGE_PREVIEW_KEYBOARD_PAN_STEP = 18;
const IMAGE_PREVIEW_WHEEL_PAN_RATIO = 0.72;

export default function useImagePreview(
  selected: Message | null,
  imageContextMenu: (PreviewImage & { x: number; y: number }) | null,
  setImageContextMenu: React.Dispatch<React.SetStateAction<(PreviewImage & { x: number; y: number }) | null>>,
  attachmentContextMenu: AttachmentContextMenu,
  setAttachmentContextMenu: React.Dispatch<React.SetStateAction<AttachmentContextMenu>>,
) {
  const [imagePreview, setImagePreview] = useState<PreviewImage | null>(null);
  const [imagePreviewZoom, setImagePreviewZoom] = useState(1);
  const [imagePreviewFit, setImagePreviewFit] = useState(true);
  const [imagePreviewPan, setImagePreviewPan] = useState({ x: 0, y: 0 });
  const [isImagePreviewPanning, setIsImagePreviewPanning] = useState(false);

  const imagePreviewDragRef = useRef<{ x: number; y: number } | null>(null);
  const imagePreviewStageRef = useRef<HTMLDivElement | null>(null);
  const imagePreviewImageRef = useRef<HTMLImageElement | null>(null);

  const resetImagePreview = useCallback(() => {
    setImagePreviewZoom(1);
    setImagePreviewFit(true);
    setImagePreviewPan({ x: 0, y: 0 });
    setIsImagePreviewPanning(false);
    imagePreviewDragRef.current = null;
  }, []);

  const openImagePreview = useCallback((image: PreviewImage) => {
    setImagePreview(image);
    resetImagePreview();
  }, [resetImagePreview]);

  const clampImagePreviewPan = useCallback((
    pan: { x: number; y: number },
    zoom = imagePreviewZoom,
  ) => {
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
  }, [imagePreviewZoom]);

  const updateImagePreviewPan = useCallback((
    updater: (pan: { x: number; y: number }) => { x: number; y: number },
  ) => {
    setImagePreviewPan((pan) => clampImagePreviewPan(updater(pan)));
  }, [clampImagePreviewPan]);

  const zoomImagePreview = useCallback((delta: number) => {
    setImagePreviewFit(false);
    setImagePreviewZoom((zoom) => {
      const nextZoom = Math.min(
        IMAGE_PREVIEW_MAX_ZOOM,
        Math.max(IMAGE_PREVIEW_MIN_ZOOM, Number((zoom + delta).toFixed(3))),
      );
      setImagePreviewPan((pan) => clampImagePreviewPan(pan, nextZoom));
      return nextZoom;
    });
  }, [clampImagePreviewPan]);

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
  }, [
    imagePreview,
    imageContextMenu,
    attachmentContextMenu,
    zoomImagePreview,
    resetImagePreview,
    updateImagePreviewPan,
    setImageContextMenu,
    setAttachmentContextMenu,
  ]);

  const handleImagePreviewWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
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
  }, [imagePreviewFit, zoomImagePreview, updateImagePreviewPan]);

  const handleImagePreviewPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    setImagePreviewFit(false);
    setIsImagePreviewPanning(true);
    imagePreviewDragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleImagePreviewPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isImagePreviewPanning || !imagePreviewDragRef.current) return;
    const previous = imagePreviewDragRef.current;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    imagePreviewDragRef.current = { x: event.clientX, y: event.clientY };
    updateImagePreviewPan((pan) => ({ x: pan.x + dx, y: pan.y + dy }));
  }, [isImagePreviewPanning, updateImagePreviewPan]);

  const stopImagePreviewPanning = useCallback(() => {
    setIsImagePreviewPanning(false);
    imagePreviewDragRef.current = null;
  }, []);

  const imageDownloadName = useCallback((image: PreviewImage) => {
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
  }, []);

  const downloadImage = useCallback((image: PreviewImage) => {
    const link = document.createElement('a');
    link.href = image.src;
    link.download = imageDownloadName(image);
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [imageDownloadName]);

  const downloadPreviewImage = useCallback(() => {
    if (!imageContextMenu) return;
    downloadImage(imageContextMenu);
    setImageContextMenu(null);
  }, [imageContextMenu, downloadImage, setImageContextMenu]);

  const saveImageAs = useCallback(async (image: PreviewImage) => {
    if (image.attachmentId) {
      await invoke<string>('save_attachment_as', { attachmentId: image.attachmentId });
      return;
    }
    downloadImage(image);
  }, [downloadImage]);

  const savePreviewImageAs = useCallback(async () => {
    if (!imageContextMenu) return;
    try {
      await saveImageAs(imageContextMenu);
    } finally {
      setImageContextMenu(null);
    }
  }, [imageContextMenu, saveImageAs, setImageContextMenu]);

  const copyPreviewImageSource = useCallback(async () => {
    if (!imageContextMenu) return;
    try {
      await navigator.clipboard?.writeText(imageContextMenu.src);
    } catch {
      // Clipboard access can be unavailable in some WebView contexts.
    } finally {
      setImageContextMenu(null);
    }
  }, [imageContextMenu, setImageContextMenu]);

  const copyPreviewImageToClipboard = useCallback(async () => {
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
  }, [imageContextMenu, setImageContextMenu]);

  const imageFromEventTarget = useCallback((target: EventTarget | null) => {
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
  }, [selected?.subject]);

  const handleReaderHtmlClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const image = imageFromEventTarget(event.target);
    if (!image) return;

    event.preventDefault();
    setImageContextMenu(null);
    openImagePreview(image);
  }, [imageFromEventTarget, openImagePreview, setImageContextMenu]);

  const handleReaderHtmlContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const image = imageFromEventTarget(event.target);
    if (!image) return;

    event.preventDefault();
    event.stopPropagation();
    setImageContextMenu({
      ...image,
      x: Math.min(event.clientX, window.innerWidth - 188),
      y: Math.min(event.clientY, window.innerHeight - 132),
    });
  }, [imageFromEventTarget, setImageContextMenu]);

  const zoomIn = useCallback(() => {
    zoomImagePreview(IMAGE_PREVIEW_BUTTON_ZOOM_STEP);
  }, [zoomImagePreview]);

  const zoomOut = useCallback(() => {
    zoomImagePreview(-IMAGE_PREVIEW_BUTTON_ZOOM_STEP);
  }, [zoomImagePreview]);

  const showOriginalSize = useCallback(() => {
    setImagePreviewZoom(1);
    setImagePreviewFit(false);
    setImagePreviewPan({ x: 0, y: 0 });
  }, []);

  const handleImageLoad = useCallback(() => {
    setImagePreviewPan((pan) => clampImagePreviewPan(pan));
  }, [clampImagePreviewPan]);

  return {
    imagePreview,
    setImagePreview,
    imagePreviewZoom,
    imagePreviewFit,
    imagePreviewPan,
    isImagePreviewPanning,
    imagePreviewStageRef,
    imagePreviewImageRef,
    openImagePreview,
    resetImagePreview,
    zoomImagePreview,
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
  };
}

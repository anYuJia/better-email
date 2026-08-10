import React, { useState, useRef, useEffect, useCallback } from 'react';
import { invoke } from '../../tauriBridge';
import type { Message, Attachment } from '../../app/types';
import { IPC } from '../../ipc/commands';

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
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);

  const imagePreviewDragRef = useRef<{ x: number; y: number } | null>(null);
  const imagePreviewStageRef = useRef<HTMLDivElement | null>(null);
  const imagePreviewImageRef = useRef<HTMLImageElement | null>(null);
  // 关闭后焦点恢复到打开前的图片元素（正文点击的 img）。
  const imagePreviewFocusReturnRef = useRef<HTMLElement | null>(null);
  const imagePreviewCloseRequestedRef = useRef(false);
  // 右键菜单会在打开预览前卸载，不能把菜单项本身当作焦点恢复目标。
  const imageContextMenuFocusReturnRef = useRef<HTMLElement | null>(null);

  const resetImagePreview = useCallback(() => {
    setImagePreviewZoom(1);
    setImagePreviewFit(true);
    setImagePreviewPan({ x: 0, y: 0 });
    setIsImagePreviewPanning(false);
    setImagePreviewLoading(false);
    setImagePreviewError(null);
    imagePreviewDragRef.current = null;
  }, []);

  const restoreImagePreviewFocus = useCallback(() => {
    // React StrictMode 会对 effect 做一次开发期清理，只有真实关闭请求才恢复焦点。
    if (!imagePreviewCloseRequestedRef.current) return;
    imagePreviewCloseRequestedRef.current = false;
    const focusReturn = imagePreviewFocusReturnRef.current;
    imagePreviewFocusReturnRef.current = null;
    if (!focusReturn?.isConnected) return;

    // 邮件正文的 <img> 默认不在 Tab 顺序中。临时提供 programmatic focus，
    // 然后恢复原 attribute，避免留下永久 tabindex="-1" 的 DOM 污染。
    const originalTabIndex = focusReturn.getAttribute('tabindex');
    const needsTemporaryTabIndex = originalTabIndex === null && focusReturn.tabIndex < 0;
    if (needsTemporaryTabIndex) focusReturn.setAttribute('tabindex', '-1');
    focusReturn.focus({ preventScroll: true });
    if (needsTemporaryTabIndex) {
      queueMicrotask(() => {
        if (focusReturn.isConnected && focusReturn.getAttribute('tabindex') === '-1') {
          focusReturn.removeAttribute('tabindex');
        }
      });
    }
  }, []);

  const closeImagePreview = useCallback(() => {
    imagePreviewCloseRequestedRef.current = true;
    setImagePreview(null);
    resetImagePreview();
  }, [resetImagePreview]);

  const openImagePreview = useCallback((image: PreviewImage, focusReturn?: Element | null) => {
    imagePreviewCloseRequestedRef.current = false;
    imagePreviewFocusReturnRef.current = focusReturn instanceof HTMLElement ? focusReturn : null;
    setImagePreview(image);
    resetImagePreview();
    setImagePreviewLoading(true);
  }, [resetImagePreview]);

  const handleImagePreviewError = useCallback(() => {
    setImagePreviewLoading(false);
    setImagePreviewError('图片加载失败：地址无效或附件已不存在，请关闭后重试。');
  }, []);

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
    // 模态期间底层不可交互：全局快捷键（写邮件等）不得穿透。
    if (!imagePreview) return undefined;
    const previousModal = document.body.dataset.imagePreviewModal;
    document.body.dataset.imagePreviewModal = '1';
    return () => {
      if (previousModal === undefined) {
        delete document.body.dataset.imagePreviewModal;
      } else {
        document.body.dataset.imagePreviewModal = previousModal;
      }
    };
  }, [imagePreview]);

  useEffect(() => {
    if (!imagePreview && !imageContextMenu && !attachmentContextMenu) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // 预览/上下文菜单是当前的模态交互。先在捕获阶段消费 Escape，
        // 避免 Settings、ContextMenu 等窗口级监听器同时关闭底层界面。
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeImagePreview();
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

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [
    imagePreview,
    imageContextMenu,
    attachmentContextMenu,
    zoomImagePreview,
    resetImagePreview,
    updateImagePreviewPan,
    closeImagePreview,
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
    try {
      if (image.attachmentId) {
        await invoke<string>(IPC.SaveAttachmentAs, { attachmentId: image.attachmentId });
        return;
      }
      downloadImage(image);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error))
        .replace(/^Error:\s*/i, '')
        .trim();
      // 用户取消系统「另存为」对话框不是失败：保持当前预览不变，不进入错误态。
      if (/已取消|cancelled|canceled/i.test(message)) return;
      setImagePreviewError(message || '图片另存为失败，请重试。');
    }
  }, [downloadImage, setImagePreviewError]);

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
    const target = event.nativeEvent.composedPath ? event.nativeEvent.composedPath()[0] : event.target;
    const imageElement = target instanceof Element ? target.closest('img') : null;
    const image = imageFromEventTarget(target);
    if (!image) return;

    event.preventDefault();
    setImageContextMenu(null);
    openImagePreview(image, imageElement);
  }, [imageFromEventTarget, openImagePreview, setImageContextMenu]);

  const handleReaderHtmlContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.nativeEvent.composedPath ? event.nativeEvent.composedPath()[0] : event.target;
    const imageElement = target instanceof Element ? target.closest('img') : null;
    const image = imageFromEventTarget(target);
    if (!image) return;

    event.preventDefault();
    event.stopPropagation();
    imageContextMenuFocusReturnRef.current = imageElement instanceof HTMLElement ? imageElement : null;
    setImageContextMenu({
      ...image,
      x: Math.min(event.clientX, window.innerWidth - 188),
      y: Math.min(event.clientY, window.innerHeight - 132),
    });
  }, [imageFromEventTarget, setImageContextMenu]);

  const openImagePreviewFromContextMenu = useCallback((image: PreviewImage) => {
    const trigger = imageContextMenuFocusReturnRef.current;
    imageContextMenuFocusReturnRef.current = null;
    openImagePreview(image, trigger);
  }, [openImagePreview]);

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
    setImagePreviewLoading(false);
    setImagePreviewError(null);
    setImagePreviewPan((pan) => clampImagePreviewPan(pan));
  }, [clampImagePreviewPan]);

  return {
    imagePreview,
    setImagePreview,
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
    zoomImagePreview,
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
  };
}

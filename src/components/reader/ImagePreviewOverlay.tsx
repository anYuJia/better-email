import { useEffect, useRef, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { Download, ImageOff, LoaderCircle, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { PreviewImage } from './useImagePreview';

type Pan = { x: number; y: number };

type ImagePreviewOverlayProps = {
  imagePreview: PreviewImage;
  imagePreviewFit: boolean;
  imagePreviewZoom: number;
  imagePreviewPan: Pan;
  isPanning: boolean;
  imagePreviewLoading: boolean;
  imagePreviewError: string | null;
  imagePreviewStageRef: MutableRefObject<HTMLDivElement | null>;
  imagePreviewImageRef: MutableRefObject<HTMLImageElement | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  showOriginalSize: () => void;
  resetImagePreview: () => void;
  saveImageAs: (image: PreviewImage) => Promise<void>;
  downloadImage: (image: PreviewImage) => void;
  handleImageLoad: () => void;
  handleImagePreviewError: () => void;
  handleImagePreviewWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  handleImagePreviewPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleImagePreviewPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  stopImagePreviewPanning: () => void;
  onClose: () => void;
  onBackgroundRestored: () => void;
};

export default function ImagePreviewOverlay({
  imagePreview,
  imagePreviewFit,
  imagePreviewZoom,
  imagePreviewPan,
  isPanning,
  imagePreviewLoading,
  imagePreviewError,
  imagePreviewStageRef,
  imagePreviewImageRef,
  zoomIn,
  zoomOut,
  showOriginalSize,
  resetImagePreview,
  saveImageAs,
  downloadImage,
  handleImageLoad,
  handleImagePreviewError,
  handleImagePreviewWheel,
  handleImagePreviewPointerDown,
  handleImagePreviewPointerMove,
  stopImagePreviewPanning,
  onClose,
  onBackgroundRestored,
}: ImagePreviewOverlayProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const onBackgroundRestoredRef = useRef(onBackgroundRestored);

  useEffect(() => {
    onBackgroundRestoredRef.current = onBackgroundRestored;
  }, [onBackgroundRestored]);

  // 打开后焦点进入弹窗；Escape 由 useImagePreview 的全局监听关闭。
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // 模态期间底层不可交互、快捷键不穿透。
  // 焦点恢复由 useImagePreview.closeImagePreview 负责（恢复到原点击图片）。
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // 模态期间底层应用 inert + aria-hidden，杜绝 Tab 逃逸与阅读器交互。
  // WindowChrome 是 App shell 的直接子节点，不能把 React 管理的节点移到
  // body。只隔离它的兄弟节点，窗口的关闭控件保持原位置、事件委托也不丢失。
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) {
      return () => onBackgroundRestoredRef.current();
    }
    const chromeNode = root.querySelector<HTMLElement>('[data-window-chrome]');
    const backgroundTargets = chromeNode?.parentElement
      ? Array.from(chromeNode.parentElement.children).filter((element) => element !== chromeNode)
      : [root];
    const previousAccessibilityState = new Map<Element, {
      inert: boolean;
      ariaHidden: string | null;
    }>();

    for (const target of backgroundTargets) {
      previousAccessibilityState.set(target, {
        inert: target.hasAttribute('inert'),
        ariaHidden: target.getAttribute('aria-hidden'),
      });
      target.setAttribute('inert', '');
      target.setAttribute('aria-hidden', 'true');
    }

    return () => {
      for (const target of backgroundTargets) {
        const previousState = previousAccessibilityState.get(target);
        if (!previousState) continue;
        if (previousState.inert) {
          target.setAttribute('inert', '');
        } else {
          target.removeAttribute('inert');
        }
        if (previousState.ariaHidden === null) {
          target.removeAttribute('aria-hidden');
        } else {
          target.setAttribute('aria-hidden', previousState.ariaHidden);
        }
      }
      onBackgroundRestoredRef.current();
    };
  }, []);

  // Tab / Shift+Tab 焦点循环：焦点只能在弹窗内的可交互元素之间移动。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const focusableSelector = 'button, [tabindex]:not([tabindex="-1"])';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => (
          !element.hasAttribute('disabled')
          && !element.hidden
          && element.getAttribute('aria-hidden') !== 'true'
        ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // 用 capture 监听 document，确保用户刚操作过窗口关闭按钮时按 Tab 也会
    // 回到预览弹窗，而不是逃到未被 inert 的 WindowChrome。
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const content = (
    <div
      className="reader-image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
    >
      <figure
        ref={dialogRef}
        className={`reader-image-preview ${imagePreviewFit ? 'is-fit' : 'is-zoomed'}${imagePreviewError ? ' has-error' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="reader-image-preview-toolbar" aria-label="图片预览工具">
          <strong className="reader-image-preview-title" title={imagePreview.alt}>
            {imagePreview.alt || '图片预览'}
          </strong>
          <span className="reader-image-preview-toolbar-actions">
            <button
              type="button"
              aria-label="缩小"
              title="缩小"
              onClick={zoomOut}
              disabled={Boolean(imagePreviewError)}
            >
              <ZoomOut size={16} />
            </button>
            <span>{Math.round((imagePreviewFit ? 1 : imagePreviewZoom) * 100)}%</span>
            <button
              type="button"
              aria-label="放大"
              title="放大"
              onClick={zoomIn}
              disabled={Boolean(imagePreviewError)}
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              onClick={resetImagePreview}
              disabled={Boolean(imagePreviewError)}
            >
              适配
            </button>
            <button
              type="button"
              onClick={showOriginalSize}
              disabled={Boolean(imagePreviewError)}
            >
              原始
            </button>
            <button
              type="button"
              onClick={() => { void saveImageAs(imagePreview); }}
              disabled={Boolean(imagePreviewError)}
            >
              另存为
            </button>
            <button
              type="button"
              aria-label="下载图片"
              title="下载图片"
              onClick={() => downloadImage(imagePreview)}
              disabled={Boolean(imagePreviewError)}
            >
              <Download size={16} />
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="reader-image-preview-close"
              aria-label="关闭图片预览"
              title="关闭"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </span>
        </div>
        {imagePreviewError ? (
          <div className="reader-image-preview-error" role="alert">
            <ImageOff size={26} aria-hidden="true" />
            <strong>无法显示这张图片</strong>
            <p>{imagePreviewError}</p>
            <button
              type="button"
              className="reader-image-preview-error-close"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        ) : (
          <div
            className={`reader-image-preview-stage${isPanning ? ' is-panning' : ''}`}
            ref={imagePreviewStageRef}
            onWheel={handleImagePreviewWheel}
            onPointerDown={handleImagePreviewPointerDown}
            onPointerMove={handleImagePreviewPointerMove}
            onPointerUp={stopImagePreviewPanning}
            onPointerCancel={stopImagePreviewPanning}
            onPointerLeave={stopImagePreviewPanning}
          >
            {imagePreviewLoading && (
              <span className="reader-image-preview-loading" aria-live="polite">
                <LoaderCircle className="spinning" size={18} />
                正在加载图片…
              </span>
            )}
            <img
              ref={imagePreviewImageRef}
              src={imagePreview.src}
              alt={imagePreview.alt}
              onLoad={handleImageLoad}
              onError={handleImagePreviewError}
              style={{
                transform: imagePreviewFit
                  ? undefined
                  : `translate(${imagePreviewPan.x}px, ${imagePreviewPan.y}px) scale(${imagePreviewZoom})`,
              }}
              draggable={false}
            />
          </div>
        )}
      </figure>
    </div>
  );

  return createPortal(content, document.body);
}

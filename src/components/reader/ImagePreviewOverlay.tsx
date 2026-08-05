import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { PreviewImage } from './useImagePreview';

type Pan = { x: number; y: number };

type ImagePreviewOverlayProps = {
  imagePreview: PreviewImage;
  imagePreviewFit: boolean;
  imagePreviewZoom: number;
  imagePreviewPan: Pan;
  isPanning: boolean;
  imagePreviewStageRef: MutableRefObject<HTMLDivElement | null>;
  imagePreviewImageRef: MutableRefObject<HTMLImageElement | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  showOriginalSize: () => void;
  resetImagePreview: () => void;
  saveImageAs: (image: PreviewImage) => void;
  downloadImage: (image: PreviewImage) => void;
  handleImageLoad: () => void;
  handleImagePreviewWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  handleImagePreviewPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleImagePreviewPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  stopImagePreviewPanning: () => void;
  onClose: () => void;
};

export default function ImagePreviewOverlay({
  imagePreview,
  imagePreviewFit,
  imagePreviewZoom,
  imagePreviewPan,
  isPanning,
  imagePreviewStageRef,
  imagePreviewImageRef,
  zoomIn,
  zoomOut,
  showOriginalSize,
  resetImagePreview,
  saveImageAs,
  downloadImage,
  handleImageLoad,
  handleImagePreviewWheel,
  handleImagePreviewPointerDown,
  handleImagePreviewPointerMove,
  stopImagePreviewPanning,
  onClose,
}: ImagePreviewOverlayProps) {
  return (
    <div
      className="reader-image-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
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
          <button type="button" aria-label="关闭图片预览" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
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
  );
}

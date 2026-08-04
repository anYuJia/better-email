import type { Dispatch, SetStateAction } from 'react';
import type { PreviewImage } from './useImagePreview';

export type ImageContextMenuState = PreviewImage & { x: number; y: number } | null;

type ImageContextMenuOverlayProps = {
  imageContextMenu: Exclude<ImageContextMenuState, null>;
  openImagePreview: (image: PreviewImage) => void;
  setImageContextMenu: Dispatch<SetStateAction<ImageContextMenuState>>;
  savePreviewImageAs: () => void;
  downloadPreviewImage: () => void;
  copyPreviewImageToClipboard: () => void;
  copyPreviewImageSource: () => void;
};

export default function ImageContextMenuOverlay({
  imageContextMenu,
  openImagePreview,
  setImageContextMenu,
  savePreviewImageAs,
  downloadPreviewImage,
  copyPreviewImageToClipboard,
  copyPreviewImageSource,
}: ImageContextMenuOverlayProps) {
  return (
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
  );
}

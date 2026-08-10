import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import useImagePreview, {
  type AttachmentContextMenu,
  type PreviewImage,
} from './useImagePreview';
import ImagePreviewOverlay from './ImagePreviewOverlay';
import ImageContextMenuOverlay from './ImageContextMenuOverlay';
import type { Message } from '../../app/types';
import { invoke } from '../../tauriBridge';

vi.mock('../../tauriBridge', () => ({
  invoke: vi.fn(),
}));

function noMessage(): Message | null {
  return null;
}

function PreviewHarness({
  initialError = null,
  saveAsFailure = false,
}: { initialError?: string | null; saveAsFailure?: boolean }) {
  const [imageContextMenu, setImageContextMenu] = useState<(PreviewImage & { x: number; y: number }) | null>(null);
  const [attachmentContextMenu, setAttachmentContextMenu] = useState<AttachmentContextMenu>(null);
  const hook = useImagePreview(
    noMessage(),
    imageContextMenu,
    setImageContextMenu,
    attachmentContextMenu,
    setAttachmentContextMenu,
  );
  const image: PreviewImage = {
    src: 'data:image/png;base64,iVBORw0KGgo=',
    alt: '测试图片',
    attachmentId: saveAsFailure ? 42 : null,
  };
  return (
    <div>
      <button
        type="button"
        onClick={(event) => {
          hook.openImagePreview(
            { ...image, src: saveAsFailure ? 'file:///missing.png' : image.src },
            event.currentTarget,
          );
        }}
      >
        打开预览
      </button>
      {hook.imagePreview && (
        <ImagePreviewOverlay
          imagePreview={hook.imagePreview}
          imagePreviewFit={hook.imagePreviewFit}
          imagePreviewZoom={hook.imagePreviewZoom}
          imagePreviewPan={hook.imagePreviewPan}
          imagePreviewLoading={hook.imagePreviewLoading}
          imagePreviewError={hook.imagePreviewError ?? initialError}
          imagePreviewStageRef={hook.imagePreviewStageRef}
          imagePreviewImageRef={hook.imagePreviewImageRef}
          zoomIn={hook.zoomIn}
          zoomOut={hook.zoomOut}
          showOriginalSize={hook.showOriginalSize}
          resetImagePreview={hook.resetImagePreview}
          saveImageAs={hook.saveImageAs}
          downloadImage={hook.downloadImage}
          handleImageLoad={hook.handleImageLoad}
          handleImagePreviewError={hook.handleImagePreviewError}
          handleImagePreviewWheel={hook.handleImagePreviewWheel}
          handleImagePreviewPointerDown={hook.handleImagePreviewPointerDown}
          handleImagePreviewPointerMove={hook.handleImagePreviewPointerMove}
          stopImagePreviewPanning={hook.stopImagePreviewPanning}
          isPanning={hook.isImagePreviewPanning}
          onClose={hook.closeImagePreview}
          onBackgroundRestored={hook.restoreImagePreviewFocus}
        />
      )}
    </div>
  );
}

function ContextMenuPreviewHarness() {
  const [imageContextMenu, setImageContextMenu] = useState<(PreviewImage & { x: number; y: number }) | null>(null);
  const [attachmentContextMenu, setAttachmentContextMenu] = useState<AttachmentContextMenu>(null);
  const hook = useImagePreview(
    noMessage(),
    imageContextMenu,
    setImageContextMenu,
    attachmentContextMenu,
    setAttachmentContextMenu,
  );

  return (
    <div>
      <div onContextMenu={hook.handleReaderHtmlContextMenu}>
        <img alt="右键图片" src="data:image/png;base64,iVBORw0KGgo=" />
      </div>
      {imageContextMenu && (
        <ImageContextMenuOverlay
          imageContextMenu={imageContextMenu}
          openImagePreview={hook.openImagePreviewFromContextMenu}
          setImageContextMenu={setImageContextMenu}
          savePreviewImageAs={hook.savePreviewImageAs}
          downloadPreviewImage={hook.downloadPreviewImage}
          copyPreviewImageToClipboard={hook.copyPreviewImageToClipboard}
          copyPreviewImageSource={hook.copyPreviewImageSource}
        />
      )}
      {hook.imagePreview && (
        <ImagePreviewOverlay
          imagePreview={hook.imagePreview}
          imagePreviewFit={hook.imagePreviewFit}
          imagePreviewZoom={hook.imagePreviewZoom}
          imagePreviewPan={hook.imagePreviewPan}
          imagePreviewLoading={hook.imagePreviewLoading}
          imagePreviewError={hook.imagePreviewError}
          imagePreviewStageRef={hook.imagePreviewStageRef}
          imagePreviewImageRef={hook.imagePreviewImageRef}
          zoomIn={hook.zoomIn}
          zoomOut={hook.zoomOut}
          showOriginalSize={hook.showOriginalSize}
          resetImagePreview={hook.resetImagePreview}
          saveImageAs={hook.saveImageAs}
          downloadImage={hook.downloadImage}
          handleImageLoad={hook.handleImageLoad}
          handleImagePreviewError={hook.handleImagePreviewError}
          handleImagePreviewWheel={hook.handleImagePreviewWheel}
          handleImagePreviewPointerDown={hook.handleImagePreviewPointerDown}
          handleImagePreviewPointerMove={hook.handleImagePreviewPointerMove}
          stopImagePreviewPanning={hook.stopImagePreviewPanning}
          isPanning={hook.isImagePreviewPanning}
          onClose={hook.closeImagePreview}
          onBackgroundRestored={hook.restoreImagePreviewFocus}
        />
      )}
    </div>
  );
}

describe('image preview modal', () => {
  afterEach(() => cleanup());

  it('opens above the app as a portal with title and close affordances', () => {
    render(<PreviewHarness />);
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    const dialog = document.querySelector('.reader-image-preview-backdrop');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.reader-image-preview-title')?.textContent).toBe('测试图片');
    expect(screen.getByRole('button', { name: '关闭图片预览' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '放大' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '缩小' })).not.toBeNull();
    // portal 直接挂到 body，不受阅读区滚动/裁切影响
    expect(dialog?.parentElement).toBe(document.body);
  });

  it('zooms in and out and closes through the close button, mask and Escape', () => {
    render(<PreviewHarness />);
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));
    expect(document.querySelector('.reader-image-preview-backdrop')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    const zoomLabel = document.querySelector('.reader-image-preview-toolbar span')?.textContent;
    expect(zoomLabel).toMatch(/\d+%/);

    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
    expect(document.querySelector('.reader-image-preview-backdrop')).toBeNull();

    // 遮罩点击关闭
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));
    expect(document.querySelector('.reader-image-preview-backdrop')).not.toBeNull();
    fireEvent.click(document.querySelector('.reader-image-preview-backdrop')!);
    expect(document.querySelector('.reader-image-preview-backdrop')).toBeNull();

    // Escape 关闭
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));
    expect(document.querySelector('.reader-image-preview-backdrop')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.reader-image-preview-backdrop')).toBeNull();
  });

  it('consumes Escape before background window listeners can handle it', () => {
    const backgroundEscape = vi.fn();
    window.addEventListener('keydown', backgroundEscape);
    try {
      render(<PreviewHarness />);
      fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        window.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(backgroundEscape).not.toHaveBeenCalled();
      expect(document.querySelector('.reader-image-preview-backdrop')).toBeNull();
    } finally {
      window.removeEventListener('keydown', backgroundEscape);
    }
  });

  it('restores focus to the clicked element when the preview closes', () => {
    render(<PreviewHarness />);
    const trigger = screen.getByRole('button', { name: '打开预览' });
    trigger.focus();
    fireEvent.click(trigger);

    const closeButton = screen.getByRole('button', { name: '关闭图片预览' });
    expect(document.activeElement).toBe(closeButton);

    fireEvent.click(closeButton);
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the original image after using the context-menu preview action', async () => {
    render(<ContextMenuPreviewHarness />);
    const image = screen.getByRole('img', { name: '右键图片' });
    fireEvent.contextMenu(image, { clientX: 24, clientY: 32 });
    fireEvent.click(screen.getByRole('menuitem', { name: '查看大图' }));

    fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(image);
      expect(image.hasAttribute('tabindex')).toBe(false);
    });
  });

  it('shows an in-modal error with close affordances when the image fails to load', async () => {
    render(<PreviewHarness initialError="图片加载失败：地址无效或附件已不存在，请关闭后重试。" />);
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    const error = document.querySelector('.reader-image-preview-error');
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain('无法显示这张图片');
    expect(error?.textContent).toContain('图片加载失败');

    // 缩放等按钮在错误态禁用，但关闭入口必须保留。
    expect(screen.getByRole('button', { name: '放大' })).toHaveProperty('disabled', true);
    const errorClose = screen.getByRole('button', { name: '关闭' });
    expect(errorClose).not.toBeNull();

    // X、Escape、遮罩三种关闭方式都可用，且不会抛错到全局错误边界。
    fireEvent.click(errorClose);
    expect(document.querySelector('.reader-image-preview-backdrop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.reader-image-preview-backdrop')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));
    fireEvent.click(document.querySelector('.reader-image-preview-backdrop')!);
    expect(document.querySelector('.reader-image-preview-backdrop')).toBeNull();
  });

  it('surfaces save-as failures inside the modal without crashing', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('附件文件不存在或已被删除。'));
    render(<PreviewHarness saveAsFailure />);
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    fireEvent.click(screen.getByRole('button', { name: '另存为' }));
    await waitFor(() => {
      expect(document.querySelector('.reader-image-preview-error')).not.toBeNull();
    });
    expect(document.querySelector('.reader-image-preview-error')?.textContent).toContain('附件文件不存在或已被删除');
    // 错误态仍可关闭，不会卡死。
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('.reader-image-preview-backdrop')).toBeNull();
  });

  it('keeps the preview unchanged when the user cancels the system save-as dialog', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('操作已取消。'));
    render(<PreviewHarness saveAsFailure />);
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    fireEvent.click(screen.getByRole('button', { name: '另存为' }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('save_attachment_as', { attachmentId: 42 });
    });
    // 取消不是失败：预览保持不变、不进入错误态、可继续操作。
    expect(document.querySelector('.reader-image-preview-error')).toBeNull();
    expect(document.querySelector('.reader-image-preview-backdrop')).not.toBeNull();
    expect(screen.getByRole('button', { name: '放大' })).toHaveProperty('disabled', false);
  });

  it('traps Tab/Shift+Tab focus inside the modal so it never escapes to the app', () => {
    render(<PreviewHarness />);
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    const dialog = document.querySelector('.reader-image-preview') as HTMLElement;
    const firstButton = screen.getByRole('button', { name: '缩小' });
    const lastButton = screen.getByRole('button', { name: '关闭图片预览' });

    // 焦点在最后一个控件时按 Tab → 回到第一个控件。
    lastButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(firstButton);

    // 焦点在第一个控件时 Shift+Tab → 回到最后一个控件。
    firstButton.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastButton);

    // 焦点若逃逸到弹窗外（例如点击了 body），下一次 Tab 立即拉回弹窗内。
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('keeps WindowChrome in its React-owned position while making the app background inert', () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    try {
      render(
        <main className="app-shell">
          <div data-window-chrome>
            <button type="button" aria-label="关闭窗口">关闭窗口</button>
          </div>
          <section data-testid="app-background">
            <button type="button">底层按钮</button>
          </section>
          <PreviewHarness />
        </main>,
        { container: root },
      );
      fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

      const chrome = root.querySelector<HTMLElement>('[data-window-chrome]');
      const background = root.querySelector<HTMLElement>('[data-testid="app-background"]');
      const shell = root.querySelector('.app-shell');
      expect(chrome?.parentElement).toBe(shell);
      expect(chrome?.hasAttribute('inert')).toBe(false);
      expect(chrome?.getAttribute('aria-hidden')).toBeNull();
      expect(background?.hasAttribute('inert')).toBe(true);
      expect(background?.getAttribute('aria-hidden')).toBe('true');
      expect(root.hasAttribute('inert')).toBe(false);

      // 即使用户刚刚聚焦窗口控件，Tab 也被模态的全局焦点陷阱拉回预览。
      const chromeButton = chrome?.querySelector('button') as HTMLButtonElement;
      chromeButton.focus();
      fireEvent.keyDown(chromeButton, { key: 'Tab' });
      expect(document.querySelector('.reader-image-preview')?.contains(document.activeElement)).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: '关闭图片预览' }));
      expect(chrome?.parentElement).toBe(shell);
      expect(background?.hasAttribute('inert')).toBe(false);
      expect(background?.hasAttribute('aria-hidden')).toBe(false);
    } finally {
      root.remove();
    }
  });
});

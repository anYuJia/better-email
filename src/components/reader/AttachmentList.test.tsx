import { useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttachmentList from './AttachmentList';
import type { Attachment } from '../../app/types';
import ContextMenu from '../ContextMenu';
import type { AttachmentContextMenu } from './useImagePreview';

const pdf: Attachment = {
  id: 1, message_id: 7, filename: '安全检查清单.pdf', mime_type: 'application/pdf', size_bytes: 2048,
  is_downloaded: false, local_path: '', content_id: '', is_inline: false,
};
const photo: Attachment = { ...pdf, id: 2, filename: 'photo.png', mime_type: 'image/png' };
function props(overrides: Partial<ComponentProps<typeof AttachmentList>> = {}): ComponentProps<typeof AttachmentList> {
  return {
    attachments: [pdf], pendingAttachmentCount: 1, totalSize: 2048, downloadingIds: new Set(), errors: {},
    isDownloadingAll: false, onDownloadAll: vi.fn(), onDownload: vi.fn().mockResolvedValue(null),
    onPreview: vi.fn().mockResolvedValue(undefined), onOpen: vi.fn(), onContextMenu: vi.fn(), ...overrides,
  };
}
afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('AttachmentList compact summary', () => {
  it('downloads directly from the summary and retains the focused control as progress expands details', async () => {
    const input = props();
    const view = render(<AttachmentList {...input} />);
    expect(view.container.querySelector('.attachments')).toBeNull();
    expect(screen.getByRole('button', { name: '查看附件：安全检查清单.pdf' }).getAttribute('aria-expanded')).toBe('false');
    const download = screen.getByRole('button', { name: `下载：${pdf.filename}` });
    download.focus();
    fireEvent.click(download);
    expect(input.onDownload).toHaveBeenCalledWith(pdf);
    view.rerender(<AttachmentList {...input} downloadingIds={new Set([1])} />);
    expect(view.container.querySelectorAll('.attachments .attachment-item')).toHaveLength(1);
    expect(screen.getByRole('button', { name: `下载中…：${pdf.filename}` })).toBe(download);
    expect(document.activeElement).toBe(download);
    await act(async () => {});
  });

  it('keeps failures and retry actionable even when attachment details are collapsed', async () => {
    const input = props({ errors: { 1: '下载中断，已保留 64 KB' } });
    const view = render(<AttachmentList {...input} />);
    expect(view.container.querySelector('.attachment-transfer-status')?.textContent).toContain('下载中断');
    fireEvent.click(screen.getByRole('button', { name: '收起附件：安全检查清单.pdf' }));
    expect(view.container.querySelector('.attachments')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('下载中断');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `重试：${pdf.filename}` })); });
    expect(input.onDownload).toHaveBeenCalledWith(pdf);
  });

  it('expands multiple files for batch download and preserves individual preview and context actions', async () => {
    const input = props({ attachments: [pdf, photo], pendingAttachmentCount: 2, totalSize: 4096 });
    const view = render(<AttachmentList {...input} />);
    expect(view.container.querySelector('.attachments')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下载全部 2 个附件' })); });
    expect(input.onDownloadAll).toHaveBeenCalledOnce();
    expect(view.container.querySelectorAll('.attachment-item')).toHaveLength(2);
    const preview = screen.getByRole('button', { name: `预览：${photo.filename}` });
    await act(async () => { fireEvent.click(preview); });
    expect(input.onPreview).toHaveBeenCalledWith(photo, preview);
    fireEvent.contextMenu(view.container.querySelectorAll('.attachment-item')[1], { clientX: 20, clientY: 30 });
    expect(input.onContextMenu).toHaveBeenCalledWith({ attachment: photo, x: 20, y: 30 });
  });

  it('opens downloaded files from the compact summary without downloading them again', async () => {
    const attachment = { ...pdf, is_downloaded: true, local_path: '/tmp/safety.pdf' };
    const input = props({ attachments: [attachment], pendingAttachmentCount: 0 });
    render(<AttachmentList {...input} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `打开：${pdf.filename}` })); });
    expect(input.onOpen).toHaveBeenCalledWith(attachment);
    expect(input.onDownload).not.toHaveBeenCalled();
  });

  it('blocks repeated row and button downloads, including download-all, before parent props update', async () => {
    const transfer = deferred<Attachment | null>();
    const input = props({ attachments: [pdf, photo], pendingAttachmentCount: 2, onDownload: vi.fn(() => transfer.promise) });
    const view = render(<AttachmentList {...input} />);
    fireEvent.click(screen.getByRole('button', { name: '查看附件（2 个）' }));
    const download = screen.getByRole('button', { name: `下载：${pdf.filename}` });
    act(() => {
      fireEvent.click(download);
      fireEvent.click(download);
      fireEvent.doubleClick(view.container.querySelector('.attachment-item')!);
      fireEvent.click(screen.getByRole('button', { name: '下载全部 2 个附件' }));
    });
    expect(input.onDownload).toHaveBeenCalledTimes(1);
    expect(input.onDownloadAll).not.toHaveBeenCalled();
    expect(download.hasAttribute('disabled')).toBe(true);
    expect(download.textContent).toBe('下载中…');
    await act(async () => { transfer.resolve(null); });
    expect(download.hasAttribute('disabled')).toBe(false);
  });

  it('does not interpret a double-click on the open button as another row action', async () => {
    const attachment = { ...pdf, is_downloaded: true, local_path: '/private/internal/file.pdf' };
    const input = props({ attachments: [attachment, photo], pendingAttachmentCount: 1 });
    render(<AttachmentList {...input} />);
    fireEvent.click(screen.getByRole('button', { name: '查看附件（2 个）' }));
    const open = screen.getByRole('button', { name: `打开：${pdf.filename}` });
    await act(async () => { fireEvent.click(open, { detail: 1 }); });
    await act(async () => {
      fireEvent.click(open, { detail: 2 });
      fireEvent.doubleClick(open);
    });
    expect(input.onOpen).toHaveBeenCalledTimes(1);
    expect(open.title).toBe(`打开 ${pdf.filename}`);
  });

  it('honors externally active downloads on double-click and offers a named retry after a rejected action', async () => {
    const input = props({ downloadingIds: new Set([pdf.id]), onDownload: vi.fn().mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue(null) });
    const view = render(<AttachmentList {...input} />);
    fireEvent.doubleClick(view.container.querySelector('.attachment-item')!);
    expect(input.onDownload).not.toHaveBeenCalled();
    view.rerender(<AttachmentList {...input} downloadingIds={new Set()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `下载：${pdf.filename}` })); });
    expect(screen.getByRole('status').textContent).toBe('网络中断');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `重试：${pdf.filename}` })); });
    expect(input.onDownload).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a batch exclusive and reports rejection without stranding the retry controls', async () => {
    const transfer = deferred<void>();
    const input = props({ attachments: [pdf, photo], pendingAttachmentCount: 2, onDownloadAll: vi.fn(() => transfer.promise) });
    const view = render(<AttachmentList {...input} />);
    const all = screen.getByRole('button', { name: '下载全部 2 个附件' });
    fireEvent.click(all);
    fireEvent.click(all);
    fireEvent.click(screen.getByRole('button', { name: `下载：${pdf.filename}` }));
    fireEvent.doubleClick(view.container.querySelector('.attachment-item')!);
    expect(input.onDownloadAll).toHaveBeenCalledTimes(1);
    expect(input.onDownload).not.toHaveBeenCalled();
    await act(async () => { transfer.reject(new Error('批量下载暂不可用')); });
    expect(screen.getByRole('status').textContent).toBe('批量下载暂不可用');
    expect(all.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: `下载：${pdf.filename}` }).hasAttribute('disabled')).toBe(false);
  });

  it('keeps image preview and download mutually exclusive until preview preparation finishes', async () => {
    const preview = deferred<void>();
    const input = props({ attachments: [photo], onPreview: vi.fn(() => preview.promise) });
    const view = render(<AttachmentList {...input} />);
    const button = screen.getByRole('button', { name: `预览：${photo.filename}` });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.doubleClick(view.container.querySelector('.attachment-item')!);
    expect(input.onPreview).toHaveBeenCalledTimes(1);
    expect(input.onDownload).not.toHaveBeenCalled();
    await act(async () => { preview.resolve(); });
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it('opens the existing menu by touch or Shift+F10 and restores focus to the exact trigger', () => {
    function Harness() {
      const [context, setContext] = useState<AttachmentContextMenu>(null);
      return <>
        <AttachmentList {...props({ attachments: [pdf, photo], onContextMenu: setContext })} />
        {context && <ContextMenu x={context.x} y={context.y} onClose={() => setContext(null)}
          items={[{ id: 'save-as', label: '另存为…', onSelect: vi.fn() }]} ariaLabel="附件操作" />}
      </>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '查看附件（2 个）' }));
    const more = screen.getByRole('button', { name: `更多附件操作：${photo.filename}` });
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(more);
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '另存为…' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(more);
    const download = screen.getByRole('button', { name: `下载：${pdf.filename}` });
    download.focus();
    fireEvent.keyDown(download, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: '附件操作' })).toBeDefined();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(download);
  });
});

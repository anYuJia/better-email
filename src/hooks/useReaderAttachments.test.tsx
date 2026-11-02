import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useReaderAttachments from './useReaderAttachments';
import { localFileAssetUrl, invoke } from '../tauriBridge';
import type { Attachment } from '../app/types';

vi.mock('../tauriBridge', () => ({
  invoke: vi.fn(),
  localFileAssetUrl: vi.fn(),
}));

function imageAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 1,
    message_id: 1,
    filename: 'photo.png',
    mime_type: 'image/png',
    size_bytes: 1024,
    is_downloaded: false,
    local_path: '',
    content_id: '',
    is_inline: false,
    ...overrides,
  };
}

function renderHookManager() {
  const onDownloadAttachment = vi.fn();
  const onOpenAttachment = vi.fn();
  const onSaveAttachmentAs = vi.fn();
  const openImagePreview = vi.fn();
  const onRefreshAttachments = vi.fn().mockResolvedValue(undefined);
  const utils = renderHook(() => useReaderAttachments({
    attachments: [],
    selectedId: null,
    onDownloadAttachment,
    onOpenAttachment,
    onSaveAttachmentAs,
    openImagePreview,
    onRefreshAttachments,
  }));
  return { utils, onDownloadAttachment, onOpenAttachment, openImagePreview, onRefreshAttachments };
}

describe('useReaderAttachments preview-after-download', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(localFileAssetUrl).mockReset();
    vi.mocked(localFileAssetUrl).mockImplementation(async (path) => `asset://localhost${path}`);
  });

  afterEach(() => cleanup());

  it('previews an already-downloaded image attachment with its asset url', async () => {
    const { utils, openImagePreview } = renderHookManager();
    const attachment = imageAttachment({ is_downloaded: true, local_path: '/appdata/attachments/photo.png' });
    vi.mocked(invoke).mockResolvedValueOnce(attachment);

    await act(async () => {
      await utils.result.current.previewAttachment(attachment);
    });

    expect(openImagePreview).toHaveBeenCalledTimes(1);
    expect(openImagePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        src: 'asset://localhost/appdata/attachments/photo.png',
        alt: 'photo.png',
        attachmentId: 1,
      }),
      null,
    );
    expect(invoke).not.toHaveBeenCalledWith('download_attachment', expect.anything());
  });

  it('downloads an undownloaded image attachment first and previews using the fresh returned attachment, never the empty local_path', async () => {
    const { utils, onDownloadAttachment, openImagePreview } = renderHookManager();
    const stale = imageAttachment({ id: 7, local_path: '' });
    const fresh = imageAttachment({ id: 7, is_downloaded: true, local_path: '/appdata/attachments/7-photo.png' });
    onDownloadAttachment.mockResolvedValue(fresh);
    vi.mocked(invoke).mockResolvedValueOnce(fresh);

    await act(async () => {
      await utils.result.current.previewAttachment(stale);
    });

    expect(onDownloadAttachment).toHaveBeenCalledWith(stale);
    // 资源地址来自下载接口返回的新附件 local_path，而不是下载前为空的旧值。
    expect(localFileAssetUrl).toHaveBeenCalledWith('/appdata/attachments/7-photo.png');
    expect(openImagePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        src: 'asset://localhost/appdata/attachments/7-photo.png',
        alt: 'photo.png',
        attachmentId: 7,
      }),
      null,
    );
  });

  it('does not open a preview when the download fails', async () => {
    const { utils, onDownloadAttachment, openImagePreview } = renderHookManager();
    onDownloadAttachment.mockRejectedValue(new Error('下载失败'));

    await act(async () => {
      await utils.result.current.previewAttachment(imageAttachment({ id: 7 }));
    });

    expect(openImagePreview).not.toHaveBeenCalled();
    expect(utils.result.current.attachmentErrors[7]).toContain('下载失败');
  });

  it('shows a visible attachment error instead of silently swallowing an asset-url failure', async () => {
    const { utils, openImagePreview } = renderHookManager();
    const attachment = imageAttachment({
      id: 9,
      is_downloaded: true,
      local_path: '/appdata/attachments/missing.png',
    });
    vi.mocked(localFileAssetUrl).mockRejectedValueOnce(new Error('附件文件不存在或已被删除。'));
    vi.mocked(invoke).mockResolvedValueOnce(attachment);

    await act(async () => {
      await utils.result.current.previewAttachment(attachment);
    });

    expect(openImagePreview).not.toHaveBeenCalled();
    expect(utils.result.current.attachmentErrors[9]).toContain('附件文件不存在或已被删除');
  });

  it('treats an empty local asset url as a visible preview failure', async () => {
    const { utils, openImagePreview } = renderHookManager();
    const attachment = imageAttachment({
      id: 10,
      is_downloaded: true,
      local_path: '/appdata/attachments/empty.png',
    });
    vi.mocked(localFileAssetUrl).mockResolvedValueOnce('');
    vi.mocked(invoke).mockResolvedValueOnce(attachment);

    await act(async () => {
      await utils.result.current.previewAttachment(attachment);
    });

    expect(openImagePreview).not.toHaveBeenCalled();
    expect(utils.result.current.attachmentErrors[10]).toContain('附件本地文件不可用');
  });

  it('previews the repaired managed copy instead of a legacy sent attachment path', async () => {
    const { utils, openImagePreview } = renderHookManager();
    const legacy = imageAttachment({ is_downloaded: true, local_path: '/appdata/temp_attachments/photo.png' });
    const repaired = { ...legacy, local_path: '/appdata/attachments/1/repaired-photo.png' };
    vi.mocked(invoke).mockResolvedValueOnce(repaired);
    await act(async () => { await utils.result.current.previewAttachment(legacy); });
    expect(invoke).toHaveBeenCalledWith('prepare_attachment_preview', { attachmentId: 1 });
    expect(localFileAssetUrl).toHaveBeenCalledWith(repaired.local_path);
    expect(openImagePreview).toHaveBeenCalledOnce();
  });

  it('refreshes download state when native validation discovers a missing file', async () => {
    const { utils, openImagePreview, onRefreshAttachments } = renderHookManager();
    const missing = imageAttachment({ is_downloaded: true, local_path: '/appdata/temp_attachments/photo.png' });
    vi.mocked(invoke).mockRejectedValueOnce(new Error('本地副本已丢失，请重新下载'));
    await act(async () => { await utils.result.current.previewAttachment(missing); });
    expect(openImagePreview).not.toHaveBeenCalled();
    expect(onRefreshAttachments).toHaveBeenCalledWith(1);
    expect(utils.result.current.attachmentErrors[1]).toContain('重新下载');
  });
});

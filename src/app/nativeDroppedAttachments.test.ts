import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../ipc/commands';
import { importNativeDroppedAttachmentPaths } from './nativeDroppedAttachments';

const bridgeMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  localFileAssetUrl: vi.fn(),
}));

vi.mock('../tauriBridge', () => ({
  invoke: bridgeMocks.invoke,
  localFileAssetUrl: bridgeMocks.localFileAssetUrl,
}));

describe('importNativeDroppedAttachmentPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMocks.localFileAssetUrl.mockImplementation(async (path: string) => `asset://${path}`);
    bridgeMocks.invoke.mockResolvedValue('/private/temp/attachment');
  });

  it('imports a native dropped path directly through the scoped asset URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(['hello'], { type: 'text/plain' }),
    })));

    const result = await importNativeDroppedAttachmentPaths(['C:\\Users\\me\\hello.txt']);

    expect(result.failed).toBe(0);
    expect(result.attachments).toEqual([
      expect.objectContaining({
        filename: 'hello.txt',
        mime_type: 'text/plain',
        size_bytes: 5,
        local_path: '/private/temp/attachment',
      }),
    ]);
    expect(bridgeMocks.invoke).toHaveBeenCalledWith(
      IPC.SaveTempAttachment,
      expect.objectContaining({ filename: 'hello.txt' }),
    );
    expect(bridgeMocks.invoke).not.toHaveBeenCalledWith(IPC.PickOutboundAttachments, expect.anything());
  });

  it('keeps successful files when another dropped file fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('bad.pdf')) throw new Error('blocked');
      return {
        ok: true,
        status: 200,
        blob: async () => new Blob(['ok'], { type: 'text/plain' }),
      };
    }));

    const result = await importNativeDroppedAttachmentPaths([
      '/tmp/good.txt',
      '/tmp/bad.pdf',
      '/tmp/good.txt',
    ]);

    expect(result.attachments).toHaveLength(1);
    expect(result.failed).toBe(1);
    expect(result.firstError).toContain('blocked');
    expect(bridgeMocks.localFileAssetUrl).toHaveBeenCalledTimes(2);
  });
});

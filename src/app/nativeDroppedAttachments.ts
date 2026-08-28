import type { OutboundAttachmentInput } from './types';
import { invoke, localFileAssetUrl } from '../tauriBridge';
import { IPC } from '../ipc/commands';

export type NativeDroppedAttachmentImportResult = {
  attachments: OutboundAttachmentInput[];
  failed: number;
  firstError: string | null;
};

function filenameFromNativePath(path: string) {
  const normalized = path.trim().replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || 'attachment';
}

function readBlobAsBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('读取拖入文件失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Import paths received directly from Tauri's native drag/drop event.
 *
 * Tauri adds real OS-dropped paths to the asset-protocol scope before the
 * renderer receives the drag event. We only read those scoped asset URLs and
 * immediately persist them through SaveTempAttachment, so arbitrary renderer
 * paths never become a privileged path-based IPC surface.
 */
export async function importNativeDroppedAttachmentPaths(
  paths: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<NativeDroppedAttachmentImportResult> {
  const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  const attachments: OutboundAttachmentInput[] = [];
  let failed = 0;
  let firstError: string | null = null;

  onProgress?.(0, uniquePaths.length);
  for (const [index, path] of uniquePaths.entries()) {
    try {
      const assetUrl = await localFileAssetUrl(path);
      const response = await fetch(assetUrl);
      if (!response.ok) {
        throw new Error(`无法读取拖入文件（${response.status}）`);
      }
      const blob = await response.blob();
      const filename = filenameFromNativePath(path);
      const base64Data = await readBlobAsBase64(blob);
      const savedPath = await invoke<string>(IPC.SaveTempAttachment, {
        filename,
        base64Data,
      });
      attachments.push({
        filename,
        mime_type: blob.type || 'application/octet-stream',
        size_bytes: Math.min(blob.size, Number.MAX_SAFE_INTEGER),
        local_path: savedPath,
      });
    } catch (error) {
      failed += 1;
      firstError ??= String(error);
    } finally {
      onProgress?.(index + 1, uniquePaths.length);
    }
  }

  return { attachments, failed, firstError };
}

import type { PendingAttachmentRecovery } from './types/composer';
import type { OutboundAttachmentInput } from './types/message';

export type AttachmentImportItem = {
  id: string;
  filename: string;
  sizeBytes: number | null;
  status: 'queued' | 'preparing' | 'ready' | 'failed';
  progress: number | null;
  error: string | null;
  source: 'file' | 'native' | 'picker';
  inline: boolean;
  contentId?: string;
  recoveryFiles?: PendingAttachmentRecovery[];
};

export function normalizePendingAttachments(value: unknown): PendingAttachmentRecovery[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item.filename === 'string' && item.filename.trim())
    .map(item => ({
      // Only a basename is retained, never a selected/native authorization path.
      filename: item.filename.replace(/\\/g, '/').split('/').pop() || '未完成附件',
      size_bytes: Number.isSafeInteger(item.size_bytes) && item.size_bytes >= 0 ? item.size_bytes : null,
      is_inline: item.is_inline === true,
      ...(item.selection_unknown === true ? { selection_unknown: true as const } : {}),
    }));
}

export function pendingAttachmentRecovery(items: readonly AttachmentImportItem[], attached: readonly OutboundAttachmentInput[]) {
  return normalizePendingAttachments(items.flatMap(item => {
    // A pasted image is returned to the editor as a batch. Preserve the intent
    // of already-read images until the editor has committed their CID as well.
    const uncommittedImage = item.inline && item.status === 'ready'
      && !attached.some(attachment => attachment.content_id === item.contentId);
    if (item.status === 'ready' && !uncommittedImage) return [];
    return item.recoveryFiles ?? [{ filename: item.filename, size_bytes: item.sizeBytes, is_inline: item.inline,
      ...(item.source === 'picker' ? { selection_unknown: true as const } : {}) }];
  }));
}

// Matches the outbound attachment limit enforced by the native command.
export const MAX_ATTACHMENT_IMPORT_BYTES = 25 * 1024 * 1024;

export function validateAttachmentImportFile(filename: string, size: number) {
  if (!filename.trim()) throw new Error('附件没有有效文件名，请重新选择文件。');
  if (size > MAX_ATTACHMENT_IMPORT_BYTES) throw new Error('单个附件不能超过 25 MiB，请压缩文件或选择较小的文件。');
}

export function attachmentImportBlockReason(items: readonly AttachmentImportItem[]): string | null {
  if (items.some(item => item.status === 'queued' || item.status === 'preparing')) {
    return '附件仍在准备中，请等待完成后再发送或保存草稿。';
  }
  if (items.some(item => item.status === 'failed')) {
    return '有附件准备失败，请重试或移除失败项后再发送或保存草稿。';
  }
  return null;
}

export function attachmentImportCancelled() {
  return new DOMException('当前草稿已关闭或切换，附件导入已取消。', 'AbortError');
}

export function readAttachmentFile(file: File, signal: AbortSignal, onProgress: (percent: number) => void) {
  return new Promise<string>((resolve, reject) => {
    try { validateAttachmentImportFile(file.name, file.size); } catch (error) { reject(error); return; }
    if (signal.aborted) { reject(attachmentImportCancelled()); return; }
    const reader = new FileReader();
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { reader.abort(); cleanup(); reject(attachmentImportCancelled()); };
    signal.addEventListener('abort', abort, { once: true });
    reader.onload = () => {
      cleanup();
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => { cleanup(); reject(new Error('读取文件失败，请确认文件仍存在且可读取。')); };
    reader.onabort = () => { cleanup(); reject(attachmentImportCancelled()); };
    reader.onprogress = event => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.round(event.loaded / event.total * 80));
    };
    reader.readAsDataURL(file);
  });
}

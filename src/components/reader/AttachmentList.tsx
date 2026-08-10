import { Download } from 'lucide-react';
import type { Attachment } from '../../app/types';
import { formatBytes } from '../../mailUtils';
import { attachmentIcon, attachmentKind, attachmentTypeDescription } from './attachmentUtils';
import type { AttachmentContextMenu } from './useImagePreview';

type AttachmentListProps = {
  attachments: Attachment[];
  pendingAttachmentCount: number;
  totalSize: number;
  downloadingIds: Set<number>;
  errors: Record<number, string>;
  isDownloadingAll: boolean;
  onDownloadAll: () => void;
  onDownload: (attachment: Attachment) => Promise<Attachment | null>;
  onPreview: (attachment: Attachment, trigger?: HTMLElement | null) => Promise<void>;
  onOpen: (attachment: Attachment) => void;
  onContextMenu: (context: AttachmentContextMenu) => void;
};

export default function AttachmentList({
  attachments,
  pendingAttachmentCount,
  totalSize,
  downloadingIds,
  errors,
  isDownloadingAll,
  onDownloadAll,
  onDownload,
  onPreview,
  onOpen,
  onContextMenu,
}: AttachmentListProps) {
  return (
    <div className="attachment-section">
      <header className="attachment-section-header">
        <span>
          <strong>附件</strong>
          <small>{attachments.length} 个 · {formatBytes(totalSize)}</small>
        </span>
        {pendingAttachmentCount > 0 && (
          <button
            type="button"
            disabled={isDownloadingAll}
            aria-busy={isDownloadingAll}
            onClick={onDownloadAll}
          >
            <Download size={14} />
            {isDownloadingAll
              ? '顺序下载中…'
              : `下载全部 ${pendingAttachmentCount} 个`}
          </button>
        )}
      </header>
      <div className="attachments">
        {attachments.map((attachment) => {
          const downloading = downloadingIds.has(attachment.id);
          const transferError = errors[attachment.id] ?? '';
          const kind = attachmentKind(attachment);
          const canPreview = kind === 'image';
          return (
            <div
              className={`attachment-item ${transferError ? 'attachment-download-failed' : ''}`}
              key={attachment.id}
              onDoubleClick={() => {
                if (attachment.is_downloaded) onOpen(attachment);
                else onDownload(attachment).catch(() => undefined);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu({ attachment, x: event.clientX, y: event.clientY });
              }}
            >
              <span className={`attachment-file-icon attachment-file-icon-${kind}`} aria-hidden="true">
                {attachmentIcon(attachment)}
              </span>
              <span className="attachment-copy">
                <strong>{attachment.filename}</strong>
                <small>
                  {attachmentTypeDescription(attachment)} · {formatBytes(attachment.size_bytes)}
                  {attachment.is_downloaded ? ' · 已下载' : ' · 未下载'}
                </small>
              </span>
              <div className="attachment-actions">
                {canPreview && (
                  <button
                    type="button"
                    className="attachment-preview-button"
                    title={attachment.local_path || attachment.filename}
                    disabled={downloading}
                    aria-busy={downloading}
                    onClick={(event) => onPreview(attachment, event.currentTarget).catch(() => undefined)}
                  >
                    预览
                  </button>
                )}
                <button
                  type="button"
                  className="attachment-primary-button"
                  title={attachment.local_path || attachment.filename}
                  disabled={downloading}
                  aria-busy={downloading}
                  onClick={() => attachment.is_downloaded
                    ? onOpen(attachment)
                    : onDownload(attachment)}
                >
                  {attachment.is_downloaded
                    ? '打开'
                    : downloading ? '下载中…' : transferError ? '重试' : '下载'}
                </button>
              </div>
              {transferError && (
                <small className="attachment-transfer-status" role="status">
                  {transferError}
                </small>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Download, File, FileArchive, FileAudio, FileChartColumn, FileImage, FileSpreadsheet, FileText, FileVideo, MoreHorizontal, Paperclip } from 'lucide-react';
import type { Attachment } from '../../app/types';
import { formatBytes } from '../../mailUtils';
import { attachmentKind, attachmentTypeDescription } from './attachmentUtils';
import type { AttachmentContextMenu } from './useImagePreview';

const fileIcons = { document: FileText, image: FileImage, archive: FileArchive,
  spreadsheet: FileSpreadsheet, presentation: FileChartColumn, audio: FileAudio, video: FileVideo, file: File };

type AttachmentListProps = {
  attachments: Attachment[];
  pendingAttachmentCount: number;
  totalSize: number;
  downloadingIds: Set<number>;
  errors: Record<number, string>;
  isDownloadingAll: boolean;
  onDownloadAll: () => void | Promise<void>;
  onDownload: (attachment: Attachment) => Promise<Attachment | null>;
  onPreview: (attachment: Attachment, trigger?: HTMLElement | null) => Promise<void>;
  onOpen: (attachment: Attachment) => void | Promise<void>;
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
  const [expanded, setExpanded] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<number, string>>({});
  const [batchError, setBatchError] = useState('');
  const [pendingActions, setPendingActions] = useState<ReadonlyMap<number, string>>(new Map());
  const [batchPending, setBatchPending] = useState(false);
  const activeActions = useRef(new Map<number, string>());
  const batchActive = useRef(false);
  const mounted = useRef(true);
  const listId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const currentErrors = { ...errors, ...localErrors };
  const singleAttachment = attachments.length === 1 ? attachments[0] : null;
  const activeTransfers = attachments
    .filter((attachment) => downloadingIds.has(attachment.id) || currentErrors[attachment.id])
    .map((attachment) => `${attachment.id}:${currentErrors[attachment.id] ?? 'downloading'}`)
    .join('|');
  const firstError = attachments.map((attachment) => currentErrors[attachment.id]).find(Boolean);
  const batchBusy = batchPending || isDownloadingAll;
  const anyTransfer = attachments.some((attachment) => downloadingIds.has(attachment.id) || pendingActions.has(attachment.id));
  useEffect(() => {
    // Download progress and failures stay discoverable even when the user
    // started the transfer from the compact summary.
    if (activeTransfers || isDownloadingAll) setExpanded(true);
  }, [activeTransfers, isDownloadingAll]);

  function isBusy(attachment: Attachment) {
    return downloadingIds.has(attachment.id) || activeActions.current.has(attachment.id)
      || (!attachment.is_downloaded && (batchActive.current || isDownloadingAll));
  }

  async function runAction(attachment: Attachment, action: 'download' | 'preview' | 'open', trigger?: HTMLElement) {
    // Props update after the click. The ref also protects the intervening
    // double-click/key-repeat and overlap with a batch download.
    if (isBusy(attachment)) return;
    activeActions.current.set(attachment.id, action);
    setPendingActions(new Map(activeActions.current));
    setLocalErrors((current) => {
      const next = { ...current };
      delete next[attachment.id];
      return next;
    });
    if (!attachment.is_downloaded) setExpanded(true);
    try {
      if (action === 'download') await onDownload(attachment);
      else if (action === 'preview') await onPreview(attachment, trigger);
      else await onOpen(attachment);
    } catch (error) {
      if (mounted.current) setLocalErrors((current) => ({
        ...current, [attachment.id]: String(error).replace(/^Error:\s*/i, '') || '附件操作失败，请重试。',
      }));
    } finally {
      activeActions.current.delete(attachment.id);
      if (mounted.current) setPendingActions(new Map(activeActions.current));
    }
  }

  async function downloadAll() {
    if (batchActive.current || isDownloadingAll || activeActions.current.size || anyTransfer) return;
    batchActive.current = true;
    setBatchPending(true);
    setBatchError('');
    setExpanded(true);
    try {
      await onDownloadAll();
    } catch (error) {
      if (mounted.current) setBatchError(String(error).replace(/^Error:\s*/i, '') || '附件下载失败，请重试。');
    } finally {
      batchActive.current = false;
      if (mounted.current) setBatchPending(false);
    }
  }

  function openMenu(attachment: Attachment, trigger: HTMLElement, position?: { x: number; y: number }) {
    if (isBusy(attachment)) return;
    // ContextMenu restores the active element on close; explicitly focus the
    // trigger because a pointer click does not focus buttons on every platform.
    trigger.focus({ preventScroll: true });
    const bounds = trigger.getBoundingClientRect();
    onContextMenu({ attachment, ...(position ?? { x: bounds.left, y: bounds.bottom }) });
  }

  function renderMore(attachment: Attachment) {
    return <button
      type="button"
      className="attachment-more-button"
      aria-label={`更多附件操作：${attachment.filename}`}
      aria-haspopup="menu"
      title="更多附件操作"
      disabled={isBusy(attachment)}
      onClick={(event) => { if (event.detail < 2) openMenu(attachment, event.currentTarget); }}
    ><MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" /></button>;
  }

  function renderActions(attachment: Attachment, includeMore = true) {
    const busy = isBusy(attachment);
    const downloading = downloadingIds.has(attachment.id) || (!attachment.is_downloaded && pendingActions.has(attachment.id));
    const primaryLabel = downloading ? '下载中…' : attachment.is_downloaded ? '打开' : currentErrors[attachment.id] ? '重试' : '下载';
    return (
      <div className="attachment-actions" onDoubleClick={(event) => event.stopPropagation()}>
        {attachmentKind(attachment) === 'image' && (
          <button
            type="button"
            className="attachment-preview-button"
            title={`预览 ${attachment.filename}`}
            aria-label={`预览：${attachment.filename}`}
            disabled={busy}
            aria-busy={pendingActions.get(attachment.id) === 'preview'}
            onClick={(event) => { if (event.detail < 2) void runAction(attachment, 'preview', event.currentTarget); }}
          >
            预览
          </button>
        )}
        <button
          type="button"
          className="attachment-primary-button"
          title={`${primaryLabel} ${attachment.filename}`}
          aria-label={`${primaryLabel}：${attachment.filename}`}
          disabled={busy}
          aria-busy={downloading}
          onClick={(event) => {
            if (event.detail < 2) void runAction(attachment, attachment.is_downloaded ? 'open' : 'download');
          }}
        >
          {primaryLabel}
        </button>
        {includeMore && renderMore(attachment)}
      </div>
    );
  }

  return (
    <div className={`attachment-section${singleAttachment ? '' : ' attachment-section-multiple'}`}>
      <header className="attachment-section-header">
        <button
          className="attachment-summary-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={`${expanded ? '收起' : '查看'}附件${singleAttachment ? `：${singleAttachment.filename}` : `（${attachments.length} 个）`}`}
          title={singleAttachment?.filename}
          onClick={() => setExpanded((value) => !value)}
        >
          <Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="attachment-summary-copy">
            <strong>{singleAttachment?.filename ?? `${attachments.length} 个附件`}</strong>
            <small>{formatBytes(totalSize)}</small>
          </span>
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {singleAttachment && renderActions(singleAttachment, false)}
        {!singleAttachment && pendingAttachmentCount > 0 && (
            <button
              type="button"
              className="attachment-download-all"
              disabled={batchBusy || anyTransfer}
              aria-busy={batchBusy}
              aria-label={`下载全部 ${pendingAttachmentCount} 个附件`}
              onClick={(event) => { if (event.detail < 2) void downloadAll(); }}
            >
              <Download size={16} strokeWidth={1.75} aria-hidden="true" />
              {batchBusy
                ? '下载中…'
                : '下载全部'}
            </button>
        )}
      </header>
      {batchError && <small className="attachment-summary-error" role="status">{batchError}</small>}
      {!expanded && firstError && <small className="attachment-summary-error" role="status">{firstError}</small>}
      {expanded && <div className="attachments" id={listId}>
        {attachments.map((attachment) => {
          const transferError = currentErrors[attachment.id] ?? '';
          const kind = attachmentKind(attachment);
          const FileIcon = fileIcons[kind];
          return (
            <div
              className={`attachment-item ${transferError ? 'attachment-download-failed' : ''}`}
              key={attachment.id}
              onDoubleClick={(event) => {
                if (event.target instanceof Element && event.target.closest('button')) return;
                void runAction(attachment, attachment.is_downloaded ? 'open' : 'download');
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.attachment-more-button');
                if (trigger) openMenu(attachment, trigger, event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                  event.preventDefault();
                  const trigger = event.target instanceof HTMLButtonElement ? event.target
                    : event.currentTarget.querySelector<HTMLButtonElement>('.attachment-more-button');
                  if (trigger) openMenu(attachment, trigger);
                }
              }}
            >
              <span className={`attachment-file-icon attachment-file-icon-${kind}`} aria-hidden="true">
                <FileIcon size={18} strokeWidth={1.75} />
              </span>
              <span className="attachment-copy">
                <strong title={attachment.filename}>{attachment.filename}</strong>
                <small>
                  {attachmentTypeDescription(attachment)} · {formatBytes(attachment.size_bytes)}
                  {downloadingIds.has(attachment.id) || (!attachment.is_downloaded && pendingActions.has(attachment.id))
                    ? ' · 下载中…' : attachment.is_downloaded ? ' · 已下载' : ' · 未下载'}
                </small>
              </span>
              {singleAttachment ? <div className="attachment-actions">{renderMore(attachment)}</div> : renderActions(attachment)}
              {transferError && (
                <small className="attachment-transfer-status" role="status">
                  {transferError}
                </small>
              )}
            </div>
          );
        })}
      </div>}
    </div>
  );
}

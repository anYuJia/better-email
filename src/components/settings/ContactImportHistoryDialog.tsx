import { createPortal } from 'react-dom';
import { History, Undo2, X } from 'lucide-react';
import type { ContactImportBatch } from '../../app/types/contact';
import SettingsButton from './shared/SettingsButton';

type ContactImportHistoryDialogProps = {
  open: boolean;
  batches: ContactImportBatch[];
  undoingBatchId: number | null;
  onUndo: (batch: ContactImportBatch) => void;
  onClose: () => void;
};

export default function ContactImportHistoryDialog({
  open,
  batches,
  undoingBatchId,
  onUndo,
  onClose,
}: ContactImportHistoryDialogProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="settings-backdrop contact-import-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="contact-import-dialog contact-import-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-import-history-title"
      >
        <header className="contact-import-dialog-header">
          <span className="contact-import-dialog-mark">
            <History size={18} />
          </span>
          <span className="contact-import-dialog-heading">
            <strong id="contact-import-history-title">最近导入记录</strong>
            <small>{batches.length} 个批次</small>
          </span>
          <button
            className="contact-import-close"
            type="button"
            title="关闭"
            aria-label="关闭导入记录"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        {batches.length === 0 ? (
          <p className="contact-import-history-empty">暂无导入记录。</p>
        ) : (
          <div className="contact-import-history-list">
            {batches.map((batch) => (
              <div className="contact-import-history-row" key={batch.id}>
                <span>
                  <strong>{batch.file_name}</strong>
                  <em>
                    {new Date(batch.created_at).toLocaleString()} · 新增 {batch.created_count} ·
                    合并 {batch.merged_count} · 跳过 {batch.skipped_count}
                  </em>
                </span>
                <SettingsButton
                  size="sm"
                  disabled={batch.created_count === 0 || undoingBatchId === batch.id}
                  icon={<Undo2 size={13} />}
                  onClick={() => onUndo(batch)}
                >
                  {batch.created_count > 0 ? '撤销本批新增' : '无可撤销'}
                </SettingsButton>
              </div>
            ))}
          </div>
        )}

        <footer className="contact-import-dialog-actions">
          <SettingsButton onClick={onClose}>关闭</SettingsButton>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

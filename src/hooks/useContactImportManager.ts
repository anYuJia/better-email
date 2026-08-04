import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  ContactImportBatch,
  ContactImportCommitSummary,
  ContactImportPreview,
  ContactImportSelection,
  ContactImportUndoReport,
} from '../app/types/contact';
import { invoke } from '../tauriBridge';

export type ImportSelectionMap = Record<string, 'create' | 'merge' | 'skip'>;

type ContactImportManagerOptions = {
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useContactImportManager({ setStatus }: ContactImportManagerOptions) {
  const [preview, setPreview] = useState<ContactImportPreview | null>(null);
  const [selectionMap, setSelectionMap] = useState<ImportSelectionMap>({});
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [batches, setBatches] = useState<ContactImportBatch[]>([]);
  const [undoingBatchId, setUndoingBatchId] = useState<number | null>(null);
  const [confirmUndoBatch, setConfirmUndoBatch] = useState<ContactImportBatch | null>(null);

  const defaultActionForStatus = useCallback((status: string): 'create' | 'merge' | 'skip' => {
    if (status === 'merge') return 'merge';
    if (status === 'duplicate' || status === 'invalid') return 'skip';
    return 'create';
  }, []);

  const startImport = useCallback(async () => {
    setPreviewing(true);
    try {
      const path = await invoke<string | null>('pick_contact_import_file');
      if (!path) {
        setStatus('已取消选择联系人导入文件');
        return;
      }
      const nextPreview = await invoke<ContactImportPreview>('preview_contact_import', { path });
      setPreview(nextPreview);
      setSelectionMap(Object.fromEntries(
        nextPreview.entries.map((entry) => [
          `${entry.email}|${entry.status}`,
          defaultActionForStatus(entry.status),
        ]),
      ));
      setStatus(`已预览 ${nextPreview.file_name}：新增 ${nextPreview.new_count}、合并 ${nextPreview.merge_count}、跳过 ${nextPreview.duplicate_count + nextPreview.invalid_count}`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setPreviewing(false);
    }
  }, [defaultActionForStatus, setStatus]);

  const setSelection = useCallback((email: string, action: 'create' | 'merge' | 'skip') => {
    setSelectionMap((current) => ({ ...current, [email]: action }));
  }, []);

  const setAllSelection = useCallback((action: 'create' | 'merge' | 'skip') => {
    setSelectionMap((current) => {
      const next = { ...current };
      for (const email of Object.keys(next)) {
        next[email] = action;
      }
      return next;
    });
  }, []);

  const selectionSummary = useCallback((): ContactImportSelection[] => {
    const byEmail = new Map<string, 'create' | 'merge' | 'skip'>();
    for (const entry of preview?.entries ?? []) {
      if (entry.status === 'invalid') continue;
      const action = selectionMap[entry.email] ?? defaultActionForStatus(entry.status);
      const existing = byEmail.get(entry.email);
      if (!existing || (action === 'merge' && existing !== 'merge')) {
        byEmail.set(entry.email, action);
      }
    }
    return [...byEmail.entries()].map(([email, action]) => ({ email, action }));
  }, [preview, selectionMap, defaultActionForStatus]);

  const commitImport = useCallback(async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const selections = selectionSummary();
      const summary = await invoke<ContactImportCommitSummary>('commit_contact_import', {
        path: preview.path,
        selections,
        scope: 'global',
      });
      setPreview(null);
      await refreshBatches();
      setStatus(`联系人导入完成：新增 ${summary.created}、合并 ${summary.merged}、跳过 ${summary.skipped}`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setImporting(false);
    }
  }, [preview, selectionSummary, setStatus]);

  const cancelImport = useCallback(() => {
    setPreview(null);
    setSelectionMap({});
  }, []);

  const refreshBatches = useCallback(async () => {
    try {
      const next = await invoke<ContactImportBatch[]>('list_contact_import_batches');
      setBatches(next);
    } catch {
      setBatches([]);
    }
  }, []);

  const undoBatch = useCallback(async (batchId: number) => {
    setUndoingBatchId(batchId);
    try {
      const report = await invoke<ContactImportUndoReport>('undo_contact_import_batch', { batchId });
      setConfirmUndoBatch(null);
      await refreshBatches();
      setStatus(`已撤销导入批次：删除 ${report.removed} 位新增联系人。${report.note}`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setUndoingBatchId(null);
    }
  }, [refreshBatches, setStatus]);

  return {
    preview,
    setPreview,
    selectionMap,
    setSelection,
    setAllSelection,
    selectionSummary,
    previewing,
    importing,
    startImport,
    commitImport,
    cancelImport,
    batches,
    refreshBatches,
    undoBatch,
    undoingBatchId,
    confirmUndoBatch,
    setConfirmUndoBatch,
  };
}

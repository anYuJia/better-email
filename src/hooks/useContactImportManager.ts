import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  ContactImportBatch,
  ContactImportCommitSummary,
  ContactImportEntryEdit,
  ContactImportEntryInput,
  ContactImportPreview,
  ContactImportUndoReport,
} from '../app/types/contact';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

export type ImportSelectionMap = Record<string, 'create' | 'merge' | 'skip'>;

export type ImportEntryEditMap = Record<string, ContactImportEntryEdit>;

export function importSelectionKey(email: string, status: string): string {
  return `${email}|${status}`;
}

type ContactImportManagerOptions = {
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useContactImportManager({ setStatus }: ContactImportManagerOptions) {
  const [preview, setPreview] = useState<ContactImportPreview | null>(null);
  const [commitResult, setCommitResult] = useState<ContactImportCommitSummary | null>(null);
  const [selectionMap, setSelectionMap] = useState<ImportSelectionMap>({});
  const [entryEdits, setEntryEdits] = useState<ImportEntryEditMap>({});
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
      const path = await invoke<string | null>(IPC.PickContactImportFile);
      if (!path) {
        setStatus('已取消选择联系人导入文件');
        return;
      }
      const nextPreview = await invoke<ContactImportPreview>(IPC.PreviewContactImport, { path });
      setPreview(nextPreview);
      setCommitResult(null);
      setEntryEdits({});
      setSelectionMap(Object.fromEntries(
        nextPreview.entries.map((entry) => [
          importSelectionKey(entry.email, entry.status),
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

  const setEntryEdit = useCallback((key: string, edit: ContactImportEntryEdit) => {
    setEntryEdits((current) => ({ ...current, [key]: edit }));
  }, []);

  const commitImport = useCallback(async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const entries: ContactImportEntryInput[] = preview.entries.map((entry) => {
        const key = importSelectionKey(entry.email, entry.status);
        const edit = entryEdits[key];
        const email = (edit?.email ?? entry.email).trim().toLowerCase();
        const action = selectionMap[key] ?? defaultActionForStatus(entry.status);
        return {
          email,
          name: edit?.name.trim() ?? entry.name,
          aliases: edit
            ? [...new Set(
              edit.aliases
                .map((alias) => alias.trim().toLowerCase())
                .filter((alias) => alias.length > 0 && alias !== email),
            )]
            : entry.aliases,
          vip: edit?.vip ?? entry.vip,
          action: action === 'skip' ? 'skip' : action,
        };
      });
      const summary = await invoke<ContactImportCommitSummary>(IPC.CommitContactImportEntries, {
        file_name: preview.file_name,
        entries,
        scope: 'global',
      });
      setPreview(null);
      setEntryEdits({});
      setCommitResult(summary);
      await refreshBatches();
      setStatus(`联系人导入完成：新增 ${summary.created}、合并 ${summary.merged}、跳过 ${summary.skipped}`);
    } catch (error) {
      setStatus(String(error));
    } finally {
      setImporting(false);
    }
  }, [preview, entryEdits, selectionMap, defaultActionForStatus, setStatus]);

  const cancelImport = useCallback(() => {
    setPreview(null);
    setSelectionMap({});
    setEntryEdits({});
  }, []);

  const refreshBatches = useCallback(async () => {
    try {
      const next = await invoke<ContactImportBatch[]>(IPC.ListContactImportBatches);
      setBatches(next);
    } catch {
      setBatches([]);
    }
  }, []);

  const undoBatch = useCallback(async (batchId: number) => {
    setUndoingBatchId(batchId);
    try {
      const report = await invoke<ContactImportUndoReport>(IPC.UndoContactImportBatch, { batchId });
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
    commitResult,
    selectionMap,
    setSelection,
    setAllSelection,
    entryEdits,
    setEntryEdit,
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

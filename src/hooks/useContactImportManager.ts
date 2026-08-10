import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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
  const [importError, setImportError] = useState<string | null>(null);
  const [batches, setBatches] = useState<ContactImportBatch[]>([]);
  const [undoingBatchId, setUndoingBatchId] = useState<number | null>(null);
  const [confirmUndoBatch, setConfirmUndoBatch] = useState<ContactImportBatch | null>(null);
  /**
   * 文件选择的 generation token：每次 startImport 与 cancelImport 都递增。
   * 旧的「选择文件 / 解析文件」Promise 在返回后必须校验 token，
   * 防止关闭弹窗或重新选择文件后，旧请求结果回写当前状态。
   */
  const importGenerationRef = useRef(0);

  const defaultActionForStatus = useCallback((status: string): 'create' | 'merge' | 'skip' => {
    if (status === 'merge') return 'merge';
    if (status === 'duplicate' || status === 'invalid') return 'skip';
    return 'create';
  }, []);

  const startImport = useCallback(async () => {
    const generation = importGenerationRef.current + 1;
    importGenerationRef.current = generation;
    setPreviewing(true);
    setImportError(null);
    // A fresh file starts a fresh session. In particular, do not keep the
    // previous success summary around when the user imports another file.
    setPreview(null);
    setCommitResult(null);
    setSelectionMap({});
    setEntryEdits({});
    try {
      const path = await invoke<string | null>(IPC.PickContactImportFile);
      if (importGenerationRef.current !== generation) return;
      if (!path) {
        setStatus('已取消选择联系人导入文件');
        return;
      }
      const nextPreview = await invoke<ContactImportPreview>(IPC.PreviewContactImport, { path });
      if (importGenerationRef.current !== generation) return;
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
      if (importGenerationRef.current !== generation) return;
      // 解析失败、空文件、格式错误、超过大小限制等都在当前可见对话框内
      // 显示明确错误，并提供重试（重新选择文件）入口。
      const message = (error instanceof Error ? error.message : String(error))
        .replace(/^Error:\s*/i, '')
        .trim();
      setImportError(message || '无法读取联系人文件，请检查文件格式后重试。');
      setStatus(message || '联系人文件解析失败，请在导入对话框内重试。');
    } finally {
      if (importGenerationRef.current === generation) {
        setPreviewing(false);
      }
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
    setImportError(null);
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
      const message = (error instanceof Error ? error.message : String(error))
        .replace(/^Error:\s*/i, '')
        .trim();
      setImportError(message || '联系人导入失败，请重试。');
      setStatus(message || '联系人导入失败，请在导入对话框内重试。');
    } finally {
      setImporting(false);
    }
  }, [preview, entryEdits, selectionMap, defaultActionForStatus, setStatus]);

  const cancelImport = useCallback(() => {
    // 使进行中的选择/预览请求全部失效，防止旧 Promise 回写状态。
    importGenerationRef.current += 1;
    setPreviewing(false);
    setPreview(null);
    setCommitResult(null);
    setSelectionMap({});
    setEntryEdits({});
    setImportError(null);
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
    importError,
    setImportError,
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

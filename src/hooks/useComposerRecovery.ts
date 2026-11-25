import { useCallback, useEffect, useRef, useState } from 'react';
import { isDraftEmpty, loadComposerAutosave, parseComposerAutosave } from '../app/composerConfig';
import { composerAutosaveStorageKey } from '../app/storageConfig';
import type { ComposerAutosave, DraftInput, PendingAttachmentRecovery } from '../app/types';
import { normalizePendingAttachments } from '../app/attachmentImports';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';

const SAVE_DELAY_MS = 800;
type RecoveryRecord = { revision: number; payload: unknown };

export default function useComposerRecovery(
  draft: DraftInput,
  isRichComposer: boolean,
  enabled: boolean,
  onError: (message: string) => void,
  pendingAttachments: readonly PendingAttachmentRecovery[] = [],
  recoveryAccountId = draft.account_id,
  recoveryId = '',
) {
  // Progress ticks must not restart the draft debounce or serialize its body.
  const normalizedPending = normalizePendingAttachments(pendingAttachments);
  const pendingRef = useRef<PendingAttachmentRecovery[]>(normalizedPending);
  if (normalizedPending.length !== pendingRef.current.length || normalizedPending.some((item, index) => {
    const previous = pendingRef.current[index];
    return !previous || item.filename !== previous.filename || item.size_bytes !== previous.size_bytes
      || item.is_inline !== previous.is_inline || item.selection_unknown !== previous.selection_unknown;
  })) pendingRef.current = normalizedPending;
  const pending = pendingRef.current;
  const [composerAutosave, setComposerAutosave] = useState<ComposerAutosave | null>(loadComposerAutosave);
  const [retryVersion, setRetryVersion] = useState(0);
  const mounted = useRef(false);
  const revision = useRef(0);
  const generation = useRef(0);
  const clearVersion = useRef(0);
  const hasLocalEdits = useRef(false);
  const hadEditableContent = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const ready = useRef<Promise<void>>(Promise.resolve());
  const flush = useRef<(() => void) | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const richComposerRef = useRef(isRichComposer);
  richComposerRef.current = isRichComposer;

  const nextRevision = useCallback(() => {
    revision.current = Math.max(revision.current + 1, Date.now() * 1000);
    return revision.current;
  }, []);

  useEffect(() => {
    mounted.current = true;
    ready.current = Promise.resolve(invoke<RecoveryRecord>(IPC.LoadComposerRecovery)).then((record) => {
      if (!record || !Number.isSafeInteger(record.revision)) return;
      revision.current = Math.max(revision.current, record.revision);
      if (!mounted.current || hasLocalEdits.current) return;
      if (record.revision > 0) {
        setComposerAutosave(parseComposerAutosave(record.payload));
      }
    }).catch((error: unknown) => {
      if (mounted.current) onErrorRef.current(`草稿恢复失败，请保留当前编辑内容：${String(error)}`);
    });
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flush.current?.();
    };
    const handlePageHide = () => flush.current?.();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      flush.current?.();
      mounted.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    const empty = isDraftEmpty(draft) && pending.length === 0;
    if (!enabled || (empty && !hadEditableContent.current)) {
      if (!enabled) hadEditableContent.current = false;
      flush.current = null;
      return;
    }
    if (!empty) hadEditableContent.current = true;
    hasLocalEdits.current = true;
    let started = false;
    let timer: number | null = null;
    setComposerAutosave((previous) => ({
      draft, isRichComposer, saved_at: previous?.saved_at ?? '', save_state: 'saving',
      ...(pending.length ? { pending_attachments: pending } : {}),
    }));
    const persist = () => {
      if (started || currentGeneration !== generation.current) return;
      started = true;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      queue.current = queue.current.then(async () => {
        await ready.current;
        if (currentGeneration !== generation.current) return;
        const snapshot: ComposerAutosave = { draft, recovery_account_id: recoveryAccountId, recovery_id: recoveryId, isRichComposer, saved_at: new Date().toISOString(),
          ...(pending.length ? { pending_attachments: pending } : {}) };
        const payloadJson = empty ? null : JSON.stringify(snapshot);
        const accepted = empty
          ? await invoke<boolean>(IPC.ClearComposerRecovery, { accountId: recoveryAccountId, draftId: draft.draft_id, recoveryId, revision: nextRevision() })
          : await invoke<boolean>(IPC.SaveComposerRecovery, { payloadJson, revision: nextRevision() });
        if (!accepted) throw new Error('检测到更新的草稿，未覆盖；请手动保存当前内容。');
        if (currentGeneration !== generation.current) return;
        try {
          if (payloadJson === null) window.localStorage.removeItem(composerAutosaveStorageKey);
          else window.localStorage.setItem(composerAutosaveStorageKey, payloadJson);
        } catch {
          // The database acknowledgement remains the source of truth.
        }
        if (empty) hadEditableContent.current = false;
        if (mounted.current && currentGeneration === generation.current) {
          setComposerAutosave(empty ? null : { ...snapshot, save_state: 'saved' });
        }
      }).catch((error: unknown) => {
        if (!mounted.current || currentGeneration !== generation.current) return;
        setComposerAutosave((previous) => ({
          draft, isRichComposer, saved_at: previous?.saved_at ?? '',
          save_state: 'error', save_error: String(error),
          ...(pending.length ? { pending_attachments: pending } : {}),
        }));
      });
    };
    timer = window.setTimeout(persist, SAVE_DELAY_MS);
    flush.current = persist;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      if (flush.current === persist) flush.current = null;
    };
  }, [draft, isRichComposer, enabled, retryVersion, nextRevision, pending, recoveryAccountId, recoveryId]);

  const readRecovery = useCallback(async (accountId: number | null, draftId: number | null) => {
    // Finish an explicit discard or pending submission before opening the same scope.
    await queue.current;
    const record = await invoke<RecoveryRecord>(IPC.LoadComposerRecovery, { accountId, draftId });
    if (record?.revision > 0) revision.current = Math.max(revision.current, record.revision);
    const checkpoint = record?.revision > 0 ? parseComposerAutosave(record.payload) : loadComposerAutosave();
    if (!checkpoint || (draftId !== null && checkpoint.draft.draft_id !== draftId)) return null;
    const owner = checkpoint.recovery_account_id ?? checkpoint.draft.account_id;
    return accountId === null || owner === accountId ? checkpoint : null;
  }, []);

  const ensureComposerRecovery = useCallback((draftSnapshot: DraftInput): Promise<void> => {
    // Submission flushes the editor synchronously, before React may render that
    // snapshot. Persist the explicit argument, never the previous render's draft.
    const currentGeneration = ++generation.current;
    const currentClearVersion = clearVersion.current;
    const snapshot: ComposerAutosave = {
      draft: draftSnapshot, recovery_account_id: recoveryAccountId, recovery_id: recoveryId,
      isRichComposer: richComposerRef.current,
      saved_at: new Date().toISOString(),
      ...(pendingRef.current.length ? { pending_attachments: pendingRef.current } : {}),
    };
    hasLocalEdits.current = true;
    hadEditableContent.current = true;
    flush.current = null;
    if (mounted.current) setComposerAutosave({ ...snapshot, save_state: 'saving' });
    const operation = queue.current.then(async () => {
      await ready.current;
      if (currentClearVersion !== clearVersion.current) throw new Error('草稿已清除，请重新确认当前内容。');
      const payloadJson = JSON.stringify(snapshot);
      const accepted = await invoke<boolean>(IPC.SaveComposerRecovery, { payloadJson, revision: nextRevision() });
      if (!accepted) throw new Error('检测到更新的草稿，未覆盖；请手动保存当前内容。');
      if (currentClearVersion !== clearVersion.current) throw new Error('草稿已清除，请重新确认当前内容。');
      // An editor-flush render may advance generation while this write waits.
      // It must not cancel persistence or falsely acknowledge newer UI content.
      if (currentGeneration !== generation.current) return;
      try {
        window.localStorage.setItem(composerAutosaveStorageKey, payloadJson);
      } catch {
        // The database acknowledgement remains the source of truth.
      }
      if (mounted.current) setComposerAutosave({ ...snapshot, save_state: 'saved' });
    }).catch((error: unknown) => {
      if (mounted.current && currentGeneration === generation.current) {
        setComposerAutosave({ ...snapshot, save_state: 'error', save_error: String(error) });
      }
      throw error;
    });
    // Keep later autosaves usable after failure, but submission receives the
    // rejecting promise and must not proceed without the database acknowledgement.
    queue.current = operation.catch(() => undefined);
    return operation;
  }, [nextRevision, recoveryAccountId, recoveryId]);

  const clearComposerAutosave = useCallback(() => {
    generation.current += 1;
    clearVersion.current += 1;
    hadEditableContent.current = false;
    hasLocalEdits.current = true;
    flush.current = null;
    setComposerAutosave(null);
    try {
      window.localStorage.removeItem(composerAutosaveStorageKey);
    } catch {
      // A persisted tombstone prevents a legacy cache from restoring a cleared draft.
    }
    queue.current = queue.current.then(async () => {
      await ready.current;
      const cleared = await invoke<boolean>(IPC.ClearComposerRecovery, { accountId: recoveryAccountId, draftId: draft.draft_id, recoveryId, revision: nextRevision() });
      if (!cleared) throw new Error('检测到更新的草稿，未清除。');
    }).catch((error: unknown) => {
      if (mounted.current) onErrorRef.current(`草稿清理失败：${String(error)}`);
    });
  }, [nextRevision, recoveryAccountId, recoveryId, draft.draft_id]);

  const retryComposerAutosave = useCallback(() => setRetryVersion((value) => value + 1), []);
  return { composerAutosave, setComposerAutosave, clearComposerAutosave, retryComposerAutosave, ensureComposerRecovery, readRecovery };
}

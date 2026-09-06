import { useCallback, useEffect, useRef, useState } from 'react';
import { isDraftEmpty, loadComposerAutosave, parseComposerAutosave } from '../app/composerConfig';
import { composerAutosaveStorageKey } from '../app/storageConfig';
import type { ComposerAutosave, DraftInput } from '../app/types';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';

const SAVE_DELAY_MS = 800;
type RecoveryRecord = { revision: number; payload: unknown };

export default function useComposerRecovery(
  draft: DraftInput,
  isRichComposer: boolean,
  enabled: boolean,
  onError: (message: string) => void,
) {
  const [composerAutosave, setComposerAutosave] = useState<ComposerAutosave | null>(loadComposerAutosave);
  const [retryVersion, setRetryVersion] = useState(0);
  const mounted = useRef(false);
  const revision = useRef(0);
  const generation = useRef(0);
  const hasLocalEdits = useRef(false);
  const hadEditableContent = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const ready = useRef<Promise<void>>(Promise.resolve());
  const flush = useRef<(() => void) | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

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
      if (mounted.current) onErrorRef.current(`恢复点读取失败，请保留编辑内容：${String(error)}`);
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
    const empty = isDraftEmpty(draft);
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
    }));
    const persist = () => {
      if (started || currentGeneration !== generation.current) return;
      started = true;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      queue.current = queue.current.then(async () => {
        await ready.current;
        if (currentGeneration !== generation.current) return;
        const snapshot: ComposerAutosave = { draft, isRichComposer, saved_at: new Date().toISOString() };
        const payloadJson = empty ? null : JSON.stringify(snapshot);
        const accepted = empty
          ? await invoke<boolean>(IPC.ClearComposerRecovery, { revision: nextRevision() })
          : await invoke<boolean>(IPC.SaveComposerRecovery, { payloadJson, revision: nextRevision() });
        if (!accepted) throw new Error('存在更新的恢复点，未覆盖；请手动保存当前草稿。');
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
        }));
      });
    };
    timer = window.setTimeout(persist, SAVE_DELAY_MS);
    flush.current = persist;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      if (flush.current === persist) flush.current = null;
    };
  }, [draft, isRichComposer, enabled, retryVersion, nextRevision]);

  const clearComposerAutosave = useCallback(() => {
    generation.current += 1;
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
      const cleared = await invoke<boolean>(IPC.ClearComposerRecovery, { revision: nextRevision() });
      if (!cleared) throw new Error('存在更新的恢复点，未清除。');
    }).catch((error: unknown) => {
      if (mounted.current) onErrorRef.current(`恢复点清理失败，请勿重复发送旧恢复点：${String(error)}`);
    });
  }, [nextRevision]);

  const retryComposerAutosave = useCallback(() => setRetryVersion((value) => value + 1), []);
  return { composerAutosave, setComposerAutosave, clearComposerAutosave, retryComposerAutosave };
}

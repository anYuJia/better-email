import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

const STORAGE_PREFIX = 'better-email.quickReply.v1.';
const MAX_CACHED_REPLIES = 20;
export type QuickReplySnapshot = { key: string; body: string; revision: string };
type Entry = QuickReplySnapshot & { error: string | null; persistedRevision: string };

function trimReplyCache(entries: Map<string, Entry>, activeKey: string) {
  for (const [key, entry] of entries) {
    if (entries.size <= MAX_CACHED_REPLIES) break;
    // Failed writes may be the only surviving copy. They must stay available
    // for retry even after the reader has moved far away from this message.
    if (key !== activeKey && !entry.error) entries.delete(key);
  }
}

/** Each message owns its own recovery record; a send only consumes its snapshot. */
export default function useQuickReplyDraft(
  accountId: number | null,
  messageId: number | null,
  onError: (message: string) => void,
) {
  const key = `${accountId ?? 0}:${messageId ?? 0}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const entries = useRef(new Map<string, Entry>());
  const [, update] = useState(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  if (!entries.current.has(key)) {
    let body = '';
    let revision = '';
    let error: string | null = null;
    try {
      const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (!parsed || typeof parsed !== 'object'
          || !('body' in parsed) || typeof parsed.body !== 'string'
          || !('revision' in parsed) || typeof parsed.revision !== 'string') {
          throw new Error('本机记录格式无效');
        }
        body = parsed.body;
        revision = parsed.revision;
      }
    } catch (cause) {
      error = `快速回复读取失败：${String(cause)}。请保留当前内容。`;
    }
    entries.current.set(key, { key, body, revision, error, persistedRevision: revision });
  }
  const entry = entries.current.get(key)!;
  entries.current.delete(key);
  entries.current.set(key, entry);
  trimReplyCache(entries.current, key);

  const persist = useCallback((next: Entry, sent = false) => {
    try {
      // Empty records are tombstones, so a completed send cannot restore an old
      // reply merely because another window still holds an older snapshot.
      window.localStorage.setItem(`${STORAGE_PREFIX}${next.key}`, JSON.stringify({
        body: next.body, revision: next.revision,
      }));
      next.error = null;
      next.persistedRevision = next.revision;
    } catch (cause) {
      next.error = sent
        ? `邮件已提交，但快速回复恢复点清理失败，请勿重复发送。请重试保存：${String(cause)}`
        : `快速回复未能保存到本机，内容暂留当前窗口，请重试保存：${String(cause)}`;
      onErrorRef.current(next.error);
    }
    entries.current.set(next.key, next);
    trimReplyCache(entries.current, activeKey.current);
    update((value) => value + 1);
  }, []);

  const setQuickReplyBody: Dispatch<SetStateAction<string>> = useCallback((value) => {
    const current = entries.current.get(key)!;
    const body = typeof value === 'function' ? value(current.body) : value;
    if (body === current.body) return;
    persist({ ...current, key, body, revision: crypto.randomUUID(), error: null });
  }, [key, persist]);

  const getQuickReplySnapshot = useCallback((): QuickReplySnapshot => {
    const current = entries.current.get(activeKey.current)!;
    return { key: current.key, body: current.body, revision: current.revision };
  }, []);

  const clearSubmittedQuickReply = useCallback((snapshot: QuickReplySnapshot) => {
    // A slow send can complete after this message leaves the small in-memory
    // cache. Its persisted revision still needs to be checked and consumed.
    const current = entries.current.get(snapshot.key)
      ?? { ...snapshot, error: null, persistedRevision: snapshot.revision };
    if (current.revision !== snapshot.revision) return;
    try {
      const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${snapshot.key}`);
      if (stored) {
        const parsed = JSON.parse(stored) as QuickReplySnapshot;
        if (parsed.revision !== snapshot.revision && parsed.revision !== current.persistedRevision) {
          // Another window has changed this reply. Preserve its newer text.
          if (typeof parsed.body === 'string' && typeof parsed.revision === 'string') {
            entries.current.set(snapshot.key, { key: snapshot.key, body: parsed.body, revision: parsed.revision, error: null, persistedRevision: parsed.revision });
            trimReplyCache(entries.current, activeKey.current);
            update((value) => value + 1);
            return;
          }
        }
      }
    } catch {
      // The write below reports storage failures without turning send success
      // into a retryable send failure.
    }
    persist({ ...current, key: snapshot.key, body: '', revision: crypto.randomUUID(), error: null }, true);
  }, [persist]);

  const retryQuickReplySave = useCallback(() => {
    // Retry all failed records, including a reply whose message was navigated
    // away from, so failure recovery does not require finding that message.
    for (const current of entries.current.values()) {
      if (current.error) persist({ ...current });
    }
  }, [persist]);

  useEffect(() => {
    if (entry.error) onErrorRef.current(entry.error);
  }, [key, entry.error]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(STORAGE_PREFIX) || !event.newValue) return;
      const changedKey = event.key.slice(STORAGE_PREFIX.length);
      const current = entries.current.get(changedKey);
      // A separate composer can consume this source. Reflect its tombstone,
      // but never replace a local edit whose only surviving copy is in memory.
      if (!current || current.error) return;
      try {
        if (window.localStorage.getItem(event.key) !== event.newValue) return;
        const parsed = JSON.parse(event.newValue) as Partial<QuickReplySnapshot>;
        if (typeof parsed.body !== 'string' || typeof parsed.revision !== 'string') return;
        if (parsed.revision === current.revision) return;
        entries.current.set(changedKey, { key: changedKey, body: parsed.body, revision: parsed.revision,
          persistedRevision: parsed.revision, error: null });
        update((value) => value + 1);
      } catch { /* Keep the last known draft when another window writes invalid data. */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (![...entries.current.values()].some((record) => record.error)) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  return {
    quickReplyBody: entry.body,
    setQuickReplyBody,
    getQuickReplySnapshot,
    clearSubmittedQuickReply,
    quickReplySaveError: entry.error ?? [...entries.current.values()].find((record) => record.error)?.error ?? null,
    retryQuickReplySave,
  };
}

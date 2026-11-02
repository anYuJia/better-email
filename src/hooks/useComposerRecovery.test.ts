import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft, parseComposerAutosave } from '../app/composerConfig';
import { composerAutosaveStorageKey } from '../app/storageConfig';
import { IPC } from '../ipc/commands';
import { invoke } from '../tauriBridge';
import useComposerRecovery from './useComposerRecovery';

vi.mock('../tauriBridge', () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
const draft = { ...emptyDraft, account_id: 1, subject: 'Subject', body: 'Original body' };

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (command) => command === IPC.LoadComposerRecovery
    ? { revision: 0, payload: null }
    : true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function advance(ms = 800) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe('durable composer recovery', () => {
  it('debounces serialization and stores only the latest edited body', async () => {
    const { result, rerender } = renderHook(({ value }) => useComposerRecovery(value, true, true, vi.fn()), {
      initialProps: { value: draft },
    });
    const stringify = vi.spyOn(JSON, 'stringify');
    rerender({ value: { ...draft, body: 'Second body' } });
    rerender({ value: { ...draft, body: 'Newest body' } });
    expect(stringify).not.toHaveBeenCalled();
    expect(result.current.composerAutosave?.save_state).toBe('saving');
    await advance();
    const writes = mockInvoke.mock.calls.filter(([command]) => command === IPC.SaveComposerRecovery);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.payloadJson)).draft.body).toBe('Newest body');
    expect(result.current.composerAutosave?.save_state).toBe('saved');
  });

  it('shows a persistent save failure and supports an explicit retry', async () => {
    let fail = true;
    mockInvoke.mockImplementation(async (command) => {
      if (command === IPC.LoadComposerRecovery) return { revision: 0, payload: null };
      if (command === IPC.SaveComposerRecovery && fail) throw new Error('database full');
      return true;
    });
    const { result } = renderHook(() => useComposerRecovery(draft, true, true, vi.fn()));
    await advance();
    expect(result.current.composerAutosave?.save_state).toBe('error');
    expect(result.current.composerAutosave?.save_error).toContain('database full');
    expect(result.current.composerAutosave?.draft.body).toBe(draft.body);
    fail = false;
    act(() => result.current.retryComposerAutosave());
    await advance();
    expect(result.current.composerAutosave?.save_state).toBe('saved');
  });

  it('does not report a successful database save as failed when the legacy cache is full', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = renderHook(() => useComposerRecovery(draft, true, true, vi.fn()));
    await advance();
    expect(result.current.composerAutosave?.save_state).toBe('saved');
  });

  it('loads a database checkpoint and honours a tombstone over the legacy cache', async () => {
    localStorage.setItem(composerAutosaveStorageKey, JSON.stringify({ draft, saved_at: '2026-09-06T10:00:00Z', isRichComposer: true }));
    mockInvoke.mockResolvedValue({ revision: 15, payload: null });
    const { result } = renderHook(() => useComposerRecovery(emptyDraft, true, false, vi.fn()));
    await advance(0);
    expect(result.current.composerAutosave).toBeNull();
  });

  it('does not overwrite active edits when checkpoint loading finishes late', async () => {
    let resolve!: (record: unknown) => void;
    mockInvoke.mockImplementation(() => new Promise((accept) => { resolve = accept; }));
    const { result } = renderHook(() => useComposerRecovery(draft, true, true, vi.fn()));
    await act(async () => resolve({ revision: 20, payload: { draft: { ...draft, body: 'Old body' }, saved_at: '', isRichComposer: true } }));
    expect(result.current.composerAutosave?.draft.body).toBe('Original body');
  });

  it('clearing cancels a queued save and persists a monotonic tombstone', async () => {
    const { result } = renderHook(() => useComposerRecovery(draft, true, true, vi.fn()));
    act(() => result.current.clearComposerAutosave());
    await advance(1000);
    expect(mockInvoke.mock.calls.filter(([command]) => command === IPC.SaveComposerRecovery)).toHaveLength(0);
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ClearComposerRecovery, { revision: expect.any(Number) });
    expect(result.current.composerAutosave).toBeNull();
  });

  it('never labels a stale acknowledgement as a save of the newer edit', async () => {
    let resolve!: (accepted: boolean) => void;
    mockInvoke.mockImplementation(async (command) => {
      if (command === IPC.LoadComposerRecovery) return { revision: 0, payload: null };
      return new Promise<boolean>((accept) => { resolve = accept; });
    });
    const { result, rerender } = renderHook(({ value }) => useComposerRecovery(value, true, true, vi.fn()), { initialProps: { value: draft } });
    await advance();
    rerender({ value: { ...draft, body: 'New unsaved edit' } });
    await act(async () => resolve(true));
    expect(result.current.composerAutosave?.save_state).toBe('saving');
    expect(result.current.composerAutosave?.draft.body).toBe('New unsaved edit');
  });

  it('flushes pending edits on pagehide instead of waiting for the debounce timer', async () => {
    renderHook(() => useComposerRecovery(draft, true, true, vi.fn()));
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SaveComposerRecovery, expect.anything());
  });
  it('removes a previous checkpoint when all edited content is deliberately erased', async () => {
    const { result, rerender } = renderHook(({ value }) => useComposerRecovery(value, true, true, vi.fn()), { initialProps: { value: draft } });
    await advance();
    rerender({ value: { ...draft, subject: '', body: '' } });
    await advance();
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ClearComposerRecovery, expect.anything());
    expect(result.current.composerAutosave).toBeNull();
    expect(localStorage.getItem(composerAutosaveStorageKey)).toBeNull();
  });

  it('never erases a stored recovery just because a fresh empty composer opens', async () => {
    const stored = { draft, saved_at: '2026-09-06T10:00:00Z', isRichComposer: true };
    mockInvoke.mockResolvedValue({ revision: 10, payload: stored });
    const { result } = renderHook(() => useComposerRecovery(emptyDraft, true, true, vi.fn()));
    await advance(1000);
    expect(result.current.composerAutosave?.draft.body).toBe(draft.body);
    expect(mockInvoke).not.toHaveBeenCalledWith(IPC.ClearComposerRecovery, expect.anything());
  });

  it('does not resurrect a cleared legacy cache when a pending save finishes', async () => {
    let resolve!: (accepted: boolean) => void;
    mockInvoke.mockImplementation(async (command) => {
      if (command === IPC.LoadComposerRecovery) return { revision: 0, payload: null };
      if (command === IPC.SaveComposerRecovery) return new Promise<boolean>((accept) => { resolve = accept; });
      return true;
    });
    const { result } = renderHook(() => useComposerRecovery(draft, true, true, vi.fn()));
    await advance();
    act(() => result.current.clearComposerAutosave());
    await act(async () => resolve(true));
    expect(result.current.composerAutosave).toBeNull();
    expect(localStorage.getItem(composerAutosaveStorageKey)).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ClearComposerRecovery, expect.anything());
  });

  it('retries a failed empty-draft tombstone instead of skipping the cleared content', async () => {
    let fail = true;
    mockInvoke.mockImplementation(async (command) => {
      if (command === IPC.LoadComposerRecovery) return { revision: 0, payload: null };
      if (command === IPC.ClearComposerRecovery && fail) throw new Error('database full');
      return true;
    });
    const { result, rerender } = renderHook(({ value }) => useComposerRecovery(value, true, true, vi.fn()), { initialProps: { value: draft } });
    await advance();
    rerender({ value: { ...draft, subject: '', body: '' } });
    await advance();
    expect(result.current.composerAutosave?.save_state).toBe('error');
    fail = false;
    act(() => result.current.retryComposerAutosave());
    await advance();
    expect(mockInvoke.mock.calls.filter(([command]) => command === IPC.ClearComposerRecovery)).toHaveLength(2);
    expect(result.current.composerAutosave).toBeNull();
    expect(localStorage.getItem(composerAutosaveStorageKey)).toBeNull();
  });

  it('persists unresolved file metadata beside the draft and restores it after reloading', async () => {
    const pending = [{ filename: 'pending.pdf', size_bytes: 15, is_inline: false, local_path: '/not-persisted', file: 'not-persisted' }];
    const original = renderHook(() => useComposerRecovery(draft, true, true, vi.fn(), pending));
    await advance();
    const written = mockInvoke.mock.calls.find(([command]) => command === IPC.SaveComposerRecovery)!;
    const checkpoint = JSON.parse(String(written[1]?.payloadJson));
    expect(checkpoint.pending_attachments).toEqual([{ filename: 'pending.pdf', size_bytes: 15, is_inline: false }]);
    expect(checkpoint.draft).not.toHaveProperty('pending_attachments');
    original.unmount();
    localStorage.clear();
    mockInvoke.mockImplementation(async command => command === IPC.LoadComposerRecovery ? { revision: 20, payload: checkpoint } : true);
    const restored = renderHook(() => useComposerRecovery(emptyDraft, true, false, vi.fn()));
    await advance(0);
    expect(restored.result.current.composerAutosave?.pending_attachments).toEqual(checkpoint.pending_attachments);
    expect(parseComposerAutosave(checkpoint)?.pending_attachments).toEqual(checkpoint.pending_attachments);
  });

  it('saves a file-only pending intent and clears its checkpoint after explicit removal', async () => {
    const pending = [{ filename: 'report.pdf', size_bytes: 10, is_inline: false }];
    const { rerender } = renderHook(({ files }) => useComposerRecovery(emptyDraft, true, true, vi.fn(), files), { initialProps: { files: pending } });
    await advance();
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SaveComposerRecovery, expect.objectContaining({ payloadJson: expect.stringContaining('report.pdf') }));
    rerender({ files: [] });
    await advance();
    expect(mockInvoke).toHaveBeenCalledWith(IPC.ClearComposerRecovery, expect.anything());
  });

  it('does not restart checkpoint debounce for unchanged pending metadata references', async () => {
    const pending = [{ filename: 'report.pdf', size_bytes: 10, is_inline: false }];
    const { rerender } = renderHook(({ files }) => useComposerRecovery(draft, true, true, vi.fn(), files), { initialProps: { files: pending } });
    await advance(400);
    rerender({ files: pending.map(file => ({ ...file })) });
    await advance(400);
    expect(mockInvoke.mock.calls.filter(([command]) => command === IPC.SaveComposerRecovery)).toHaveLength(1);
  });

  it('immediately persists the explicit submission snapshot and pending metadata before the debounce', async () => {
    const pending = [{ filename: 'pending.pdf', size_bytes: 15, is_inline: false }];
    const { result } = renderHook(() => useComposerRecovery(draft, true, true, vi.fn(), pending));
    const snapshot = { ...draft, body: 'Last editor DOM input', attachments: [{ filename: 'new.txt', mime_type: 'text/plain', size_bytes: 2, local_path: '/temp/new.txt' }] };
    await act(async () => result.current.ensureComposerRecovery(snapshot));
    const writes = mockInvoke.mock.calls.filter(([command]) => command === IPC.SaveComposerRecovery);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.payloadJson))).toMatchObject({ draft: snapshot, pending_attachments: pending });
    expect(result.current.composerAutosave?.save_state).toBe('saved');
    await advance();
    expect(mockInvoke.mock.calls.filter(([command]) => command === IPC.SaveComposerRecovery)).toHaveLength(1);
  });

  it('does not let the editor flush render cancel a submission checkpoint waiting for initial loading', async () => {
    let finishLoad!: (value: unknown) => void;
    mockInvoke.mockImplementation(async command => command === IPC.LoadComposerRecovery
      ? new Promise(resolve => { finishLoad = resolve; }) : true);
    const { result, rerender } = renderHook(({ value }) => useComposerRecovery(value, true, true, vi.fn()), { initialProps: { value: draft } });
    const latest = { ...draft, body: 'Flushed body' };
    let ensured!: Promise<void>;
    act(() => { ensured = result.current.ensureComposerRecovery(latest); });
    rerender({ value: latest });
    await act(async () => { finishLoad({ revision: 20, payload: null }); await ensured; });
    expect(mockInvoke).toHaveBeenCalledWith(IPC.SaveComposerRecovery, expect.objectContaining({ payloadJson: expect.stringContaining('Flushed body') }));
    await advance();
    expect(mockInvoke.mock.calls.filter(([command]) => command === IPC.SaveComposerRecovery)
      .every(([, args]) => JSON.parse(String(args?.payloadJson)).draft.body === 'Flushed body')).toBe(true);
  });

  it('serializes an in-flight autosave before the forced checkpoint and rejects no newer content', async () => {
    let finishFirst!: (accepted: boolean) => void;
    let writes = 0;
    mockInvoke.mockImplementation(async command => {
      if (command === IPC.LoadComposerRecovery) return { revision: 0, payload: null };
      if (command === IPC.SaveComposerRecovery && ++writes === 1) return new Promise<boolean>(resolve => { finishFirst = resolve; });
      return true;
    });
    const { result, rerender } = renderHook(({ value }) => useComposerRecovery(value, true, true, vi.fn()), { initialProps: { value: draft } });
    await advance();
    let ensured!: Promise<void>;
    act(() => { ensured = result.current.ensureComposerRecovery({ ...draft, body: 'Submission snapshot' }); });
    rerender({ value: { ...draft, body: 'Later edit' } });
    await advance();
    expect(writes).toBe(1);
    await act(async () => { finishFirst(true); await ensured; });
    const records = mockInvoke.mock.calls.filter(([command]) => command === IPC.SaveComposerRecovery);
    expect(records.map(([, args]) => JSON.parse(String(args?.payloadJson)).draft.body)).toEqual(['Original body', 'Submission snapshot', 'Later edit']);
    expect(Number(records[1][1]?.revision)).toBeGreaterThan(Number(records[0][1]?.revision));
    expect(Number(records[2][1]?.revision)).toBeGreaterThan(Number(records[1][1]?.revision));
    expect(result.current.composerAutosave?.draft.body).toBe('Later edit');
  });

  it.each(['reject', 'conflict'] as const)('rejects a forced checkpoint on database %s and can retry it', async failure => {
    let fail = true;
    mockInvoke.mockImplementation(async command => {
      if (command === IPC.LoadComposerRecovery) return { revision: 0, payload: null };
      if (fail) {
        if (failure === 'reject') throw new Error('database full');
        return false;
      }
      return true;
    });
    const { result } = renderHook(() => useComposerRecovery(draft, true, true, vi.fn()));
    await act(async () => { await expect(result.current.ensureComposerRecovery(draft)).rejects.toThrow(); });
    expect(result.current.composerAutosave).toMatchObject({ draft, save_state: 'error' });
    fail = false;
    await act(async () => result.current.ensureComposerRecovery(draft));
    expect(result.current.composerAutosave?.save_state).toBe('saved');
  });

  it('does not acknowledge a forced checkpoint after the draft was explicitly discarded', async () => {
    let finishLoad!: (value: unknown) => void;
    mockInvoke.mockImplementation(async command => command === IPC.LoadComposerRecovery
      ? new Promise(resolve => { finishLoad = resolve; }) : true);
    const { result } = renderHook(() => useComposerRecovery(draft, true, true, vi.fn()));
    let ensured!: Promise<void>;
    act(() => { ensured = result.current.ensureComposerRecovery(draft); result.current.clearComposerAutosave(); });
    await act(async () => {
      const failure = expect(ensured).rejects.toThrow('已清除');
      finishLoad({ revision: 20, payload: null });
      await failure;
    });
    expect(mockInvoke.mock.calls.filter(([command]) => command === IPC.SaveComposerRecovery)).toHaveLength(0);
    expect(result.current.composerAutosave).toBeNull();
  });

});

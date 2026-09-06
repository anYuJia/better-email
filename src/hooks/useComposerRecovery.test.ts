import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from '../app/composerConfig';
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
});

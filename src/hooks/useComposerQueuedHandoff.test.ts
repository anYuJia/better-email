import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { listen } from '../tauriBridge';
import useComposerQueuedHandoff from './useComposerQueuedHandoff';

vi.mock('../tauriBridge', () => ({ COMPOSER_QUEUED_EVENT: 'composer-queued', listen: vi.fn() }));

describe('standalone composer handoff', () => {
  it('updates the main window queue and exposes an unexpired undo', async () => {
    let receive!: (event: { payload: unknown }) => void;
    vi.mocked(listen).mockImplementation(async (_event, handler) => { receive = handler as typeof receive; return () => {}; });
    const setOutbox = vi.fn();
    const setUndo = vi.fn();
    renderHook(() => useComposerQueuedHandoff(true, setOutbox, setUndo, vi.fn()));
    const item = { id: 7 };
    const undo = { outboxId: 7, expiresAt: new Date(Date.now() + 10_000).toISOString() };
    await act(async () => { receive({ payload: { item, undo } }); });
    expect(setOutbox.mock.calls[0][0]([{ id: 7 }, { id: 8 }])).toEqual([item, { id: 8 }]);
    expect(setUndo).toHaveBeenCalledWith(undo);
  });
});

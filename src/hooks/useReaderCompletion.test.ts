import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../app/types';
import useReaderCompletion from './useReaderCompletion';

const message: Message = {
  id: 1, account_id: 1, account_email: 'me@example.com', folder_id: 1, folder_role: 'inbox',
  sender_name: 'Ada', sender_email: 'ada@example.com', recipients: 'me@example.com', cc: '', bcc: '',
  subject: 'Reading boundary', snippet: '', body: 'Readable body', sanitized_html: '', security_warnings: [],
  received_at: '', is_read: false, is_starred: false, has_attachments: false, snoozed_until: '',
  labels: [], attachment_count: 0, remote_mailbox: 'INBOX', remote_uid: 1,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('reader completion boundaries', () => {
  it('keeps render readiness separate from scroll and timer completion while a body is unavailable', () => {
    const onReadComplete = vi.fn();
    const view = renderHook(({ allowed }) => useReaderCompletion({
      selected: message, selectedId: 1, readTriggerKey: 0, onReadComplete, canCompleteReading: allowed,
    }), { initialProps: { allowed: false } });
    view.result.current.readerRef.current = document.createElement('section');
    expect(view.result.current.isBodyRenderReady).toBe(true);
    act(() => { view.result.current.maybeCompleteReading(); vi.advanceTimersByTime(3000); });
    expect(onReadComplete).not.toHaveBeenCalled();
    view.rerender({ allowed: true });
    act(() => view.result.current.maybeCompleteReading());
    expect(onReadComplete).toHaveBeenCalledOnce();
    act(() => { view.result.current.maybeCompleteReading(); vi.advanceTimersByTime(3000); });
    expect(onReadComplete).toHaveBeenCalledOnce();
  });

  it('cancels elapsed reading time on reload/failure and starts a fresh interval on recovery', () => {
    const onReadComplete = vi.fn();
    const view = renderHook(({ allowed }) => useReaderCompletion({
      selected: message, selectedId: 1, readTriggerKey: 0, onReadComplete, canCompleteReading: allowed,
    }), { initialProps: { allowed: true } });
    act(() => vi.advanceTimersByTime(1500));
    view.rerender({ allowed: false });
    act(() => vi.advanceTimersByTime(5000));
    expect(onReadComplete).not.toHaveBeenCalled();
    view.rerender({ allowed: true });
    act(() => vi.advanceTimersByTime(1999));
    expect(onReadComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onReadComplete).toHaveBeenCalledWith(message);
  });

  it('cancels the old timer on selection changes and ignores details belonging to the previous selection', () => {
    const onReadComplete = vi.fn();
    const view = renderHook(({ selected, selectedId }) => useReaderCompletion({ selected, selectedId, readTriggerKey: 0, onReadComplete }), {
      initialProps: { selected: message, selectedId: 1 },
    });
    act(() => vi.advanceTimersByTime(1500));
    view.rerender({ selected: message, selectedId: 2 });
    view.result.current.readerRef.current = document.createElement('section');
    act(() => { view.result.current.maybeCompleteReading(); vi.advanceTimersByTime(3000); });
    expect(onReadComplete).not.toHaveBeenCalled();
    const next = { ...message, id: 2 };
    view.rerender({ selected: next, selectedId: 2 });
    act(() => vi.advanceTimersByTime(2000));
    expect(onReadComplete).toHaveBeenCalledOnce();
    expect(onReadComplete).toHaveBeenCalledWith(next);
  });
});

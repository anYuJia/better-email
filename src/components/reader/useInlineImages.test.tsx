import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import useInlineImages from './useInlineImages';
import { resolveCidInlineImages } from '../../app/inlineImages';
import type { Message } from '../../app/types';

vi.mock('../../app/inlineImages', () => ({
  resolveCidInlineImages: vi.fn(),
}));

function makeMessage(id: number): Message {
  return {
    id,
    account_id: 1,
    account_email: 'test@example.com',
    folder_id: 1,
    folder_role: 'inbox',
    sender_name: 'Sender',
    sender_email: 'sender@example.com',
    recipients: 'test@example.com',
    cc: '',
    bcc: '',
    subject: `Message ${id}`,
    snippet: '',
    body: '',
    // Whitespace keeps the real no-cached-body guard true. The resolver is
    // mocked below to model a delayed missing-CID discovery.
    sanitized_html: ' ',
    security_warnings: [],
    received_at: '2026-01-01T00:00:00Z',
    is_read: false,
    is_starred: false,
    has_attachments: false,
    snoozed_until: '',
    labels: [],
    attachment_count: 0,
    remote_mailbox: 'INBOX',
    remote_uid: id,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useInlineImages body refresh ownership', () => {
  beforeEach(() => {
    vi.mocked(resolveCidInlineImages).mockReturnValue({
      html: '',
      referencedContentIds: ['missing@example.com'],
      resolvedContentIds: [],
      pendingAttachments: [],
      missingContentIds: ['missing@example.com'],
    });
  });

  afterEach(() => cleanup());

  it('ignores an old message body refresh failure after the user selects another message', async () => {
    const firstRequest = deferred();
    const secondRequest = deferred();
    const onFetchBody = vi.fn()
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    const { result, rerender } = renderHook(
      ({ selected }: { selected: Message | null }) => {
        const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
        return useInlineImages({
          selected,
          attachments: [],
          attachmentErrors,
          setAttachmentErrors,
          onFetchBody,
          handleAttachmentDownload: async () => null,
        });
      },
      { initialProps: { selected: makeMessage(1) } },
    );

    await waitFor(() => expect(onFetchBody).toHaveBeenCalledTimes(1));
    expect(result.current.isRefreshingInlineImages).toBe(true);

    rerender({ selected: makeMessage(2) });
    await waitFor(() => expect(onFetchBody).toHaveBeenCalledTimes(2));
    expect(result.current.isRefreshingInlineImages).toBe(true);

    await act(async () => {
      firstRequest.reject(new Error('旧邮件读取失败'));
      await firstRequest.promise.catch(() => undefined);
    });

    // A 的失败既不能显示在 B 上，也不能停止 B 的刷新状态。
    expect(result.current.inlineImageRefreshError).toBe('');
    expect(result.current.isRefreshingInlineImages).toBe(true);

    await act(async () => {
      secondRequest.resolve();
      await secondRequest.promise;
    });

    await waitFor(() => expect(result.current.isRefreshingInlineImages).toBe(false));
  });
});

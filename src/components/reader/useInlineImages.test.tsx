import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import useInlineImages from './useInlineImages';
import { resolveCidInlineImages } from '../../app/inlineImages';
import { invoke, localFileAssetUrl } from '../../tauriBridge';
import type { Attachment, Message } from '../../app/types';

vi.mock('../../tauriBridge', () => ({ invoke: vi.fn(), localFileAssetUrl: vi.fn() }));

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

describe('parallel CID URL resolution ownership', () => {
  function pendingUrl() {
    let resolve!: (value: string) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  function attachment(id: number): Attachment {
    return {
      id, message_id: 1, filename: `${id}.png`, mime_type: 'image/png',
      size_bytes: 120, content_id: `${id}@inline`, is_inline: true,
      is_downloaded: true, local_path: `/tmp/${id}.png`,
    } as Attachment;
  }

  function setup(ids = [1, 2]) {
    const setAttachmentErrors = vi.fn();
    const hook = renderHook(({ messageId, accountId, imageIds }) => useInlineImages({
      selected: {
        ...makeMessage(messageId), account_id: accountId,
        sanitized_html: imageIds.map((id) => `<img src="cid:${id}@inline">`).join(''),
      },
      attachments: imageIds.map(attachment), attachmentErrors: {}, setAttachmentErrors,
      onFetchBody: vi.fn(), handleAttachmentDownload: vi.fn().mockResolvedValue(null),
    }), { initialProps: { messageId: 1, accountId: 1, imageIds: ids } });
    return { ...hook, setAttachmentErrors };
  }

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('../../app/inlineImages')>('../../app/inlineImages');
    vi.mocked(resolveCidInlineImages).mockImplementation(actual.resolveCidInlineImages);
    vi.mocked(localFileAssetUrl).mockReset().mockResolvedValue('');
    vi.mocked(invoke).mockReset();
  });

  afterEach(() => cleanup());

  it('keeps both fallback images when the first completion rerenders the same message', async () => {
    const first = pendingUrl();
    const second = pendingUrl();
    vi.mocked(invoke).mockImplementation((_command, args) => (
      args?.attachmentId === 1 ? first.promise : second.promise
    ) as never);
    const { result } = setup();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await act(async () => { first.resolve('data:image/png;base64,first'); await first.promise; });
    expect(result.current.inlineImageResolution.resolvedContentIds).toEqual(['1@inline']);
    await act(async () => { second.resolve('data:image/png;base64,second'); await second.promise; });
    expect(result.current.inlineImageResolution.resolvedContentIds).toEqual(['1@inline', '2@inline']);
    expect(localFileAssetUrl).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('does not cancel an in-flight fallback when a sibling asset URL finishes', async () => {
    const asset = pendingUrl();
    const fallback = pendingUrl();
    vi.mocked(localFileAssetUrl).mockImplementation((path) => path === '/tmp/1.png' ? asset.promise : Promise.resolve(''));
    vi.mocked(invoke).mockReturnValue(fallback.promise as never);
    const { result } = setup();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await act(async () => { asset.resolve('asset://first'); await asset.promise; });
    await act(async () => { fallback.resolve('data:image/png;base64,second'); await fallback.promise; });
    expect(result.current.inlineImageResolution.resolvedContentIds).toEqual(['1@inline', '2@inline']);
    expect(localFileAssetUrl).toHaveBeenCalledTimes(2);
  });

  it('does not duplicate pending asset reads on same-message rerenders', async () => {
    const asset = pendingUrl();
    vi.mocked(localFileAssetUrl).mockReturnValue(asset.promise);
    const { rerender } = setup([1]);
    rerender({ messageId: 1, accountId: 1, imageIds: [1] });
    rerender({ messageId: 1, accountId: 1, imageIds: [1] });
    expect(localFileAssetUrl).toHaveBeenCalledTimes(1);
    await act(async () => { asset.resolve('asset://first'); await asset.promise; });
  });

  it('ignores old fallback success and failure after switching messages', async () => {
    const first = pendingUrl();
    const second = pendingUrl();
    vi.mocked(invoke).mockImplementation((_command, args) => (
      args?.attachmentId === 1 ? first.promise : second.promise
    ) as never);
    const { result, rerender, setAttachmentErrors } = setup();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    rerender({ messageId: 2, accountId: 2, imageIds: [] });
    await act(async () => {
      first.resolve('data:image/png;base64,old');
      second.reject(new Error('old preview failed'));
      await Promise.allSettled([first.promise, second.promise]);
    });
    expect(result.current.inlineImageResolution.resolvedContentIds).toEqual([]);
    expect(setAttachmentErrors).not.toHaveBeenCalled();
  });

  it('keeps a current sibling failure visible after another image succeeds', async () => {
    const first = pendingUrl();
    const second = pendingUrl();
    vi.mocked(invoke).mockImplementation((_command, args) => (
      args?.attachmentId === 1 ? first.promise : second.promise
    ) as never);
    const { result, setAttachmentErrors } = setup();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    await act(async () => { first.resolve('data:image/png;base64,first'); await first.promise; });
    await act(async () => {
      second.reject(new Error('second image unreadable'));
      await second.promise.catch(() => undefined);
    });
    expect(result.current.inlineImageResolution.resolvedContentIds).toEqual(['1@inline']);
    expect(setAttachmentErrors).toHaveBeenCalledTimes(1);
    expect(setAttachmentErrors.mock.calls[0][0]({})).toEqual({ 2: 'second image unreadable' });
  });

  it('keeps a new account request in flight when an older lookup of the same ID finishes', async () => {
    const oldAsset = pendingUrl();
    const newAsset = pendingUrl();
    vi.mocked(localFileAssetUrl).mockReturnValueOnce(oldAsset.promise).mockReturnValue(newAsset.promise);
    const { result, rerender } = setup([1]);
    rerender({ messageId: 1, accountId: 2, imageIds: [1] });
    await act(async () => { oldAsset.resolve(''); await oldAsset.promise; });
    rerender({ messageId: 1, accountId: 2, imageIds: [1] });
    expect(localFileAssetUrl).toHaveBeenCalledTimes(2);
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { newAsset.resolve('asset://new-account'); await newAsset.promise; });
    expect(result.current.inlineImageResolution.html).toContain('asset://new-account');
  });

  it('does not publish a fallback error after unmount', async () => {
    const fallback = pendingUrl();
    vi.mocked(invoke).mockReturnValue(fallback.promise as never);
    const { unmount, setAttachmentErrors } = setup([1]);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      fallback.reject(new Error('closed reader'));
      await fallback.promise.catch(() => undefined);
    });
    expect(setAttachmentErrors).not.toHaveBeenCalled();
  });

  it('does not start a fallback after the hook unmounts during asset lookup', async () => {
    const asset = pendingUrl();
    vi.mocked(localFileAssetUrl).mockReturnValue(asset.promise);
    const { unmount } = setup([1]);
    unmount();
    await act(async () => { asset.resolve(''); await asset.promise; });
    expect(invoke).not.toHaveBeenCalled();
  });
});

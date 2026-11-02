import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import useComposerAttachments from './useComposerAttachments';
import type { DesktopFileDropHandler } from '../tauriBridge';
import type { OutboundAttachmentInput } from '../app/types';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), dropped: vi.fn(), listen: vi.fn() }));
vi.mock('../tauriBridge', () => ({ invoke: mocks.invoke, getCurrentWindow: () => ({ onDragDropEvent: mocks.listen }) }));
vi.mock('../app/nativeDroppedAttachments', () => ({ importNativeDroppedAttachmentPaths: mocks.dropped }));

class FileReaderMock {
  static readers: FileReaderMock[] = [];
  result = '';
  file!: File;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null = null;
  readAsDataURL(file: File) { this.file = file; FileReaderMock.readers.push(this); }
  abort = vi.fn(() => this.onabort?.());
  complete() { this.result = 'data:text/plain;base64,YQ=='; this.onload?.(); }
  fail() { this.onerror?.(); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const attachment = (name = 'a.txt'): OutboundAttachmentInput => ({ filename: name, mime_type: 'text/plain', size_bytes: 1, local_path: `/temp/${name}` });
const file = (name: string, type = 'text/plain') => new File(['a'], name, { type });
let nativeDrop: DesktopFileDropHandler;
function harness() {
  const onAttachmentsReady = vi.fn();
  const onInlineImagesReady = vi.fn();
  const setStatus = vi.fn();
  const setAttachmentProgress = vi.fn();
  const canImport = vi.fn(() => true);
  const hook = renderHook(() => useComposerAttachments({
    isComposerOpen: true, onAttachmentsReady, onInlineImagesReady, setStatus, setAttachmentProgress, canImport,
  }));
  return { ...hook, onAttachmentsReady, onInlineImagesReady, setStatus, setAttachmentProgress, canImport };
}
async function readNext(index: number, fail = false) {
  await act(async () => { if (fail) FileReaderMock.readers[index].fail(); else FileReaderMock.readers[index].complete(); });
}
beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (_command, args) => `/temp/${args?.filename}`);
  mocks.dropped.mockReset().mockImplementation(async (paths: string[]) => ({ attachments: [attachment(paths[0])], failed: 0, firstError: null }));
  mocks.listen.mockReset().mockImplementation(async (handler: DesktopFileDropHandler) => { nativeDrop = handler; return vi.fn(); });
  FileReaderMock.readers = [];
  vi.stubGlobal('FileReader', FileReaderMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('composer attachment import transactions', () => {
  it('registers a full batch synchronously and keeps send blocked until every import finishes', async () => {
    const { result, setAttachmentProgress } = harness();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.processDroppedOrPastedFiles([file('a.txt'), file('b.txt')]);
      expect(result.current.getAttachmentSendBlockReason()).toContain('仍在准备');
    });
    expect(result.current.attachmentImports.map(item => item.status)).toEqual(['preparing', 'queued']);
    await readNext(0);
    expect(result.current.attachmentImports.map(item => item.status)).toEqual(['ready', 'preparing']);
    expect(result.current.isImportingAttachments).toBe(true);
    expect(setAttachmentProgress).not.toHaveBeenLastCalledWith(null);
    await readNext(1);
    await act(async () => pending);
    expect(result.current.getAttachmentSendBlockReason()).toBeNull();
    expect(result.current.isImportingAttachments).toBe(false);
  });

  it('keeps earlier successes, continues after failure, and retries only the failed file once', async () => {
    const { result, onAttachmentsReady } = harness();
    let pending!: Promise<void>;
    act(() => { pending = result.current.processDroppedOrPastedFiles([file('a.txt'), file('b.txt'), file('c.txt')]); });
    await readNext(0);
    expect(onAttachmentsReady).toHaveBeenCalledWith([attachment('a.txt')], '已添加附件');
    await readNext(1, true);
    await readNext(2);
    await act(async () => pending);
    expect(result.current.attachmentImports.map(item => item.status)).toEqual(['ready', 'failed', 'ready']);
    expect(result.current.getAttachmentSendBlockReason()).toContain('准备失败');
    const failed = result.current.attachmentImports[1];
    act(() => { pending = result.current.retryAttachmentImport(failed.id); void result.current.retryAttachmentImport(failed.id); });
    expect(FileReaderMock.readers).toHaveLength(4);
    await readNext(3);
    await act(async () => pending);
    expect(onAttachmentsReady.mock.calls.flatMap(call => call[0]).map(item => item.filename)).toEqual(['a.txt', 'c.txt', 'b.txt']);
    expect(result.current.getAttachmentSendBlockReason()).toBeNull();
  });

  it('does not clear a second concurrent batch when the first finishes', async () => {
    const { result, setAttachmentProgress } = harness();
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => {
      first = result.current.processDroppedOrPastedFiles([file('a.txt')]);
      second = result.current.processDroppedOrPastedFiles([file('b.txt')]);
    });
    await readNext(0);
    await act(async () => first);
    expect(result.current.getAttachmentSendBlockReason()).toContain('仍在准备');
    expect(setAttachmentProgress).not.toHaveBeenLastCalledWith(null);
    await readNext(1);
    await act(async () => second);
  });

  it('removes a preparing item without accepting its late IPC result', async () => {
    const saved = deferred<string>();
    mocks.invoke.mockReturnValue(saved.promise);
    const { result, onAttachmentsReady } = harness();
    let pending!: Promise<void>;
    act(() => { pending = result.current.processDroppedOrPastedFiles([file('a.txt')]); });
    await readNext(0);
    act(() => result.current.dismissAttachmentImport(result.current.attachmentImports[0].id));
    expect(result.current.getAttachmentSendBlockReason()).toBeNull();
    await act(async () => { saved.resolve('/temp/late.txt'); await pending; });
    expect(onAttachmentsReady).not.toHaveBeenCalled();
    expect(result.current.attachmentImports).toEqual([]);
  });

  it('invalidates older work on reset without clearing the new session progress', async () => {
    const saved = deferred<string>();
    mocks.invoke.mockReturnValueOnce(saved.promise);
    const { result, onAttachmentsReady, setAttachmentProgress } = harness();
    let old!: Promise<void>; let next!: Promise<void>;
    act(() => { old = result.current.processDroppedOrPastedFiles([file('old.txt')]); });
    await readNext(0);
    act(() => {
      result.current.resetAttachmentImports();
      next = result.current.processDroppedOrPastedFiles([file('new.txt')]);
    });
    await act(async () => { saved.resolve('/temp/old.txt'); await old; });
    expect(onAttachmentsReady).not.toHaveBeenCalled();
    expect(result.current.attachmentImports.map(item => item.filename)).toEqual(['new.txt']);
    expect(setAttachmentProgress).not.toHaveBeenLastCalledWith(null);
    await readNext(1);
    await act(async () => next);
    expect(onAttachmentsReady).toHaveBeenCalledWith([attachment('new.txt')], '已添加附件');
  });

  it('retains native path failures individually and retries only that path', async () => {
    mocks.dropped.mockImplementation(async (paths: string[]) => paths[0] === '/bad.txt'
      ? { attachments: [], failed: 1, firstError: '文件不可读' }
      : { attachments: [attachment('good.txt')], failed: 0, firstError: null });
    const { result, onAttachmentsReady } = harness();
    await act(async () => nativeDrop({ type: 'drop', paths: ['/good.txt', '/bad.txt'] }));
    expect(onAttachmentsReady).toHaveBeenCalledTimes(1);
    const failed = result.current.attachmentImports.find(item => item.status === 'failed')!;
    expect(failed.filename).toBe('bad.txt');
    mocks.dropped.mockResolvedValueOnce({ attachments: [attachment('bad.txt')], failed: 0, firstError: null });
    await act(async () => result.current.retryAttachmentImport(failed.id));
    expect(mocks.dropped).toHaveBeenLastCalledWith(['/bad.txt']);
    expect(onAttachmentsReady).toHaveBeenCalledTimes(2);
    expect(result.current.getAttachmentSendBlockReason()).toBeNull();
  });

  it('tracks picker preparation, exposes its failure, and allows reselecting or cancelling', async () => {
    const picked = deferred<OutboundAttachmentInput[]>();
    mocks.invoke.mockReturnValueOnce(picked.promise);
    const { result, onAttachmentsReady } = harness();
    let pending!: Promise<void>;
    act(() => { pending = result.current.pickDraftAttachments(); });
    expect(result.current.getAttachmentSendBlockReason()).toContain('仍在准备');
    await act(async () => { picked.reject(new Error('无法读取文件')); await pending; });
    const failed = result.current.attachmentImports[0];
    expect(failed).toMatchObject({ source: 'picker', status: 'failed', error: '无法读取文件' });
    mocks.invoke.mockResolvedValueOnce([attachment()]);
    await act(async () => result.current.retryAttachmentImport(failed.id));
    expect(onAttachmentsReady).toHaveBeenCalledTimes(1);
    expect(result.current.getAttachmentSendBlockReason()).toBeNull();
    mocks.invoke.mockResolvedValueOnce([]);
    await act(async () => result.current.pickDraftAttachments());
    expect(result.current.attachmentImports).toHaveLength(1);
  });

  it('returns successful inline images once to the editor and commits a retry separately', async () => {
    const { result, onInlineImagesReady, onAttachmentsReady } = harness();
    let pending!: Promise<OutboundAttachmentInput[]>;
    act(() => { pending = result.current.buildInlineImageAttachments([file('a.png', 'image/png'), file('b.png', 'image/png')]); });
    await readNext(0);
    await readNext(1, true);
    let ready!: OutboundAttachmentInput[];
    await act(async () => { ready = await pending; });
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ filename: 'a.png', is_inline: true });
    expect(onInlineImagesReady).not.toHaveBeenCalled();
    expect(onAttachmentsReady).not.toHaveBeenCalled();
    let retried!: Promise<void>;
    act(() => { retried = result.current.retryAttachmentImport(result.current.attachmentImports[1].id); });
    await readNext(2);
    await act(async () => retried);
    expect(onInlineImagesReady).toHaveBeenCalledTimes(1);
    expect(onInlineImagesReady.mock.calls[0][0][0].filename).toBe('b.png');
  });

  it('rejects stale inline delivery so an old paste cannot edit a replacement draft', async () => {
    const { result, onInlineImagesReady } = harness();
    let pending!: Promise<OutboundAttachmentInput[]>;
    act(() => { pending = result.current.buildInlineImageAttachments([file('a.png', 'image/png')]); });
    const observed = pending.catch(error => error);
    act(() => result.current.resetAttachmentImports());
    let error!: Error;
    await act(async () => { error = await observed; });
    expect(error.name).toBe('AbortError');
    expect(onInlineImagesReady).not.toHaveBeenCalled();
    expect(result.current.attachmentImports).toEqual([]);
  });

  it('rejects new native and browser imports while submission owns the draft', async () => {
    const { result, canImport } = harness();
    canImport.mockReturnValue(false);
    await act(async () => {
      await result.current.processDroppedOrPastedFiles([file('a.txt')]);
      await result.current.pickDraftAttachments();
      nativeDrop({ type: 'drop', paths: ['/a.txt'] });
    });
    expect(result.current.attachmentImports).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.dropped).not.toHaveBeenCalled();
  });

  it('keeps oversized and unnamed files as explicit failures without reading them into memory', async () => {
    const large = file('large.zip');
    Object.defineProperty(large, 'size', { value: 25 * 1024 * 1024 + 1 });
    const { result } = harness();
    await act(async () => result.current.processDroppedOrPastedFiles([large, file('')]));
    expect(FileReaderMock.readers).toHaveLength(0);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(result.current.attachmentImports.map(item => item.status)).toEqual(['failed', 'failed']);
    expect(result.current.attachmentImports[0].error).toContain('25 MiB');
    expect(result.current.attachmentImports[1].error).toContain('文件名');
    expect(result.current.getAttachmentSendBlockReason()).toContain('准备失败');
  });
  it('restores a failed group and keeps unmatched files blocked after partial reselection or cancellation', async () => {
    const { result, onAttachmentsReady } = harness();
    act(() => result.current.restoreAttachmentImports([
      { filename: 'a.txt', size_bytes: 1, is_inline: false },
      { filename: 'b.txt', size_bytes: 1, is_inline: false },
    ]));
    const id = result.current.attachmentImports[0].id;
    expect(result.current.getAttachmentSendBlockReason()).toContain('准备失败');
    mocks.invoke.mockResolvedValueOnce([attachment('a.txt')]);
    await act(async () => result.current.retryAttachmentImport(id));
    expect(onAttachmentsReady).toHaveBeenCalledWith([attachment('a.txt')], '已重新添加附件');
    expect(result.current.attachmentImports[0].recoveryFiles?.map(file => file.filename)).toEqual(['b.txt']);
    expect(result.current.getAttachmentSendBlockReason()).not.toBeNull();
    mocks.invoke.mockResolvedValueOnce([]);
    await act(async () => result.current.retryAttachmentImport(id));
    expect(result.current.attachmentImports[0].status).toBe('failed');
    mocks.invoke.mockResolvedValueOnce([attachment('b.txt')]);
    await act(async () => result.current.retryAttachmentImport(id));
    expect(result.current.attachmentImports).toEqual([]);
    expect(result.current.getAttachmentSendBlockReason()).toBeNull();
  });

  it('restores images through the inline callback and requires an explicit decision for an unfinished picker', async () => {
    const { result, onInlineImagesReady } = harness();
    act(() => result.current.restoreAttachmentImports([{ filename: 'image.png', size_bytes: 1, is_inline: true }]));
    mocks.invoke.mockResolvedValueOnce([attachment('image.png')]);
    await act(async () => result.current.retryAttachmentImport(result.current.attachmentImports[0].id));
    expect(onInlineImagesReady.mock.calls[0][0][0]).toMatchObject({ filename: 'image.png', is_inline: true });
    act(() => result.current.restoreAttachmentImports([{ filename: '选择附件', size_bytes: null, is_inline: false, selection_unknown: true }]));
    const id = result.current.attachmentImports[0].id;
    mocks.invoke.mockResolvedValueOnce([]);
    await act(async () => result.current.retryAttachmentImport(id));
    expect(result.current.getAttachmentSendBlockReason()).toContain('准备失败');
    act(() => result.current.dismissAttachmentImport(id));
    expect(result.current.getAttachmentSendBlockReason()).toBeNull();
  });

});

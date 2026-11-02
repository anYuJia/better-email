import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useStatusFeedback from './useStatusFeedback';
import type { AttachmentImportItem } from '../app/attachmentImports';

afterEach(cleanup);
describe('status notification ownership', () => {
  const failed: AttachmentImportItem = { id: 'file', filename: '报告.pdf', sizeBytes: 12, status: 'failed', progress: null, error: '读取失败', source: 'file', inline: false };
  it('keeps an actionable composer failure inline and does not replay it when the composer closes', () => {
    const toast = vi.fn();
    const message = '正文和附件已保留。服务器拒绝接收';
    const { rerender } = renderHook(({ status, visible }) => useStatusFeedback(status, toast, {
      visible, sendIssue: { kind: 'failed', message }, imports: [],
    }), { initialProps: { status: '就绪', visible: true } });
    rerender({ status: message, visible: true });
    rerender({ status: message, visible: false });
    expect(toast).not.toHaveBeenCalled();
  });
  it('announces a new send failure when the composer is minimized even without an error keyword', () => {
    const toast = vi.fn();
    const message = '正文和附件已保留。Connection closed';
    const { rerender } = renderHook(({ status }) => useStatusFeedback(status, toast, {
      visible: false, sendIssue: { kind: 'failed', message }, imports: [],
    }), { initialProps: { status: '就绪' } });
    rerender({ status: message });
    expect(toast).toHaveBeenCalledWith(message, 'error');
  });
  it('suppresses only visible attachment failures and still reports unrelated mailbox errors', () => {
    const toast = vi.fn();
    const { rerender } = renderHook(({ status, visible }) => useStatusFeedback(status, toast, {
      visible, sendIssue: null, imports: [failed],
    }), { initialProps: { status: '就绪', visible: true } });
    rerender({ status: '附件准备失败：读取失败', visible: true });
    expect(toast).not.toHaveBeenCalled();
    rerender({ status: 'Error: 同步失败', visible: true });
    expect(toast).toHaveBeenLastCalledWith('同步失败', 'error');
    rerender({ status: '附件准备失败：磁盘已满', visible: false });
    expect(toast).toHaveBeenLastCalledWith('附件准备失败：磁盘已满', 'error');
  });

  it('keeps a visible draft save failure inline without replaying it after the composer closes', () => {
    const toast = vi.fn();
    const message = '保存失败，邮件内容已保留：磁盘暂时不可写';
    const { rerender } = renderHook(({ status, visible }) => useStatusFeedback(status, toast, {
      visible, sendIssue: null, imports: [],
    }), { initialProps: { status: '正在保存草稿…', visible: true } });
    rerender({ status: message, visible: true });
    rerender({ status: message, visible: false });
    expect(toast).not.toHaveBeenCalled();
    rerender({ status: '保存失败，邮件内容已保留：连接已断开', visible: false });
    expect(toast).toHaveBeenCalledExactlyOnceWith('保存失败，邮件内容已保留：连接已断开', 'error');
  });

  it.each([
    '保存失败：设置无法写入',
    '邮箱保存失败，邮件内容已保留：暂时不可用',
    '草稿已保存，但刷新邮件列表失败：网络错误',
  ])('still reports an unrelated save or mailbox failure: %s', (message) => {
    const toast = vi.fn();
    const { rerender } = renderHook(({ status }) => useStatusFeedback(status, toast, {
      visible: true, sendIssue: null, imports: [],
    }), { initialProps: { status: '就绪' } });
    rerender({ status: message });
    expect(toast).toHaveBeenCalledExactlyOnceWith(message, 'error');
  });
});

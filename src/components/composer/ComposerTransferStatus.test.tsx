import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComposerTransferStatus from './ComposerTransferStatus';
import type { AttachmentImportItem } from '../../app/attachmentImports';

const failed: AttachmentImportItem = {
  id: 'report', filename: '项目报告.zip', sizeBytes: 20 * 1024 * 1024,
  status: 'failed', progress: null, error: '磁盘空间不足', source: 'file', inline: false,
};
afterEach(cleanup);

describe('composer attachment recovery status', () => {
  it('keeps failed file details and exposes keyboard reachable retry and removal actions', () => {
    const retry = vi.fn(); const dismiss = vi.fn();
    render(<ComposerTransferStatus imports={[failed]} disabled={false} onRetry={retry} onDismiss={dismiss} onRetrySend={vi.fn()} />);
    expect(screen.getByText(/磁盘空间不足/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试添加 项目报告.zip' }));
    expect(retry).toHaveBeenCalledWith('report');
    fireEvent.click(screen.getByRole('button', { name: '移除失败附件 项目报告.zip' }));
    expect(dismiss).toHaveBeenCalledWith('report');
  });

  it('does not duplicate ready attachments and distinguishes preparation from sending', () => {
    render(<ComposerTransferStatus imports={[
      { ...failed, id: 'ready', filename: '已准备.pdf', status: 'ready', error: null },
      { ...failed, status: 'preparing', progress: 35, error: null },
    ]} disabled={false} onRetrySend={vi.fn()} />);
    expect(screen.queryByText('已准备.pdf')).toBeNull();
    expect(screen.getByRole('progressbar', { name: '项目报告.zip 准备进度' }).getAttribute('value')).toBe('35');
    expect(screen.getByRole('status').textContent).toContain('完成后即可发送');
  });

  it('offers send retry only after every attachment failure is resolved', () => {
    const retry = vi.fn();
    const { rerender } = render(<ComposerTransferStatus imports={[failed]} sendIssue={{ kind: 'failed', message: '网络连接失败，附件已保留' }} disabled={false} onRetrySend={retry} />);
    expect(screen.getByRole('button', { name: '重试发送' })).toHaveProperty('disabled', true);
    rerender(<ComposerTransferStatus imports={[]} sendIssue={{ kind: 'failed', message: '网络连接失败，附件已保留' }} disabled={false} onRetrySend={retry} />);
    fireEvent.click(screen.getByRole('button', { name: '重试发送' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps uncertain delivery visible without a resend action', () => {
    render(<ComposerTransferStatus imports={[]} sendIssue={{ kind: 'uncertain', message: '发送结果未确认，请前往主窗口的发件箱核对，不要直接重发' }} disabled={false} onRetrySend={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('发件箱');
    expect(screen.getAllByText(/发件箱/)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '重试发送' })).toBeNull();
  });

  it('summarizes mixed preparation and the actual files in a restored failure group', () => {
    render(<ComposerTransferStatus imports={[
      { ...failed, recoveryFiles: [
        { filename: 'first.zip', size_bytes: 20, is_inline: false },
        { filename: 'second.zip', size_bytes: 20, is_inline: false },
      ] },
      { ...failed, id: 'working', filename: '正在读取.pdf', status: 'preparing', progress: 30 },
    ]} disabled={false} onRetrySend={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toBe('2 个附件未准备好，另有 1 个正在准备');
  });

  it('keeps full filenames and error descriptions available without relying on hover titles', () => {
    const filename = '项目完整资料与大文件附件版本说明-very-long-english-filename-for-layout-check.zip';
    render(<ComposerTransferStatus imports={[{ ...failed, filename }]} disabled={false} onRetry={vi.fn()} onDismiss={vi.fn()} onRetrySend={vi.fn()} />);
    const row = screen.getByRole('listitem', { name: filename });
    const retry = screen.getByRole('button', { name: `重试添加 ${filename}` });
    expect(screen.getByText(filename).hasAttribute('title')).toBe(false);
    expect(document.getElementById(row.getAttribute('aria-describedby')!)?.textContent).toContain('磁盘空间不足');
    expect(retry.getAttribute('aria-describedby')).toBe(row.getAttribute('aria-describedby'));
    expect(screen.getByRole('button', { name: `移除失败附件 ${filename}` }).textContent).toContain('移除');
  });

  it('moves keyboard focus to preparation status and then the same composer attachment entry', () => {
    const retry = vi.fn();
    const content = (imports: AttachmentImportItem[]) => (
      <>
        <section className="composer"><button aria-label="添加附件">Other composer</button></section>
        <section className="composer">
          <ComposerTransferStatus imports={imports} disabled={false} onRetry={retry} onDismiss={vi.fn()} onRetrySend={vi.fn()} />
          <button aria-label="添加附件">Current composer</button>
        </section>
      </>
    );
    const { rerender } = render(content([failed]));
    const button = screen.getByRole('button', { name: `重试添加 ${failed.filename}` });
    act(() => button.focus());
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledWith(failed.id);
    rerender(content([{ ...failed, status: 'preparing', progress: 0, error: null }]));
    expect(document.activeElement).toBe(screen.getByRole('listitem', { name: failed.filename }));
    rerender(content([{ ...failed, status: 'ready', progress: 100, error: null }]));
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: '添加附件' })[1]);
    expect(document.activeElement?.textContent).toBe('Current composer');
  });

  it('continues to the next failure after removing a focused row, then to the previous row', () => {
    const second = { ...failed, id: 'second', filename: '第二份.zip' };
    const third = { ...failed, id: 'third', filename: '第三份.zip' };
    const props = { disabled: false, onRetry: vi.fn(), onDismiss: vi.fn(), onRetrySend: vi.fn() };
    const { rerender } = render(<ComposerTransferStatus imports={[failed, second, third]} {...props} />);
    const remove = screen.getByRole('button', { name: `移除失败附件 ${second.filename}` });
    act(() => remove.focus());
    fireEvent.click(remove);
    rerender(<ComposerTransferStatus imports={[failed, third]} {...props} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `重试添加 ${third.filename}` }));
    const lastRemove = screen.getByRole('button', { name: `移除失败附件 ${third.filename}` });
    act(() => lastRemove.focus());
    fireEvent.click(lastRemove);
    rerender(<ComposerTransferStatus imports={[failed]} {...props} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `重试添加 ${failed.filename}` }));
  });

  it('does not pull focus from another field when a retry completes later', () => {
    const content = (imports: AttachmentImportItem[]) => <section className="composer">
      <input aria-label="正文" />
      <ComposerTransferStatus imports={imports} disabled={false} onRetry={vi.fn()} onDismiss={vi.fn()} onRetrySend={vi.fn()} />
      <button aria-label="添加附件">Attachment</button>
    </section>;
    const { rerender } = render(content([failed]));
    act(() => screen.getByRole('button', { name: `重试添加 ${failed.filename}` }).focus());
    rerender(content([{ ...failed, status: 'preparing' }]));
    act(() => screen.getByRole('textbox', { name: '正文' }).focus());
    rerender(content([]));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '正文' }));
  });

  it('releases focus ownership after a pointer interaction outside the status region', () => {
    const props = { disabled: false, onRetry: vi.fn(), onDismiss: vi.fn(), onRetrySend: vi.fn() };
    const { rerender } = render(<section className="composer"><ComposerTransferStatus imports={[failed]} {...props} /><button aria-label="添加附件">Attachment</button></section>);
    const retry = screen.getByRole('button', { name: `重试添加 ${failed.filename}` });
    act(() => retry.focus());
    fireEvent.pointerDown(document.body);
    rerender(<section className="composer"><ComposerTransferStatus imports={[]} {...props} /><button aria-label="添加附件">Attachment</button></section>);
    expect(document.activeElement).toBe(document.body);
  });

  it('disables missing recovery callbacks instead of presenting no-op actions', () => {
    render(<ComposerTransferStatus imports={[failed]} disabled={false} onRetrySend={vi.fn()} />);
    expect(screen.getByRole('button', { name: `重试添加 ${failed.filename}` })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: `移除失败附件 ${failed.filename}` })).toHaveProperty('disabled', true);
  });
});

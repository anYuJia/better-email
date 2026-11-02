import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../app/types';
import type { AiRequestResult } from '../../app/types/ai';
import { generateTemplate, summarizeMessage } from '../../app/aiService';
import ReaderAiContextActions from './ReaderAiContextActions';

vi.mock('../../app/aiService', () => ({
  generateTemplate: vi.fn(), summarizeMessage: vi.fn(),
  aiErrorMessage: (error: { message: string }) => error.message,
}));

const message: Message = {
  id: 1, account_id: 1, account_email: 'me@example.com', folder_id: 1, folder_role: 'inbox',
  sender_name: 'Ada', sender_email: 'ada@example.com', recipients: 'me@example.com', cc: '', bcc: '',
  subject: '项目进度', snippet: '请查看进度', body: '请查看进度', sanitized_html: '', security_warnings: [],
  received_at: '', is_read: true, is_starred: false, has_attachments: false, snoozed_until: '', labels: [],
  attachment_count: 0, remote_mailbox: '', remote_uid: 0, message_id_header: '', in_reply_to_header: '', references_header: '',
};
const result = (content: string): AiRequestResult => ({ content, operation: 'summarize', service_type: 'mock', truncated: false });
function deferred() {
  let resolve!: (value: AiRequestResult) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<AiRequestResult>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function start(action: '总结邮件' | '生成回复') {
  const details = document.querySelector('.reader-ai-menu') as HTMLDetailsElement;
  if (!details.open) fireEvent.click(screen.getByRole('button', { name: 'AI 邮件工具' }));
  fireEvent.click(screen.getByRole('menuitem', { name: action }));
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ReaderAiContextActions message ownership', () => {
  it('removes completed results immediately when the account or message changes', async () => {
    vi.mocked(summarizeMessage).mockResolvedValue(result('Ada 的摘要'));
    const onComposeFromMessage = vi.fn();
    const view = render(<ReaderAiContextActions message={message} onComposeFromMessage={onComposeFromMessage} />);
    start('总结邮件');
    expect(await screen.findByText('Ada 的摘要')).toBeDefined();
    view.rerender(<ReaderAiContextActions message={{ ...message, account_id: 2 }} onComposeFromMessage={onComposeFromMessage} />);
    expect(screen.queryByText('Ada 的摘要')).toBeNull();
  });

  it('ignores late success and failure without clearing the next message request', async () => {
    const old = deferred();
    const next = deferred();
    vi.mocked(summarizeMessage).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const onComposeFromMessage = vi.fn();
    const view = render(<ReaderAiContextActions message={message} onComposeFromMessage={onComposeFromMessage} />);
    start('总结邮件');
    view.rerender(<ReaderAiContextActions message={{ ...message, id: 2 }} onComposeFromMessage={onComposeFromMessage} />);
    start('总结邮件');
    await act(async () => { old.reject({ kind: 'external', message: '旧邮件请求失败' }); });
    expect(screen.queryByText('旧邮件请求失败')).toBeNull();
    expect((screen.getByRole('menuitem', { name: '总结邮件', hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { next.resolve(result('当前邮件摘要')); });
    expect(screen.getByText('当前邮件摘要')).toBeDefined();
  });

  it('does not revive an abandoned reply after switching away and returning to the same message', async () => {
    const old = deferred();
    vi.mocked(generateTemplate).mockReturnValue(old.promise);
    const onComposeFromMessage = vi.fn();
    const view = render(<ReaderAiContextActions message={message} onComposeFromMessage={onComposeFromMessage} />);
    start('生成回复');
    view.rerender(<ReaderAiContextActions message={{ ...message, id: 2 }} onComposeFromMessage={onComposeFromMessage} />);
    view.rerender(<ReaderAiContextActions message={message} onComposeFromMessage={onComposeFromMessage} />);
    await act(async () => { old.resolve(result('过期回复')); });
    expect(onComposeFromMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('过期回复')).toBeNull();
  });

  it('discards reply completion after unmount and allows a current reply normally', async () => {
    const old = deferred();
    vi.mocked(generateTemplate).mockReturnValueOnce(old.promise).mockResolvedValueOnce(result('当前有效回复'));
    const onComposeFromMessage = vi.fn();
    const view = render(<ReaderAiContextActions message={message} onComposeFromMessage={onComposeFromMessage} />);
    start('生成回复');
    view.unmount();
    await act(async () => { old.resolve(result('卸载后的回复')); });
    expect(onComposeFromMessage).not.toHaveBeenCalled();
    render(<ReaderAiContextActions message={message} onComposeFromMessage={onComposeFromMessage} />);
    start('生成回复');
    await act(async () => {});
    expect(onComposeFromMessage).toHaveBeenCalledExactlyOnceWith(message, 'reply', '当前有效回复');
  });
});

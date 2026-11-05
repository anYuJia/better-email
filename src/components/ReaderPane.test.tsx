import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReaderPane, { type ReaderPaneProps } from './ReaderPane';
import type { Message, ThreadSummary } from '../app/types';
import * as mailUtils from '../mailUtils';
import { MAX_AUTO_RENDER_BODY_LENGTH } from '../app/messageBodyPolicy';

vi.mock('../mailUtils', async (original) => {
  const actual = await original<typeof import('../mailUtils')>();
  return { ...actual, htmlHasRenderableContent: vi.fn(actual.htmlHasRenderableContent),
    htmlHasRemoteVisualContent: vi.fn(actual.htmlHasRemoteVisualContent) };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function props(overrides: Partial<ReaderPaneProps> = {}): ReaderPaneProps {
  const message: Message = {
    id: 1, account_id: 1, account_email: 'me@example.com', folder_id: 1, folder_role: 'inbox',
    sender_name: 'Ada', sender_email: 'ada@example.com', recipients: 'me@example.com', cc: '', bcc: '',
    subject: '正文检查', snippet: '正文', body: '正文内容', sanitized_html: '<p>正文内容</p>', security_warnings: [],
    received_at: '2026-10-01T09:00:00Z', is_read: true, is_starred: false, has_attachments: false,
    snoozed_until: '', labels: [], attachment_count: 0, remote_mailbox: 'INBOX', remote_uid: 0,
    message_id_header: '', in_reply_to_header: '', references_header: '',
  };
  return {
    activeThread: null, threadMessages: [], activeThreadSelected: null, selected: message,
    selectedId: 1, activeSelectedId: 1, attachmentsLoaded: true, accountScope: 1,
    folders: [], labels: [], attachments: [], selectedSenderTrusted: true, selectedSenderDomain: 'example.com',
    selectedHasRemoteImageWarning: false, selectedSenderIsExternal: false, selectedExternalBlocked: false,
    selectedWarnExternalSender: false, selectedInterceptsHttps: false, quickReplyBody: '', readTriggerKey: 0,
    onOpenHttpsLink: vi.fn(), onSelectMessage: vi.fn(), onComposeNew: vi.fn(), onComposeFromMessage: vi.fn(),
    onRunThreadAction: vi.fn(), onRequestSnooze: vi.fn(), onMoveThreadToFolder: vi.fn(), onToggleThreadLabel: vi.fn(),
    onToggleThreadMute: vi.fn(), onToggleStar: vi.fn(), onEditDraft: vi.fn(), onRestoreFromTrash: vi.fn(),
    onMoveArchive: vi.fn(), onMoveTrash: vi.fn(), onToggleRead: vi.fn(), onReadComplete: vi.fn(),
    onUnsnooze: vi.fn(), onSnooze: vi.fn(), onExportMessage: vi.fn(), onFetchBody: vi.fn(), onMarkNotSpam: vi.fn(),
    onMarkAsSpam: vi.fn(), onAllowRemoteImagesOnce: vi.fn(), onTrustRemoteImages: vi.fn(), onBlockSender: vi.fn(),
    onPermanentlyDelete: vi.fn(), onEmptyTrash: vi.fn(), onMoveToFolder: vi.fn(), onToggleLabel: vi.fn(),
    onOpenAttachment: vi.fn(), onDownloadAttachment: vi.fn(), onSaveAttachmentAs: vi.fn(),
    onQuickReplyChange: vi.fn(), onSendQuickReply: vi.fn(), ...overrides,
  };
}

describe('ReaderPane content lifecycle', () => {
  const conversation = (key: string): ThreadSummary => ({ thread_key: key, subject: `会话 ${key}`, participants: 'Ada',
    message_count: 2, unread_count: 1, latest_at: '2026-10-01T09:00:00Z', latest_preview: '摘要', is_muted: false });

  it('shows the requested thread immediately without old body, actions or read completion while loading', () => {
    vi.useFakeTimers();
    const input = props({ activeThread: conversation('B'), threadLoadState: { threadKey: 'B', status: 'loading' } });
    input.selected = { ...input.selected!, is_read: false };
    // Deliberately retain old props: the pending branch must itself own what
    // can be read and acted on, rather than relying on fetch timing.
    input.threadMessages = [input.selected]; input.activeThreadSelected = input.selected;
    const view = render(<ReaderPane {...input} />);
    expect(screen.getByRole('heading', { name: '会话 B' })).toBeDefined();
    expect(screen.getByLabelText('正在加载邮件正文')).toBeDefined();
    expect(view.container.querySelector('.reader-panel')?.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('正文检查')).toBeNull();
    expect(screen.queryByText('正文内容')).toBeNull();
    expect(screen.queryByRole('button', { name: '回复最新邮件' })).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(input.onReadComplete).not.toHaveBeenCalled();
  });

  it('keeps the thread navigation node and keyboard focus through error, retry and ready content', async () => {
    const input = props({ activeThread: conversation('B'), threadLoadState: { threadKey: 'B', status: 'error' },
      onRetryThread: vi.fn(), onBackToList: vi.fn() });
    const view = render(<ReaderPane {...input} />);
    const panel = view.container.querySelector<HTMLElement>('.reader-panel')!;
    const back = screen.getByRole('button', { name: '返回邮件列表' });
    expect(screen.getByRole('alert').textContent).toContain('暂时无法加载此会话');
    fireEvent.click(screen.getByRole('button', { name: '重新加载会话' }));
    expect(input.onRetryThread).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(panel);
    view.rerender(<ReaderPane {...input} threadLoadState={{ threadKey: 'B', status: 'loading' }} />);
    view.rerender(<ReaderPane {...input} threadLoadState={null} threadMessages={[{ ...input.selected!, subject: '新会话正文' }]} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /查看会话中的邮件：.*新会话正文/ })).toBeDefined());
    expect(document.activeElement).toBe(panel);
    expect(screen.getByRole('button', { name: '返回邮件列表' })).toBe(back);
    fireEvent.click(back);
    expect(input.onBackToList).toHaveBeenCalledOnce();
  });

  it('renders an empty conversation as a finished retryable state instead of showing the previous message', () => {
    const input = props({ activeThread: conversation('empty'), onRetryThread: vi.fn() });
    const view = render(<ReaderPane {...input} />);
    expect(screen.getByRole('heading', { name: '会话 empty' })).toBeDefined();
    expect(screen.getByText('此会话暂无可显示的邮件')).toBeDefined();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText('正文检查')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新加载会话' }));
    expect(input.onRetryThread).toHaveBeenCalledOnce();
  });

  it('shows the new summary during detail loading and retains it when detail loading fails', () => {
    const input = props();
    const summary = { ...input.selected!, subject: 'New message identity', sender_name: 'New sender' };
    const view = render(<ReaderPane {...input} selected={null} selectedSummary={summary} detailLoadState={{ status: 'loading', messageId: 1 }} />);
    expect(screen.getByRole('heading', { name: 'New message identity' })).toBeDefined();
    expect(screen.getByText('New sender')).toBeDefined();
    expect(screen.getByLabelText('正在加载邮件正文')).toBeDefined();
    expect(view.container.querySelector('.email-reader-skeleton-header')).toBeNull();
    view.rerender(<ReaderPane {...input} selected={null} selectedSummary={summary} detailLoadState={{ status: 'error', messageId: 1, error: 'offline' }} />);
    expect(screen.getByRole('heading', { name: 'New message identity' })).toBeDefined();
    expect(screen.getByRole('button', { name: '重新加载邮件' })).toBeDefined();
  });

  it('does not expose old content or complete reading while the mailbox is switching', () => {
    vi.useFakeTimers();
    const input = props();
    input.selected = { ...input.selected!, is_read: false };
    render(<ReaderPane {...input} mailboxPending />);
    expect(screen.queryByText('正文检查')).toBeNull();
    expect(screen.queryByRole('button', { name: '回复' })).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    expect(input.onReadComplete).not.toHaveBeenCalled();
  });

  it('expresses locally corrupt content without a silent blank or a fake remote retry', () => {
    const input = props();
    input.selected = { ...input.selected!, body: '--boundary\nContent-Type: text/plain\nCorrupt', sanitized_html: '', remote_uid: 0 };
    render(<ReaderPane {...input} />);
    expect(screen.getByRole('alert').textContent).toContain('无法解析邮件正文');
    expect(screen.queryByRole('button', { name: '重试拉取正文' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '导出邮件副本' }));
    expect(input.onExportMessage).toHaveBeenCalledOnce();
  });

  it('ends the busy indicator when mailbox switching fails without showing an old message', () => {
    const input = props();
    const view = render(<ReaderPane {...input} mailboxPending mailboxError="offline" />);
    expect(screen.getByText('邮件列表加载失败')).toBeDefined();
    expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText('正文检查')).toBeNull();
  });

  it('routes missing credentials to the account owning the current message', () => {
    const input = props({ onRepairCredentials: vi.fn() });
    render(<ReaderPane {...input} bodyFetchState={{ messageId: 1, status: 'error', errorKind: 'credentials', error: '本机未保存登录凭据' }} />);
    fireEvent.click(screen.getByRole('button', { name: '修复此账号登录' }));
    expect(input.onRepairCredentials).toHaveBeenCalledWith(1);
  });
  it('shows a persistent retry after corrupt body loading fails, then renders the recovered reply', () => {
    const input = props();
    input.selected = { ...input.selected!, body: '--boundary\nContent-Type: text/plain\nBroken MIME', sanitized_html: '', is_read: false, remote_uid: 77 };
    const view = render(<ReaderPane {...input} bodyFetchState={{ messageId: 1, status: 'error', error: '服务器离线' }} />);
    expect(screen.getByRole('alert').textContent).toContain('服务器离线');
    expect(screen.queryByRole('textbox', { name: '输入回复' })).toBeNull();
    expect(input.onReadComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试拉取正文' }));
    expect(input.onFetchBody).toHaveBeenCalledWith(false);
    view.rerender(<ReaderPane {...input} bodyFetchState={{ messageId: 1, status: 'loading', error: null }} />);
    expect(screen.getByLabelText('正在加载邮件正文')).toBeDefined();
    expect(input.onReadComplete).not.toHaveBeenCalled();
    view.rerender(<ReaderPane {...input} selected={{ ...input.selected!, body: '已恢复的正文' }} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('已恢复的正文')).toBeDefined();
    expect(screen.getByRole('button', { name: '开始快速回复' })).toBeDefined();
  });

  it('does not mark headers, reload skeletons, or failures as read from scrolling or elapsed time', () => {
    vi.useFakeTimers();
    const input = props();
    input.selected = { ...input.selected!, body: '', sanitized_html: '', is_read: false, remote_uid: 77 };
    const view = render(<ReaderPane {...input} bodyFetchState={{ messageId: 1, status: 'loading', error: null }} />);
    const panel = view.container.querySelector('.reader-panel')!;
    fireEvent.scroll(panel);
    act(() => vi.advanceTimersByTime(2500));
    expect(input.onReadComplete).not.toHaveBeenCalled();
    // Cached content under a refresh/error is not currently being displayed.
    const cached = { ...input.selected!, body: '之前缓存的正文' };
    view.rerender(<ReaderPane {...input} selected={cached} bodyFetchState={{ messageId: 1, status: 'error', error: '离线' }} />);
    fireEvent.scroll(panel);
    act(() => vi.advanceTimersByTime(2500));
    expect(input.onReadComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '输入回复' })).toBeNull();
    view.rerender(<ReaderPane {...input} selected={cached} />);
    expect(input.onReadComplete).toHaveBeenCalledOnce();
    expect(input.onReadComplete).toHaveBeenCalledWith(cached);
  });

  it.each(['', '之前保存的回复草稿'])('allows mobile replies to a successfully loaded empty message (draft: %s)', (draft) => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 720px)', addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const input = props({ quickReplyBody: draft });
    input.selected = { ...input.selected!, body: '', sanitized_html: '' };
    render(<ReaderPane {...input} />);
    expect(screen.getByText('无正文')).toBeDefined();
    if (!draft) expect(screen.queryByRole('textbox', { name: '输入回复' })).toBeNull();
    else expect((screen.getByRole('textbox', { name: '输入回复' }) as HTMLTextAreaElement).value).toBe(draft);
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    const editor = screen.getByRole('textbox', { name: '输入回复' });
    expect(document.activeElement).toBe(editor);
    expect((editor as HTMLTextAreaElement).value).toBe(draft);
    expect(input.onComposeFromMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '展开回复' }));
    expect(input.onComposeFromMessage).toHaveBeenCalledWith(input.selected, 'reply', draft);
  });

  it('requires large-body approval after a header fetch before completing reading or revealing reply', () => {
    vi.useFakeTimers();
    const input = props();
    const header = { ...input.selected!, body: '', sanitized_html: '', is_read: false, remote_uid: 77 };
    const view = render(<ReaderPane {...input} selected={header} bodyFetchState={{ messageId: 1, status: 'loading', error: null }} />);
    const large = { ...header, body: '正文'.repeat(MAX_AUTO_RENDER_BODY_LENGTH) };
    view.rerender(<ReaderPane {...input} selected={large} />);
    act(() => vi.advanceTimersByTime(2500));
    fireEvent.scroll(view.container.querySelector('.reader-panel')!);
    expect(input.onReadComplete).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: '输入回复' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载完整邮件' }));
    expect(input.onReadComplete).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '开始快速回复' })).toBeDefined();
  });

  it('does not treat the conversation summary scroll container as the message body read boundary', async () => {
    const input = props();
    input.selected = { ...input.selected!, is_read: false };
    render(<ReaderPane {...input} activeThread={{ thread_key: 'thread', subject: '会话摘要', participants: 'Ada',
      message_count: 1, unread_count: 1, latest_at: input.selected.received_at,
      latest_preview: '会话内容', is_muted: false }} threadMessages={[input.selected]} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '会话摘要' })).toBeTruthy());
    expect(input.onReadComplete).not.toHaveBeenCalled();
  });

  it('remembers each conversation position and isolates the same thread across account scopes', async () => {
    const input = props({ scrollPositions: new Map() });
    const thread = (id: string) => ({ thread_key: id, subject: `会话 ${id}`, participants: 'Ada',
      message_count: 1, unread_count: 0, latest_at: input.selected!.received_at,
      latest_preview: '会话内容', is_muted: false });
    const messages = [input.selected!];
    const view = render(<ReaderPane {...input} activeThread={thread('a')} threadMessages={messages} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '会话 a' })).toBeTruthy());
    const panel = view.container.querySelector<HTMLElement>('.reader-panel')!;
    panel.scrollTop = 800;
    fireEvent.scroll(panel);

    view.rerender(<ReaderPane {...input} activeThread={thread('b')} threadMessages={messages} />);
    expect(panel.scrollTop).toBe(0);
    panel.scrollTop = 240;
    fireEvent.scroll(panel);
    view.rerender(<ReaderPane {...input} activeThread={thread('a')} threadMessages={messages} />);
    expect(panel.scrollTop).toBe(800);
    view.rerender(<ReaderPane {...input} activeThread={thread('a')} threadMessages={messages} accountScope={2} />);
    expect(panel.scrollTop).toBe(0);
    view.rerender(<ReaderPane {...input} activeThread={thread('a')} threadMessages={messages} />);
    expect(panel.scrollTop).toBe(800);
  });

  it('keeps one attachment summary and reply through same-message updates and loading transitions', () => {
    const input = props({ attachments: [{
      id: 3, message_id: 1, filename: 'checklist.pdf', mime_type: 'application/pdf', size_bytes: 2048,
      is_downloaded: false, local_path: '', content_id: '', is_inline: false,
    }] });
    const view = render(<ReaderPane {...input} />);
    for (let index = 0; index < 4; index += 1) {
      view.rerender(<ReaderPane {...input} attachmentsLoaded={false} quickReplyBody={`回复 ${index}`} />);
      expect(view.container.querySelectorAll('.attachment-section')).toHaveLength(1);
      expect(view.container.querySelectorAll('.quick-reply')).toHaveLength(0);
      view.rerender(<ReaderPane {...input} selected={{ ...input.selected!, is_starred: index % 2 === 0 }} quickReplyBody={`回复 ${index}`} />);
      expect(view.container.querySelectorAll('.attachment-section')).toHaveLength(1);
      expect(view.container.querySelectorAll('.attachment-summary-toggle')).toHaveLength(1);
      expect(view.container.querySelectorAll('.quick-reply')).toHaveLength(1);
      expect((screen.getByRole('textbox', { name: '输入回复' }) as HTMLTextAreaElement).value).toBe(`回复 ${index}`);
    }
  });

  it('opens and focuses the collapsed mobile reply from the reader action without creating a second draft', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 720px)',
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    const input = props();
    render(<ReaderPane {...input} />);
    expect(screen.queryByRole('textbox', { name: '输入回复' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '输入回复' }));
    expect(input.onComposeFromMessage).not.toHaveBeenCalled();
    expect(input.onQuickReplyChange).not.toHaveBeenCalled();
  });

  it('continues the visible reply from the toolbar and expands the same draft', () => {
    const input = props({ quickReplyBody: '已经写到这里，继续回复。' });
    render(<ReaderPane {...input} />);
    const editor = screen.getByRole('textbox', { name: '输入回复' }) as HTMLTextAreaElement;
    editor.setSelectionRange(5, 5);
    const scrollIntoView = vi.fn();
    editor.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('已经写到这里，继续回复。');
    expect(editor.selectionStart).toBe(5);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    expect(input.onComposeFromMessage).not.toHaveBeenCalled();
    expect(input.onQuickReplyChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '展开回复' }));
    expect(input.onComposeFromMessage).toHaveBeenCalledWith(input.selected, 'reply', input.quickReplyBody);
    expect(editor.value).toBe(input.quickReplyBody);
  });

  it('registers the ready current reply for shared shortcuts and clears it during loading or unmount', () => {
    const target: NonNullable<ReaderPaneProps['readerReplyRef']> = { current: null };
    const input = props({ readerReplyRef: target });
    const view = render(<ReaderPane {...input} />);
    expect(target.current?.key).toBe('1:1');
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    expect(input.onComposeFromMessage).toHaveBeenCalledWith(input.selected, 'reply');
    act(() => target.current?.focus());
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '输入回复' }));
    view.rerender(<ReaderPane {...input} attachmentsLoaded={false} />);
    expect(target.current).toBeNull();
    view.rerender(<ReaderPane {...input} selected={{ ...input.selected!, id: 2, account_id: 2 }} selectedId={2} activeSelectedId={2} />);
    expect(target.current?.key).toBe('2:2');
    view.unmount();
    expect(target.current).toBeNull();
  });

  it('targets only the newly selected reply after switching messages', () => {
    const input = props({ quickReplyBody: 'Ada 的回复' });
    const view = render(<ReaderPane {...input} />);
    view.rerender(<ReaderPane {...input} selected={{ ...input.selected!, id: 2, sender_name: 'Lin' }} selectedId={2} activeSelectedId={2} quickReplyBody="Lin 的回复" />);
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    const editor = screen.getByRole('textbox', { name: '输入回复' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('Lin 的回复');
    expect(input.onComposeFromMessage).not.toHaveBeenCalled();
  });

  it('moves focus without animated scrolling when reduced motion is preferred', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    render(<ReaderPane {...props({ quickReplyBody: '继续草稿' })} />);
    const editor = screen.getByRole('textbox', { name: '输入回复' });
    const scrollIntoView = vi.fn();
    editor.scrollIntoView = scrollIntoView;
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    expect(document.activeElement).toBe(editor);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' });
  });

  it('carries the saved reply into the composer when the inline editor is unavailable', () => {
    const input = props({ quickReplyBody: '等待正文时保留的回复', attachmentsLoaded: false });
    render(<ReaderPane {...input} />);
    expect(screen.queryByRole('textbox', { name: '输入回复' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回复' }));
    expect(input.onComposeFromMessage).toHaveBeenCalledWith(input.selected, 'reply', input.quickReplyBody);
    expect(input.onQuickReplyChange).not.toHaveBeenCalled();
  });

  it('does not rescan HTML or replace the rendered message while typing a reply', () => {
    const input = props();
    const view = render(<ReaderPane {...input} />);
    const body = view.container.querySelector('.reader-html')?.shadowRoot?.querySelector('p');
    expect(body?.textContent).toBe('正文内容');
    vi.clearAllMocks();
    for (const reply of ['新', '新的', '新的回复']) view.rerender(<ReaderPane {...input} quickReplyBody={reply} />);
    expect(mailUtils.htmlHasRenderableContent).not.toHaveBeenCalled();
    expect(mailUtils.htmlHasRemoteVisualContent).not.toHaveBeenCalled();
    expect(view.container.querySelector('.reader-html')?.shadowRoot?.querySelector('p')).toBe(body);
  });

  it('gates large raw bodies before HTML scanning and allows one explicit render', () => {
    const input = props();
    input.selected = { ...input.selected!, sanitized_html: `<p>${'正'.repeat(MAX_AUTO_RENDER_BODY_LENGTH)}</p>` };
    const view = render(<ReaderPane {...input} />);
    expect(view.container.querySelector('.reader-html')).toBeNull();
    expect(mailUtils.htmlHasRenderableContent).not.toHaveBeenCalled();
    expect(mailUtils.htmlHasRemoteVisualContent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '加载完整邮件' }));
    expect(view.container.querySelector('.reader-html')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '加载完整邮件' })).toBeNull();
    const withRemoteImages = { ...input.selected, sanitized_html: `${input.selected.sanitized_html}<img alt="图片" src="https://example.com/image.png">` };
    view.rerender(<ReaderPane {...input} selected={withRemoteImages} />);
    expect(screen.queryByRole('button', { name: '加载完整邮件' })).toBeNull();
    view.rerender(<ReaderPane {...input} selected={{ ...withRemoteImages, body: '全新正文' }} />);
    expect(screen.getByRole('button', { name: '加载完整邮件' })).toBeDefined();
  });

  it('shows a retryable detail failure without exposing actions for an old message', () => {
    const retry = vi.fn();
    render(<ReaderPane {...props({ selected: null, detailLoadState: { status: 'error', messageId: 1, error: 'offline' }, onRetryDetail: retry })} />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.queryByRole('button', { name: '归档' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新加载邮件' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('preserves the reading position while the same body reloads or fails', () => {
    const positions = new Map<string, number>();
    const input = props({ scrollPositions: positions });
    const view = render(<ReaderPane {...input} />);
    const panel = view.container.querySelector<HTMLElement>('.reader-panel')!;
    panel.scrollTop = 840;
    fireEvent.scroll(panel);
    view.rerender(<ReaderPane {...input} bodyFetchState={{ status: 'loading', messageId: 1, error: null }} />);
    // A skeleton or error surface is shorter than the cached body, so the
    // browser clamps scrollTop even though the user has not scrolled.
    panel.scrollTop = 0;
    fireEvent.scroll(panel);
    expect(positions.get('1:1')).toBe(840);
    view.rerender(<ReaderPane {...input} bodyFetchState={{ status: 'error', messageId: 1, error: 'offline' }} />);
    fireEvent.scroll(panel);
    expect(positions.get('1:1')).toBe(840);
    view.rerender(<ReaderPane {...input} bodyFetchState={null} />);
    expect(panel.scrollTop).toBe(840);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReaderBodyContent from './ReaderBodyContent';

vi.mock('./reader/EmailShadowView', () => ({ default: ({ html }: { html: string }) => <div data-testid="full-html">{html}</div> }));

afterEach(cleanup);

function renderBody(overrides: Partial<React.ComponentProps<typeof ReaderBodyContent>> = {}) {
  const props: React.ComponentProps<typeof ReaderBodyContent> = {
    isBodyRenderReady: true,
    showPlaceholder: false,
    hasRenderableHtml: false,
    shouldOfferRemoteContent: false,
    readerHtml: '',
    plainBodyForReader: '',
    linksHidden: true,
    handleReaderHtmlClick: vi.fn(),
    handleReaderHtmlContextMenu: vi.fn(),
    onAllowRemoteImagesOnce: vi.fn(),
    onOpenLink: vi.fn(),
    onComposeNew: vi.fn(),
    ...overrides,
  };
  return render(<ReaderBodyContent {...props} />);
}

describe('ReaderBodyContent remote body states', () => {
  it('never returns an unlabelled empty node while body preparation is unavailable', () => {
    renderBody({ isBodyRenderReady: false, showPlaceholder: false });
    expect(screen.getByRole('status').textContent).toContain('正在准备邮件正文');
  });
  it('shows a stable busy state while the remote body is loading', () => {
    renderBody({ bodyFetchStatus: 'loading' });
    expect(screen.getByLabelText('正在加载邮件正文').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('无正文')).toBeNull();
  });

  it.each([true, false])('keeps fetch failures retryable when body render readiness is %s', (isBodyRenderReady) => {
    const onRetryBodyFetch = vi.fn();
    renderBody({
      bodyFetchStatus: 'error',
      isBodyRenderReady,
      bodyFetchError: '网络连接不可用',
      onRetryBodyFetch,
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('无法加载邮件正文');
    expect(alert.textContent).toContain('网络连接不可用');
    fireEvent.click(screen.getByRole('button', { name: '重试拉取正文' }));
    expect(onRetryBodyFetch).toHaveBeenCalledOnce();
  });

  it('keeps the empty-body state only for a successfully loaded empty message', () => {
    renderBody();
    expect(screen.getByRole('status').textContent).toContain('无正文');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('defers expensive HTML rendering without losing its tail', () => {
    const html = `<div>${'长正文'.repeat(90_000)}</div><p>unique-tail</p>`;
    renderBody({ hasRenderableHtml: true, readerHtml: html });
    expect(screen.queryByTestId('full-html')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载完整邮件' }));
    expect(screen.getByTestId('full-html').textContent).toBe(html);
    expect(screen.getByTestId('full-html').textContent).toContain('unique-tail');
  });

  it('defers large plain text without truncating content after expansion', () => {
    const body = '完整纯文本'.repeat(60_000) + '\nunique-plain-tail';
    renderBody({ plainBodyForReader: body });
    expect(document.body.textContent).not.toContain('unique-plain-tail');
    fireEvent.click(screen.getByRole('button', { name: '加载完整邮件' }));
    expect(document.body.textContent).toContain('unique-plain-tail');
  });

  it('renders the translated body in place of the original body', () => {
    renderBody({
      hasRenderableHtml: true,
      readerHtml: '<p>Original body</p>',
      translation: { format: 'html', content: '<p>译文正文</p><a href="https://example.com">链接</a>' },
    });

    expect(screen.getByTestId('full-html').textContent).toContain('译文正文');
    expect(screen.getByTestId('full-html').textContent).not.toContain('Original body');
  });

  it('renders plain translation instead of the original HTML and keeps empty translations on the source', () => {
    const view = renderBody({
      hasRenderableHtml: true,
      readerHtml: '<p>Original body</p>',
      translation: { format: 'plain', content: '纯文本译文' },
    });
    expect(screen.queryByTestId('full-html')).toBeNull();
    expect(screen.getByText('纯文本译文')).toBeDefined();
    view.unmount();
    renderBody({
      hasRenderableHtml: true,
      readerHtml: '<p>Original body</p>',
      translation: { format: 'plain', content: ' ' },
    });
    expect(screen.getByTestId('full-html').textContent).toContain('Original body');
  });

  it('keeps source expansion approval but requires approval for a newly oversized translation', () => {
    const html = `<p>${'正文'.repeat(130_000)}</p>`;
    const view = renderBody({ hasRenderableHtml: true, readerHtml: html, largeBodyApproved: true });
    expect(screen.getByTestId('full-html').textContent).toBe(html);
    view.unmount();
    renderBody({
      hasRenderableHtml: true, readerHtml: html, largeBodyApproved: true,
      translation: { format: 'html', content: `${html}<p>译文末尾</p>` },
    });
    expect(screen.queryByTestId('full-html')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '加载完整邮件' }));
    expect(screen.getByTestId('full-html').textContent).toContain('译文末尾');
  });

});

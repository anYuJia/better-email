import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReaderBodyContent from './ReaderBodyContent';

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
  it('shows a stable busy state while the remote body is loading', () => {
    renderBody({ bodyFetchStatus: 'loading' });
    expect(screen.getByLabelText('正在加载邮件内容').getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText('无正文')).toBeNull();
  });

  it('distinguishes a body fetch failure from a genuinely empty message and retries inline', () => {
    const onRetryBodyFetch = vi.fn();
    renderBody({
      bodyFetchStatus: 'error',
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
});

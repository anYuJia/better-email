import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReaderSecurityBanner from './ReaderSecurityBanner';

afterEach(cleanup);

function props(
  overrides: Partial<ComponentProps<typeof ReaderSecurityBanner>> = {},
): ComponentProps<typeof ReaderSecurityBanner> {
  return {
    warnings: ['检测到远程图片，默认已阻止自动加载。'],
    showRemoteImageNote: true,
    hasRenderableHtml: true,
    selectedSenderTrusted: false,
    selectedSenderDomain: 'example.com',
    selectedSenderIsExternal: false,
    selectedExternalBlocked: false,
    selectedWarnExternalSender: false,
    showLinkAction: true,
    linkActionLabel: '查看链接',
    onLinkAction: vi.fn(),
    onAllowRemoteImagesOnce: vi.fn(),
    onTrustSender: vi.fn(),
    onTrustDomain: vi.fn(),
    ...overrides,
  };
}

describe('ReaderSecurityBanner', () => {
  it('用紧凑隐私文案合并远程图片与隐藏链接状态', () => {
    const input = props();
    render(<ReaderSecurityBanner {...input} />);

    expect(screen.getByText('远程图片已拦截')).toBeDefined();
    expect(screen.getByText('图片未自动加载，网页链接也保持隐藏，以减少追踪和误触。')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '显示图片' }));
    fireEvent.click(screen.getByRole('button', { name: '查看链接' }));
    expect(input.onAllowRemoteImagesOnce).toHaveBeenCalledTimes(1);
    expect(input.onLinkAction).toHaveBeenCalledTimes(1);
  });

  it('外部内容被策略拦截时保留警示语义且不提供放行按钮', () => {
    render(<ReaderSecurityBanner {...props({
      selectedSenderIsExternal: true,
      selectedExternalBlocked: true,
      showLinkAction: false,
    })} />);

    const notice = screen.getByLabelText('安全提示');
    expect(notice.classList.contains('is-caution')).toBe(true);
    expect(screen.getByText('已拦截外部内容')).toBeDefined();
    expect(screen.queryByRole('button', { name: '显示图片' })).toBeNull();
  });
});

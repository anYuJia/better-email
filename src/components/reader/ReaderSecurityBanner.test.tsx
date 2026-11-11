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
    expect(screen.getByText('图片未自动加载，网页链接也保持隐藏，以减少追踪和误触。').parentElement?.hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '远程图片已拦截' }));
    expect(screen.getByText('图片未自动加载，网页链接也保持隐藏，以减少追踪和误触。')).toBeDefined();
    expect(screen.getByText('更多')).toBeDefined();
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

  it('expands the low-risk explanation without allowing images or trusting the sender', () => {
    const input = props();
    render(<ReaderSecurityBanner {...input} />);
    const disclosure = screen.getByRole('button', { name: '远程图片已拦截' });
    const notes = document.getElementById(disclosure.getAttribute('aria-controls')!);
    expect(notes?.hidden).toBe(true);
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(notes?.hidden).toBe(false);
    expect(notes?.parentElement).toBe(screen.getByLabelText('安全提示'));
    expect(screen.getByRole('button', { name: '显示图片' })).toBeDefined();
    expect(screen.getByLabelText('更多安全选项')).toBeDefined();
    expect(input.onAllowRemoteImagesOnce).not.toHaveBeenCalled();
    expect(input.onTrustSender).not.toHaveBeenCalled();
    fireEvent.click(disclosure);
    expect(notes?.hidden).toBe(true);
  });

  it('keeps suspicious-content warnings visible without requiring disclosure', () => {
    render(<ReaderSecurityBanner {...props({ warnings: ['发件人身份校验失败，请核对邮件内容。'] })} />);
    const warning = screen.getByText('发件人身份校验失败，请核对邮件内容。');
    expect(warning.parentElement?.hidden).toBe(false);
    expect(screen.getByLabelText('安全提示').classList.contains('is-caution')).toBe(true);
    expect(screen.queryByRole('button', { name: '请核对邮件内容' })).toBeNull();
    expect(screen.getByRole('button', { name: '显示图片' })).toBeDefined();
  });

  it('一般风险展示紧凑横幅与提醒条数并支持展开收起', () => {
    render(
      <ReaderSecurityBanner
        {...props({
          warnings: [],
          selectedWarnExternalSender: true,
          showRemoteImageNote: false,
          showLinkAction: false,
        })}
      />,
    );

    const banner = screen.getByLabelText('安全提示');
    expect(banner.classList.contains('is-caution')).toBe(true);
    expect(banner.classList.contains('is-general-risk')).toBe(true);
    expect(screen.getByText('请核对外部发件人')).toBeDefined();
    expect(screen.getByText('1 项提醒')).toBeDefined();
    expect(screen.getAllByText('这封邮件来自其他邮箱 / 外部发件人，请注意核对发件人身份。').length).toBeGreaterThanOrEqual(1);

    const expandBtn = screen.getByRole('button', { name: '查看详情' });
    expect(expandBtn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expandBtn);
    expect(expandBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('收起详情')).toBeDefined();
  });
});

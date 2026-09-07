import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MobileBottomNav from './MobileBottomNav';

function renderNav(filter: 'all' | 'starred' = 'all') {
  const handlers = {
    onOpenMail: vi.fn(),
    onOpenStarred: vi.fn(),
    onCompose: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  const view = render(<MobileBottomNav filter={filter} {...handlers} />);
  return { ...handlers, ...view };
}

describe('MobileBottomNav', () => {
  it('keeps all four primary mobile actions reachable', () => {
    const handlers = renderNav();

    const mail = screen.getByRole('button', { name: '邮件' });
    const starred = screen.getByRole('button', { name: '星标' });
    const compose = screen.getByRole('button', { name: '写邮件' });
    const settings = screen.getByRole('button', { name: '设置' });

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(mail).toHaveAttribute('aria-current', 'page');
    expect(starred).not.toHaveAttribute('aria-current');

    fireEvent.click(mail);
    fireEvent.click(starred);
    fireEvent.click(compose);
    fireEvent.click(settings);

    expect(handlers.onOpenMail).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenStarred).toHaveBeenCalledTimes(1);
    expect(handlers.onCompose).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('marks starred as the active destination when the starred filter is open', () => {
    renderNav('starred');

    expect(screen.getByRole('button', { name: '邮件' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: '星标' })).toHaveAttribute('aria-current', 'page');
  });
});

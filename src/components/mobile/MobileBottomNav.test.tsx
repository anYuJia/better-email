import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileBottomNav from './MobileBottomNav';

afterEach(() => {
  cleanup();
});

function renderNav(filter: 'all' | 'starred' = 'all') {
  const handlers = {
    onOpenMail: vi.fn(),
    onOpenStarred: vi.fn(),
    onCompose: vi.fn(),
    onComposeIntent: vi.fn(),
    onOpenSettings: vi.fn(),
  };
  const view = render(<MobileBottomNav filter={filter} {...handlers} />);
  return { ...handlers, ...view };
}

describe('MobileBottomNav', () => {
  it('keeps compose reachable without duplicating the mailbox drawer navigation', () => {
    const handlers = renderNav();

    const compose = screen.getByRole('button', { name: '写邮件' });
    expect(screen.getByRole('group', { name: '邮件快捷操作' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toEqual([compose]);
    fireEvent.click(compose);
    expect(handlers.onCompose).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenMail).not.toHaveBeenCalled();
    expect(handlers.onOpenStarred).not.toHaveBeenCalled();
    expect(handlers.onOpenSettings).not.toHaveBeenCalled();
  });

  it('prepares the composer on pointer or keyboard intent without opening it early', () => {
    const handlers = renderNav('starred');
    const compose = screen.getByRole('button', { name: '写邮件' });
    fireEvent.pointerDown(compose);
    fireEvent.focus(compose);
    expect(handlers.onComposeIntent).toHaveBeenCalledTimes(2);
    expect(handlers.onCompose).not.toHaveBeenCalled();
  });
});

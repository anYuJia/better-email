import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import MailboxLoadingPlaceholder from './MailboxLoadingPlaceholder';

afterEach(cleanup);

describe('mailbox loading identity', () => {
  it('immediately presents static mail rows and keeps their decorative content out of the status announcement', () => {
    const view = render(<MailboxLoadingPlaceholder listMode="messages" />);
    expect(screen.getByRole('status').textContent).toBe('正在加载邮件…');
    expect(view.container.querySelectorAll('.mailbox-load-row')).toHaveLength(4);
    expect(view.container.querySelectorAll('[aria-hidden="true"] .mailbox-load-avatar')).toHaveLength(4);
    expect(view.container.querySelectorAll('.mailbox-load-lines > span')).toHaveLength(12);
  });

  it('changes to the conversation structure while waiting instead of promising mail avatars', () => {
    const view = render(<MailboxLoadingPlaceholder listMode="messages" />);
    view.rerender(<MailboxLoadingPlaceholder listMode="threads" />);
    expect(screen.getByRole('status').textContent).toBe('正在加载会话…');
    expect(view.container.querySelectorAll('.mailbox-load-avatar')).toHaveLength(0);
    expect(view.container.querySelector('[data-list-mode="threads"]')).not.toBeNull();
    expect(view.container.querySelectorAll('.mailbox-load-row')).toHaveLength(4);
  });
});

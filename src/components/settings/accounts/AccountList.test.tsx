import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../../../app/types';
import AccountList from './AccountList';

afterEach(cleanup);

const accounts = [
  {
    id: 1,
    display_name: '工作邮箱',
    email: 'work@example.com',
    provider: 'gmail',
    is_default: true,
  },
  {
    id: 2,
    display_name: '个人邮箱',
    email: 'personal@example.com',
    provider: 'icloud',
    is_default: false,
  },
] as Account[];

describe('AccountList semantics', () => {
  it('uses list/listitem semantics and exposes the current account', () => {
    render(
      <AccountList
        accounts={accounts}
        activeAccountId={2}
        accountCount={accounts.length}
        onAdd={() => undefined}
        onOpen={() => undefined}
      />,
    );

    const list = screen.getByRole('list', { name: '邮箱账号' });
    const items = within(list).getAllByRole('listitem');

    expect(items).toHaveLength(2);
    expect(items[0].hasAttribute('aria-current')).toBe(false);
    expect(items[1].getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('keeps each row action independently operable', () => {
    const onOpen = vi.fn();
    render(
      <AccountList
        accounts={accounts}
        activeAccountId={1}
        accountCount={accounts.length}
        onAdd={() => undefined}
        onOpen={onOpen}
      />,
    );

    const personalRow = screen.getAllByRole('listitem')[1];
    fireEvent.click(within(personalRow).getByRole('button', { name: /个人邮箱/ }));
    fireEvent.click(within(personalRow).getByRole('button', { name: '删除' }));

    expect(onOpen).toHaveBeenNthCalledWith(1, accounts[1], 'config');
    expect(onOpen).toHaveBeenNthCalledWith(2, accounts[1], 'delete');
  });
});

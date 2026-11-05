import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccountScope } from '../app/types';
import useMailboxIdentityLabels from './useMailboxIdentityLabels';

afterEach(cleanup);

describe('useMailboxIdentityLabels', () => {
  it('uses full addresses for colliding or blank names while keeping unique source names concise', () => {
    const accounts = [
      { id: 1, display_name: ' Work ', email: 'first@example.com' },
      { id: 2, display_name: 'work', email: 'second@example.com' },
      { id: 3, display_name: '   ', email: 'blank@example.com' },
      { id: 4, display_name: ' 私人邮箱 ', email: 'personal@example.com' },
    ];
    const { result } = renderHook(() => useMailboxIdentityLabels({ accounts, accountScope: 'all' }));
    expect([...result.current.accountSourceLabels]).toEqual([
      [1, 'first@example.com'], [2, 'second@example.com'], [3, 'blank@example.com'], [4, '私人邮箱'],
    ]);
  });

  it('follows the target scope immediately and preserves empty or missing account fallbacks', () => {
    const accounts = [
      { id: 1, display_name: '旧账号', email: 'old@example.com' },
      { id: 2, display_name: '新账号', email: 'new@example.com' },
      { id: 3, display_name: '', email: 'address@example.com' },
    ];
    const view = renderHook(({ accountScope }: { accountScope: AccountScope }) => (
      useMailboxIdentityLabels({ accounts, accountScope })
    ), { initialProps: { accountScope: 'all' as AccountScope } });
    expect(view.result.current.mobileAccountScopeLabel).toBe('统一邮箱');
    const sourceLabels = view.result.current.accountSourceLabels;
    view.rerender({ accountScope: 1 });
    expect(view.result.current.mobileAccountScopeLabel).toBe('旧账号');
    view.rerender({ accountScope: 2 });
    expect(view.result.current.mobileAccountScopeLabel).toBe('新账号');
    expect(view.result.current.accountSourceLabels).toBe(sourceLabels);
    view.rerender({ accountScope: 3 });
    expect(view.result.current.mobileAccountScopeLabel).toBe('address@example.com');
    view.rerender({ accountScope: 99 });
    expect(view.result.current.mobileAccountScopeLabel).toBe('邮箱');
  });

  it('updates source identity and the active scope after account metadata changes', () => {
    const accounts = [{ id: 1, display_name: '工作', email: 'work@example.com' }];
    const view = renderHook(({ entries }) => useMailboxIdentityLabels({ accounts: entries, accountScope: 1 }), {
      initialProps: { entries: accounts },
    });
    view.rerender({ entries: [{ ...accounts[0], display_name: '项目组' }, { id: 2, display_name: '项目组', email: 'team@example.com' }] });
    expect([...view.result.current.accountSourceLabels]).toEqual([[1, 'work@example.com'], [2, 'team@example.com']]);
    expect(view.result.current.mobileAccountScopeLabel).toBe('项目组');
  });
});

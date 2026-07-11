import React from 'react';
import { ChevronDown, Mail, Mails, Star } from 'lucide-react';
import type { Account, AccountScope } from '../app/types';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import './account-switcher.css';

type AccountSwitcherProps = {
  accountScope: AccountScope;
  accounts: Account[];
  onChange: (value: string) => void;
  onSetDefault: (accountId: number) => void;
};

function providerLabel(provider: string) {
  const value = provider.trim();
  if (!value) return '邮箱账号';
  const knownProviders: Record<string, string> = {
    gmail: 'Gmail',
    google: 'Gmail',
    icloud: 'iCloud',
    microsoft: 'Microsoft',
    netease: '网易邮箱',
    outlook: 'Outlook',
    qq: 'QQ 邮箱',
  };
  const knownProvider = knownProviders[value.toLowerCase()];
  if (knownProvider) return knownProvider;
  return value.length <= 4 ? value.toUpperCase() : `${value[0].toUpperCase()}${value.slice(1)}`;
}

export default function AccountSwitcher({
  accountScope,
  accounts,
  onChange,
  onSetDefault,
}: AccountSwitcherProps) {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const selectedAccount = accountScope === 'all'
    ? null
    : accounts.find((account) => account.id === accountScope) ?? null;
  const defaultAccount = accounts.find((account) => account.is_default) ?? accounts[0] ?? null;
  const primaryLabel = selectedAccount?.display_name.trim()
    || selectedAccount?.email
    || '统一邮箱';
  const secondaryLabel = selectedAccount
    ? selectedAccount.email
    : accounts.length > 1
      ? `${accounts.length} 个账号`
      : defaultAccount?.email ?? '全部账号';

  function openMenu(x: number, y: number) {
    setMenu({ x, y });
  }

  const items: ContextMenuItem[] = [
    {
      id: 'account-scope-all',
      label: '统一邮箱',
      detail: `${accounts.length || 1} 个账号汇总`,
      icon: <Mails size={15} />,
      checked: accountScope === 'all',
      onSelect: () => onChange('all'),
    },
    ...accounts.map((account, index) => ({
      id: `account-scope-${account.id}`,
      label: account.display_name.trim() || account.email,
      detail: `${providerLabel(account.provider)} · ${account.email}${account.is_default ? ' · 默认发件' : ''}`,
      icon: <Mail size={15} />,
      checked: accountScope === account.id,
      separatorBefore: index === 0,
      onSelect: () => onChange(String(account.id)),
    })),
  ];
  if (selectedAccount) {
    items.push({
      id: 'set-default-account',
      label: selectedAccount.is_default ? '默认发件账号' : '设为默认发件账号',
      detail: selectedAccount.is_default ? '统一邮箱写信优先使用此账号' : '统一邮箱写信时优先使用',
      icon: <Star size={15} />,
      checked: selectedAccount.is_default,
      disabled: selectedAccount.is_default,
      separatorBefore: true,
      onSelect: () => onSetDefault(selectedAccount.id),
    });
  }

  return (
    <section
      className="account-switcher"
      data-account-scope={String(accountScope)}
      aria-label="邮箱范围"
    >
      <button
        type="button"
        className="account-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          openMenu(bounds.left, bounds.bottom + 6);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(event.clientX, event.clientY);
        }}
      >
        <span className="account-switcher-copy">
          <strong>{primaryLabel}</strong>
          <span>{secondaryLabel}</span>
        </span>
        <ChevronDown className="account-switcher-chevron" size={16} aria-hidden="true" />
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          className="account-switcher-menu"
          title="切换邮箱范围"
          detail={selectedAccount?.email ?? (defaultAccount ? `默认发件：${defaultAccount.email}` : '查看全部账号的统一收件箱')}
          ariaLabel="邮箱范围选择"
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

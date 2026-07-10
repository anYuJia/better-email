import React from 'react';
import { ChevronDown, Mail, Mails } from 'lucide-react';
import type { Account, AccountScope } from '../app/types';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import './account-switcher.css';

type AccountSwitcherProps = {
  accountScope: AccountScope;
  accounts: Account[];
  onChange: (value: string) => void;
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
}: AccountSwitcherProps) {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const selectedAccount = accountScope === 'all'
    ? null
    : accounts.find((account) => account.id === accountScope) ?? null;
  const primaryLabel = selectedAccount?.display_name.trim()
    || selectedAccount?.email
    || '统一邮箱';
  const secondaryLabel = selectedAccount
    ? `${providerLabel(selectedAccount.provider)} · ${selectedAccount.email}`
    : `${accounts.length || 1} 个账号汇总`;

  function openMenu(x: number, y: number) {
    setMenu({ x, y });
  }

  const items: ContextMenuItem[] = [
    {
      id: 'account-scope-all',
      label: '统一邮箱',
      icon: <Mails size={15} />,
      checked: accountScope === 'all',
      onSelect: () => onChange('all'),
    },
    ...accounts.map((account, index) => ({
      id: `account-scope-${account.id}`,
      label: account.display_name.trim() || account.email,
      icon: <Mail size={15} />,
      checked: accountScope === account.id,
      separatorBefore: index === 0,
      onSelect: () => onChange(String(account.id)),
    })),
  ];

  return (
    <section
      className="account-switcher"
      data-account-scope={String(accountScope)}
      aria-label="邮箱范围"
    >
      <div className="account-switcher-heading">
        <span>邮箱范围</span>
        <em>{accounts.length || 1} 个账号</em>
      </div>
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
        <span className="account-switcher-icon" aria-hidden="true">
          {selectedAccount ? <Mail size={16} /> : <Mails size={16} />}
        </span>
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
          title="切换邮箱范围"
          detail={selectedAccount?.email ?? '查看全部账号的统一收件箱'}
          ariaLabel="邮箱范围选择"
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

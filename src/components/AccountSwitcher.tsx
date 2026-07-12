import React from 'react';
import { ChevronDown, Mail, Mails, Plus, Star } from 'lucide-react';
import type { Account, AccountScope } from '../app/types';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import './account-switcher.css';

type AccountSwitcherProps = {
  accountScope: AccountScope;
  accounts: Account[];
  onChange: (value: string) => void;
  onSetDefault: (accountId: number) => void;
  onAddAccount: () => void;
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
  onAddAccount,
}: AccountSwitcherProps) {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const selectedAccount = accountScope === 'all'
    ? null
    : accounts.find((account) => account.id === accountScope) ?? null;
  const defaultAccount = accounts.find((account) => account.is_default) ?? accounts[0] ?? null;
  const primaryLabel = selectedAccount?.display_name.trim()
    || selectedAccount?.email
    || '统一邮箱';
  const secondaryLabel = selectedAccount
    ? [
        selectedAccount.email,
        providerLabel(selectedAccount.provider),
        selectedAccount.is_default ? '默认' : '',
      ].filter(Boolean).join(' · ')
    : accounts.length > 1
      ? `${accounts.length} 个账号`
      : defaultAccount?.email ?? '全部账号';

  function openMenu(x: number, y: number) {
    setMenu({ x, y });
  }

  function openMenuFromTrigger() {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    openMenu(bounds.left, bounds.bottom + 6);
  }

  const items: ContextMenuItem[] = [
    {
      id: 'account-scope-all',
      label: '统一邮箱',
      detail: accounts.length > 1 ? `${accounts.length} 个账号` : defaultAccount?.email,
      icon: <Mails size={15} />,
      checked: accountScope === 'all',
      onSelect: () => onChange('all'),
    },
    ...accounts.map((account, index) => ({
      id: `account-scope-${account.id}`,
      label: account.display_name.trim() || account.email,
      detail: account.is_default
        ? `${account.email} · ${providerLabel(account.provider)} · 默认发件`
        : `${account.email} · ${providerLabel(account.provider)}`,
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
      detail: undefined,
      icon: <Star size={15} />,
      checked: selectedAccount.is_default,
      disabled: selectedAccount.is_default,
      separatorBefore: true,
      onSelect: () => onSetDefault(selectedAccount.id),
    });
  }
  items.push({
    id: 'add-account',
    label: '添加邮箱',
    icon: <Plus size={15} />,
    separatorBefore: true,
    onSelect: onAddAccount,
  });

  return (
    <section
      className="account-switcher"
      data-account-scope={String(accountScope)}
      aria-label="邮箱范围"
    >
      <button
        ref={triggerRef}
        type="button"
        className="account-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (menu) {
            setMenu(null);
            return;
          }
          openMenuFromTrigger();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!menu) openMenuFromTrigger();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
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
          closeIgnoreRef={triggerRef}
          ariaLabel="邮箱范围选择"
          onClose={() => setMenu(null)}
        />
      )}
    </section>
  );
}

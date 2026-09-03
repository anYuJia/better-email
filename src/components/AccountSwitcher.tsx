import React from 'react';
import { ChevronDown, Plus, Star } from 'lucide-react';
import type { Account, AccountScope } from '../app/types';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';
import './account-switcher.css';

type AccountSwitcherProps = {
  accountScope: AccountScope;
  accounts: Account[];
  onChange: (value: string) => void;
  onSetDefault: (accountId: number) => void;
  onAddAccount: () => void;
  disabled?: boolean;
  className?: string;
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
  disabled = false,
  className = '',
}: AccountSwitcherProps) {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const selectedAccount = accountScope === 'all'
    ? null
    : accounts.find((account) => account.id === accountScope) ?? null;
  const accountCountLabel = `${accounts.length} 个账号`;
  const allAccountsSecondaryLabel = accounts.length > 0
    ? `所有邮箱账号 · ${accountCountLabel}`
    : '所有邮箱账号';
  const primaryLabel = selectedAccount?.display_name.trim()
    || selectedAccount?.email
    || '统一邮箱';
  const secondaryLabel = selectedAccount
    ? selectedAccount.email
    : allAccountsSecondaryLabel;

  function openMenu(x: number, y: number) {
    setMenu({ x, y });
  }

  function openMenuFromTrigger() {
    const trigger = triggerRef.current;
    trigger?.focus({ preventScroll: true });
    const bounds = trigger?.getBoundingClientRect();
    if (!bounds) return;
    openMenu(bounds.left, bounds.bottom + 6);
  }

  const items: ContextMenuItem[] = [
    {
      id: 'account-scope-all',
      label: '统一邮箱',
      detail: allAccountsSecondaryLabel,
      checked: accountScope === 'all',
      selectionRole: 'radio' as const,
      onSelect: () => onChange('all'),
    },
    ...accounts.map((account, index) => {
      const provider = providerLabel(account.provider);
      const displayName = account.display_name.trim();
      const hasDistinctDisplayName = Boolean(displayName && displayName !== account.email);
      const isProviderInName = hasDistinctDisplayName && displayName.toLowerCase().includes(provider.toLowerCase());

      const detailParts: string[] = [];
      if (hasDistinctDisplayName) {
        detailParts.push(account.email);
        if (!isProviderInName && provider && provider !== '邮箱账号') {
          detailParts.push(provider);
        }
      } else if (provider && provider !== '邮箱账号') {
        detailParts.push(provider);
      }
      if (account.is_default) {
        detailParts.push('默认发件');
      }

      return {
        id: `account-scope-${account.id}`,
        label: displayName || account.email,
        detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
        checked: accountScope === account.id,
        selectionRole: 'radio' as const,
        separatorBefore: index === 0,
        onSelect: () => onChange(String(account.id)),
      };
    }),
  ];
  if (selectedAccount) {
    items.push({
      id: 'set-default-account',
      label: selectedAccount.is_default ? '默认发件账号' : '设为默认发件账号',
      detail: undefined,
      icon: <Star size={14} />,
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
      className={`account-switcher ${className}`.trim()}
      data-account-scope={String(accountScope)}
      aria-label="邮箱范围"
    >
      <button
        ref={triggerRef}
        type="button"
        className="account-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        disabled={disabled}
        onPointerDown={(event) => {
          // 开关交给 onClick 统一处理，但保留按钮的标准聚焦行为。
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (menu) {
            setMenu(null);
            return;
          }
          openMenuFromTrigger();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          triggerRef.current?.focus({ preventScroll: true });
          openMenu(event.clientX, event.clientY);
        }}
      >
        <span className="account-switcher-copy">
          <strong>{primaryLabel}</strong>
          <span>{secondaryLabel}</span>
        </span>
        <ChevronDown className="account-switcher-chevron" size={16} aria-hidden="true" />
      </button>

      {menu && !disabled && (
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

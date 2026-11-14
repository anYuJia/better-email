import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { Account, AccountScope } from '../../app/types';
import {
  accountScopedSections,
  getSettingsDetailItems,
  settingsSearchEntries,
  settingsNavigationGroups,
  type SettingsSearchEntry,
  type SettingsSectionId,
} from '../settings/settingsNavigation';

type MobileSettingsRootProps = {
  account: Account | null;
  accounts: Account[];
  accountScope?: AccountScope;
  onBack: () => void;
  onOpenSection: (section: SettingsSectionId, searchTarget?: SettingsSearchEntry) => void;
};

export default function MobileSettingsRoot({
  account,
  accounts,
  accountScope = account?.id ?? 'all',
  onBack,
  onOpenSection,
}: MobileSettingsRootProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => normalizedQuery
    ? settingsSearchEntries.filter((entry) => (
      `${entry.label} ${entry.path} ${entry.keywords.join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery)
    )).slice(0, 10)
    : [], [normalizedQuery]);
  const activeAccount = accountScope === 'all'
    ? null
    : accounts.find((candidate) => candidate.id === accountScope) ?? account;
  const accountLabel = accountScope === 'all'
    ? '所有邮箱账号'
    : activeAccount?.display_name || activeAccount?.email || '账号';
  return (
    <section className="mobile-settings-root" aria-label="设置">
      <header className="mobile-settings-header">
        <button type="button" className="mobile-header-icon" aria-label="返回邮箱" onClick={onBack}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h1>设置</h1>
        <span aria-hidden="true" />
      </header>

      <div className="mobile-settings-scroll">
        <button
          type="button"
          className="mobile-settings-account-summary"
          aria-label="打开账号设置"
          onClick={() => onOpenSection('accounts')}
        >
          <span className="mobile-settings-account-avatar" aria-hidden="true">
            {(accountLabel || 'B').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{accountLabel}</strong>
            <span>{accountScope === 'all'
              ? `${accounts.length} 个邮箱账号`
              : activeAccount?.email || (accounts.length ? `${accounts.length} 个账号` : '添加或管理邮箱账号')}</span>
          </div>
          <ChevronRight size={16} aria-hidden="true" />
        </button>

        <form
          className="mobile-settings-search"
          role="search"
          onSubmit={(event) => event.preventDefault()}
        >
          <input
            type="search"
            aria-label="搜索设置"
            value={query}
            placeholder="搜索设置"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </form>

        {normalizedQuery ? (
          <section className="mobile-settings-search-results" aria-label="设置搜索结果">
            <h2>搜索结果</h2>
            {searchResults.length > 0 ? searchResults.map((entry) => {
              const requiresAccount = entry.section !== 'accounts'
                && (accountScopedSections.has(entry.section)
                  || getSettingsDetailItems(entry.section).some((detailItem) => (
                    accountScopedSections.has(detailItem.id)
                  )));
              const disabled = requiresAccount && accounts.length === 0;
              return (
                <button
                  type="button"
                  className="mobile-settings-row"
                  key={`${entry.section}-${entry.label}`}
                  disabled={disabled}
                  title={disabled ? '请先添加或选择邮箱账号' : entry.path}
                  onClick={() => onOpenSection(entry.section, entry)}
                >
                  <span className="mobile-settings-row-copy">
                    <strong>{entry.label}</strong>
                    <small>{entry.path}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              );
            }) : (
              <p className="mobile-settings-search-empty" role="status">没有匹配的设置，请换个关键词。</p>
            )}
          </section>
        ) : settingsNavigationGroups.map((group) => (
          <section className="mobile-settings-group" key={group.label}>
            <h2>{group.label}</h2>
            <div className="mobile-settings-group-list">
              {group.items.map((item) => {
                const Icon = item.icon;
                const requiresAccount = item.id !== 'accounts'
                  && (accountScopedSections.has(item.id)
                    || getSettingsDetailItems(item.id).some((detailItem) => (
                      accountScopedSections.has(detailItem.id)
                    )));
                const disabled = requiresAccount
                  && accounts.length === 0;
                return (
                  <button
                    type="button"
                    className="mobile-settings-row"
                    key={item.id}
                    disabled={disabled}
                    title={disabled ? '请先添加或选择邮箱账号' : item.description}
                    onClick={() => onOpenSection(item.id)}
                  >
                    <span className="mobile-settings-row-icon"><Icon size={20} aria-hidden="true" /></span>
                    <span className="mobile-settings-row-copy">
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

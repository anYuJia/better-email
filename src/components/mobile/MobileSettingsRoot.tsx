import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { Account } from '../../app/types';
import {
  accountScopedSections,
  settingsNavigationGroups,
  type SettingsSectionId,
} from '../settings/settingsNavigation';

type MobileSettingsRootProps = {
  account: Account | null;
  accounts: Account[];
  onBack: () => void;
  onOpenSection: (section: SettingsSectionId) => void;
};

export default function MobileSettingsRoot({
  account,
  accounts,
  onBack,
  onOpenSection,
}: MobileSettingsRootProps) {
  return (
    <section className="mobile-settings-root" aria-label="设置">
      <header className="mobile-settings-header">
        <button type="button" className="mobile-header-icon" aria-label="返回邮箱" onClick={onBack}>
          <ArrowLeft size={22} aria-hidden="true" />
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
            {(account?.display_name || account?.email || 'B').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{account?.display_name || account?.email || '账号'}</strong>
            <span>{account?.email || (accounts.length ? `${accounts.length} 个账号` : '添加或管理邮箱账号')}</span>
          </div>
          <ChevronRight size={18} aria-hidden="true" />
        </button>

        {settingsNavigationGroups.map((group) => (
          <section className="mobile-settings-group" key={group.label}>
            <h2>{group.label}</h2>
            <div className="mobile-settings-group-list">
              {group.items.map((item) => {
                const Icon = item.icon;
                const disabled = item.id !== 'accounts'
                  && accountScopedSections.has(item.id)
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
                    <ChevronRight size={18} aria-hidden="true" />
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

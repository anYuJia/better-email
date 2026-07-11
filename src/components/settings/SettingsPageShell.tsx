import type React from 'react';
import {
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import {
  settingsNavigationItems,
  type SettingsNavigationGroup,
  type SettingsNavigationItem,
  type SettingsSectionId,
} from './settingsNavigation';

type SettingsPageShellProps = {
  activeSection: SettingsSectionId;
  group: SettingsNavigationGroup;
  item: SettingsNavigationItem;
  pageIndex: number;
  children: React.ReactNode;
  onNavigate: (section: SettingsSectionId) => void;
};

export default function SettingsPageShell({
  activeSection,
  group,
  item,
  pageIndex,
  children,
  onNavigate,
}: SettingsPageShellProps) {
  const ActiveIcon = item.icon;
  const previousItem = settingsNavigationItems[pageIndex - 1];
  const nextItem = settingsNavigationItems[pageIndex + 1];
  const pageProgress = `${Math.round(((pageIndex + 1) / settingsNavigationItems.length) * 100)}%`;

  return (
    <section
      key={activeSection}
      className="settings-page"
      data-settings-page={activeSection}
      aria-labelledby={`settings-page-${activeSection}`}
      style={{ '--settings-page-progress': pageProgress } as React.CSSProperties}
    >
      <header className="settings-page-header">
        <div className="settings-page-heading">
          <span className="settings-page-icon" aria-hidden="true">
            <ActiveIcon size={18} />
          </span>
          <div>
            <span className="settings-page-kicker">{group.label}</span>
            <strong id={`settings-page-${activeSection}`}>{item.label}</strong>
          </div>
        </div>
        <span className="settings-page-count">
          {pageIndex + 1} / {settingsNavigationItems.length}
        </span>
        <p>{item.description}</p>
        <span className="settings-page-progress-bar" aria-hidden="true" />
      </header>
      <div className="settings-page-content">{children}</div>
      <nav className="settings-page-pagination" aria-label="设置页面导航">
        <button
          type="button"
          className="settings-page-pagination-button previous"
          disabled={!previousItem}
          aria-label={previousItem ? `上一页：${previousItem.label}` : '已经是第一页'}
          onClick={() => previousItem && onNavigate(previousItem.id)}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>
            <small>上一页</small>
            <strong>{previousItem?.label ?? '已经是第一页'}</strong>
          </span>
        </button>
        <button
          type="button"
          className="settings-page-pagination-button next"
          disabled={!nextItem}
          aria-label={nextItem ? `下一页：${nextItem.label}` : '已经是最后一页'}
          onClick={() => nextItem && onNavigate(nextItem.id)}
        >
          <span>
            <small>下一页</small>
            <strong>{nextItem?.label ?? '已经是最后一页'}</strong>
          </span>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </nav>
    </section>
  );
}

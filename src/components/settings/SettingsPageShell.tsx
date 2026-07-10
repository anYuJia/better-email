import type React from 'react';
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
};

export default function SettingsPageShell({
  activeSection,
  group,
  item,
  pageIndex,
  children,
}: SettingsPageShellProps) {
  const ActiveIcon = item.icon;

  return (
    <section
      key={activeSection}
      className="settings-page"
      data-settings-page={activeSection}
      aria-labelledby={`settings-page-${activeSection}`}
    >
      <header className="settings-page-header">
        <div className="settings-page-heading">
          <span className="settings-page-icon" aria-hidden="true">
            <ActiveIcon size={18} />
          </span>
          <div>
            <span>{group.label} · {pageIndex + 1}/{settingsNavigationItems.length}</span>
            <strong id={`settings-page-${activeSection}`}>{item.label}</strong>
          </div>
        </div>
        <p>{item.description}</p>
      </header>
      <div className="settings-page-content">{children}</div>
    </section>
  );
}

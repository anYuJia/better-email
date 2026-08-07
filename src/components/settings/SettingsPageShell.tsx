import { useEffect, useRef } from 'react';
import type React from 'react';
import type {
  SettingsNavigationGroup,
  SettingsNavigationItem,
  SettingsSectionId,
} from './settingsNavigation';

type SettingsPageShellProps = {
  activeSection: SettingsSectionId;
  group: SettingsNavigationGroup;
  item: SettingsNavigationItem;
  children: React.ReactNode;
};

export default function SettingsPageShell({
  activeSection,
  group,
  item,
  children,
}: SettingsPageShellProps) {
  const pageRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (pageRef.current) {
      pageRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  return (
    <section
      ref={pageRef}
      key={activeSection}
      className="settings-page"
      data-settings-page={activeSection}
      aria-labelledby={`settings-page-${activeSection}`}
    >
      <header className="settings-page-header">
        <div className="settings-page-heading">
          <span className="settings-page-kicker">{group.label}</span>
          <strong id={`settings-page-${activeSection}`}>{item.label}</strong>
        </div>
      </header>
      <div className="settings-page-content">{children}</div>
    </section>
  );
}

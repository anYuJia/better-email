import { useEffect, useRef } from 'react';
import type React from 'react';
import type {
  SettingsNavigationGroup,
  SettingsNavigationItem,
  SettingsSectionId,
} from './settingsNavigation';
import {
  accountScopedSections,
  getSettingsSectionPresentation,
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
  const presentation = getSettingsSectionPresentation(activeSection) ?? item;
  const accountWorkspace = accountScopedSections.has(activeSection);

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
      data-settings-group={group.label}
      aria-label={accountWorkspace ? presentation.label : undefined}
      aria-labelledby={accountWorkspace ? undefined : `settings-page-${activeSection}`}
      aria-describedby={accountWorkspace ? undefined : `settings-page-description-${activeSection}`}
    >
      {!accountWorkspace && (
        <header className="settings-page-header">
          <div className="settings-page-heading">
            <h2 id={`settings-page-${activeSection}`}>{presentation.label}</h2>
            <p id={`settings-page-description-${activeSection}`}>{presentation.description}</p>
          </div>
        </header>
      )}
      <div className="settings-page-content">{children}</div>
    </section>
  );
}

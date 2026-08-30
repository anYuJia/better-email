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
  resolveSettingsNavigationSectionId,
} from './settingsNavigation';

type SettingsPageShellProps = {
  activeSection: SettingsSectionId;
  group: SettingsNavigationGroup;
  item: SettingsNavigationItem;
  context?: React.ReactNode;
  children: React.ReactNode;
};

export default function SettingsPageShell({
  activeSection,
  group,
  item,
  context,
  children,
}: SettingsPageShellProps) {
  const pageRef = useRef<HTMLElement | null>(null);
  const previousSectionRef = useRef(activeSection);
  const presentation = getSettingsSectionPresentation(activeSection) ?? item;
  const accountWorkspace = accountScopedSections.has(activeSection);
  const previousSection = previousSectionRef.current;
  const relationshipMotion = previousSection === activeSection
    ? 'none'
    : resolveSettingsNavigationSectionId(activeSection) === previousSection
      ? 'forward'
      : resolveSettingsNavigationSectionId(previousSection) === activeSection
        ? 'backward'
        : 'lateral';
  const historyMotion = typeof window !== 'undefined'
    ? window.history.state?.betterEmailSettingsDirection
    : undefined;
  const pageMotion = relationshipMotion !== 'none'
    ? relationshipMotion
    : historyMotion === 'forward' || historyMotion === 'backward'
      ? historyMotion
      : 'none';

  useEffect(() => {
    if (pageRef.current) {
      pageRef.current.scrollTop = 0;
    }
    previousSectionRef.current = activeSection;
  }, [activeSection]);

  return (
    <section
      ref={pageRef}
      key={activeSection}
      className={`settings-page settings-page-motion-${pageMotion}`}
      data-settings-page={activeSection}
      data-page-motion={pageMotion}
      data-settings-group={group.label}
      aria-label={accountWorkspace ? presentation.label : undefined}
      aria-labelledby={accountWorkspace ? undefined : `settings-page-${activeSection}`}
      aria-describedby={accountWorkspace ? undefined : `settings-page-description-${activeSection}`}
    >
      <header className={`settings-page-header${context ? ' has-context' : ''}`}>
        <div className="settings-page-heading">
          <h2 id={`settings-page-${activeSection}`}>{presentation.label}</h2>
          <p id={`settings-page-description-${activeSection}`}>{presentation.description}</p>
        </div>
        {context && <div className="settings-page-context">{context}</div>}
      </header>
      <div className="settings-page-content">{children}</div>
    </section>
  );
}

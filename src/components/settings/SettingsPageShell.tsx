import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { Account, AccountScope } from '../../app/types';
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
  accountScope?: AccountScope;
  accounts?: Account[];
  children: React.ReactNode;
};

export default function SettingsPageShell({
  activeSection,
  group,
  item,
  accountScope = 'all',
  accounts = [],
  children,
}: SettingsPageShellProps) {
  const pageRef = useRef<HTMLElement | null>(null);
  const previousSectionRef = useRef(activeSection);
  const [settledSection, setSettledSection] = useState<SettingsSectionId | null>(null);
  const presentation = getSettingsSectionPresentation(activeSection) ?? item;
  const accountWorkspace = accountScopedSections.has(activeSection);
  const scopedAccount = accountScope === 'all'
    ? null
    : accounts.find((account) => account.id === accountScope) ?? null;
  const accountContext = accountWorkspace
    ? accountScope === 'all'
      ? accounts.length > 0 ? `所有邮箱账号 · ${accounts.length} 个账号` : '所有邮箱账号'
      : scopedAccount
        ? scopedAccount.display_name.trim() && scopedAccount.display_name.trim() !== scopedAccount.email
          ? `${scopedAccount.display_name.trim()} · ${scopedAccount.email}`
          : scopedAccount.email
        : '当前邮箱账号'
    : null;
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
  const requestedPageMotion = relationshipMotion !== 'none'
    ? relationshipMotion
    : historyMotion === 'forward' || historyMotion === 'backward'
      ? historyMotion
      : 'none';
  const pageMotion = settledSection === activeSection ? 'none' : requestedPageMotion;

  useEffect(() => {
    if (pageRef.current) {
      pageRef.current.scrollTop = 0;
    }
    previousSectionRef.current = activeSection;
    const settleTimer = window.setTimeout(() => setSettledSection(activeSection), 220);
    return () => window.clearTimeout(settleTimer);
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
      onAnimationEnd={(event) => {
        if (
          event.currentTarget === event.target
          && event.animationName.startsWith('settings-mobile-page-')
        ) {
          setSettledSection(activeSection);
        }
      }}
    >
      <header className="settings-page-header">
        <div className="settings-page-heading">
          <h2 id={`settings-page-${activeSection}`}>{presentation.label}</h2>
          <p id={`settings-page-description-${activeSection}`}>{presentation.description}</p>
          {accountContext && (
            <span className="settings-account-context" data-settings-account-context>
              {accountContext}
            </span>
          )}
        </div>
      </header>
      <div className="settings-page-content">{children}</div>
    </section>
  );
}

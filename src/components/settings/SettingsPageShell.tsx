import { useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import SettingsReadyContent from './SettingsReadyContent';
import type { Account, AccountScope } from '../../app/types';
import type {
  SettingsNavigationGroup,
  SettingsNavigationItem,
  SettingsSearchEntry,
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
  searchTarget?: SettingsSearchEntry | null;
  children: React.ReactNode;
};

export default function SettingsPageShell({
  activeSection,
  group,
  item,
  accountScope = 'all',
  accounts = [],
  searchTarget = null,
  children,
}: SettingsPageShellProps) {
  const pageRef = useRef<HTMLElement | null>(null);
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
  const historyMotion = typeof window !== 'undefined'
    ? window.history.state?.betterEmailSettingsDirection
    : undefined;
  const [transition, setTransition] = useState(() => ({
    section: activeSection,
    motion: historyMotion === 'forward' || historyMotion === 'backward' ? historyMotion : 'none',
  }));
  // The keyed DOM node plays once per navigation. Form edits/theme updates must
  // neither restart the reveal nor change its class midway through the motion.
  if (transition.section !== activeSection) {
    setTransition({
      section: activeSection,
      motion: resolveSettingsNavigationSectionId(activeSection) === transition.section
        ? 'forward'
        : resolveSettingsNavigationSectionId(transition.section) === activeSection
          ? 'backward' : 'lateral',
    });
  }
  const pageMotion = transition.motion;

  useLayoutEffect(() => {
    if (pageRef.current) {
      pageRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  return (
    <section
      ref={pageRef}
      className={`settings-page settings-page-motion-${pageMotion}`}
      data-settings-page={activeSection}
      data-page-motion={pageMotion}
      data-settings-group={group.label}
      aria-label={accountWorkspace ? presentation.label : undefined}
      aria-labelledby={accountWorkspace ? undefined : `settings-page-${activeSection}`}
      aria-describedby={accountWorkspace ? undefined : `settings-page-description-${activeSection}`}
    >
      <header className="settings-page-header">
        <div className="settings-page-heading">
          <h2 id={`settings-page-${activeSection}`}>{presentation.label}</h2>
          <p id={`settings-page-description-${activeSection}`}>{presentation.description}</p>
          {accountContext && (
            <span className="settings-account-context" data-settings-account-context>
              当前邮箱范围：{accountContext}
            </span>
          )}
        </div>
      </header>
      <div className="settings-page-content"><SettingsReadyContent key={activeSection} searchTarget={searchTarget?.section === activeSection ? searchTarget : null}>{children}</SettingsReadyContent></div>
    </section>
  );
}

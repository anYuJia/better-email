import { useEffect, useRef } from 'react';
import type React from 'react';
import {
  ArrowLeft,
  FlaskConical,
  LoaderCircle,
  Save,
  X,
} from 'lucide-react';
import SettingsPageShell from './SettingsPageShell';
import useModalAccessibility from '../../hooks/useModalAccessibility';
import {
  SettingsMobileNavigation,
  SettingsSidebar,
} from './SettingsNavigationControls';
import {
  accountScopedSections,
  connectionSettingsSections,
  generalScopedSections,
  getSettingsNavigationContext,
  settingsNavigationItems,
  type SettingsSectionId,
} from './settingsNavigation';
import './settings-tokens.css';
import './settings-foundation.css';
import './settings-layout.css';
import './settings-components.css';
import './settings-pages.css';
import './settings-v3.css';

export type { SettingsSectionId } from './settingsNavigation';

type SettingsFrameProps = {
  title: string;
  subtitle?: string;
  activeSection: SettingsSectionId;
  children: React.ReactNode;
  onNavigate: (section: SettingsSectionId) => void;
  onTestConnection: () => void;
  onSave: () => void;
  canSaveAndVerify?: boolean;
  isDirty?: boolean;
  isBusy?: boolean;
  connectionSummary?: string;
  onClose: () => void;
};

const saveAndVerifySettingsSections = new Set<SettingsSectionId>([
  'accounts',
  'providers',
  'auth',
  'privacy',
]);

const compactSettingsSections = new Set<SettingsSectionId>([
  'appearance',
  'sending',
]);

const accountWorkspaceTabs: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'accounts', label: '概览' },
  { id: 'providers', label: '服务器' },
  { id: 'auth', label: '登录与安全' },
  { id: 'identities', label: '身份与签名' },
  { id: 'sync', label: '同步' },
  { id: 'privacy', label: '隐私' },
];

const generalWorkspaceTabs: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'appearance', label: '外观' },
  { id: 'sending', label: '发送' },
];

function SettingsContextTabs({
  activeSection,
  canUseAccountTabs,
  onNavigate,
}: {
  activeSection: SettingsSectionId;
  canUseAccountTabs: boolean;
  onNavigate: (section: SettingsSectionId) => void;
}) {
  const tabs = accountScopedSections.has(activeSection)
    ? accountWorkspaceTabs
    : generalScopedSections.has(activeSection)
      ? generalWorkspaceTabs
      : null;
  if (!tabs) return null;

  const accountScope = accountScopedSections.has(activeSection);
  return (
    <nav
      className="settings-context-tabs"
      aria-label={accountScope ? '账号设置分类' : '通用设置分类'}
    >
      {tabs.map((tab) => {
        const disabled = accountScope && tab.id !== 'accounts' && !canUseAccountTabs;
        return (
          <button
            type="button"
            className={tab.id === activeSection ? 'active' : ''}
            aria-current={tab.id === activeSection ? 'page' : undefined}
            disabled={disabled}
            title={disabled ? '请先添加或选择邮箱账号' : undefined}
            onClick={() => onNavigate(tab.id)}
            key={tab.id}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export default function SettingsFrame({
  title,
  subtitle = '',
  activeSection,
  children,
  onNavigate,
  onTestConnection,
  onSave,
  canSaveAndVerify = false,
  isDirty = false,
  isBusy = false,
  connectionSummary,
  onClose,
}: SettingsFrameProps) {
  const {
    group: activeGroup,
    item: activeItem,
    index: activeIndex,
  } = getSettingsNavigationContext(activeSection);
  const isAccountEditingSection = saveAndVerifySettingsSections.has(activeSection);
  const canActOnConnection = connectionSettingsSections.has(activeSection) && canSaveAndVerify;
  const shouldShowConnectionSummary = isAccountEditingSection
    && canSaveAndVerify
    && Boolean(connectionSummary)
    && connectionSummary !== '尚未开始验证';
  const headerAction = isAccountEditingSection && canSaveAndVerify && isDirty
    ? 'save'
    : canActOnConnection
      ? 'test'
      : null;
  const visibleSubtitle = accountScopedSections.has(activeSection) ? subtitle : '';
  const modalRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useModalAccessibility({
    dialogRef: modalRef,
    backdropRef,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') {
        const settingsDialog = modalRef.current;
        const startedInNestedDialog = settingsDialog !== null
          && event.composedPath().some((target) => (
            target instanceof HTMLElement
            && target !== settingsDialog
            && target.matches('[aria-modal="true"]')
          ));
        if (startedInNestedDialog) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (!event.altKey) return;
      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
      const target = direction === 0 ? null : settingsNavigationItems[activeIndex + direction];
      if (target) {
        event.preventDefault();
        onNavigate(target.id);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, onClose, onNavigate]);

  return (
    <div
      className="settings-backdrop"
      ref={backdropRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-modal"
        data-ui="settings-v3"
        data-page-layout={compactSettingsSections.has(activeSection) ? 'compact' : 'standard'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={modalRef}
      >
        <header className="settings-main-header">
          <div className="settings-title">
            <span className="settings-title-copy">
              <strong>{title}</strong>
              {visibleSubtitle && (
                <small>
                  {visibleSubtitle}
                  {isAccountEditingSection && isDirty ? ' · 有未保存修改' : ''}
                </small>
              )}
            </span>
          </div>
          <div className="settings-header-actions">
            {headerAction === 'save' && (
              <button
                type="button"
                className="settings-header-button primary"
                aria-label="保存账号设置"
                title="保存当前账号设置"
                disabled={isBusy}
                onClick={onSave}
              >
                {isBusy ? <LoaderCircle className="settings-action-spinner" size={15} /> : <Save size={15} />}
                <span>{isBusy ? '保存中' : '保存修改'}</span>
              </button>
            )}
            {headerAction === 'test' && (
              <button
                type="button"
                className="settings-header-button secondary"
                aria-label="测试连接"
                title="测试当前账号的 IMAP 与 SMTP 服务器连接"
                onClick={onTestConnection}
              >
                <FlaskConical size={15} />
                <span>测试连接</span>
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              className="settings-close-button"
              aria-label="关闭设置"
              title="关闭设置"
              data-no-tooltip
              onClick={onClose}
            >
              <ArrowLeft className="settings-mobile-back-icon" size={18} aria-hidden="true" />
              <X className="settings-desktop-close-icon" size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        {shouldShowConnectionSummary && (
          <div className="settings-connection-summary" aria-live="polite">
            {connectionSummary}
          </div>
        )}
        <div className="settings-body">
          <SettingsSidebar
            activeSection={activeSection}
            onNavigate={onNavigate}
          />
          <div className="settings-content">
            <SettingsMobileNavigation
              activeSection={activeSection}
              activeItem={activeItem}
              onNavigate={onNavigate}
            />
            <SettingsContextTabs
              activeSection={activeSection}
              canUseAccountTabs={canSaveAndVerify}
              onNavigate={onNavigate}
            />
            <SettingsPageShell
              activeSection={activeSection}
              group={activeGroup}
              item={activeItem}
            >
              {children}
            </SettingsPageShell>
          </div>
        </div>
      </section>
    </div>
  );
}

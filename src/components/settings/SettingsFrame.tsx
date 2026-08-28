import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import {
  FlaskConical,
  LoaderCircle,
  Save,
  X,
} from 'lucide-react';
import SettingsPageShell from './SettingsPageShell';
import { CustomSelect } from './accounts/CustomSelect';
import useModalAccessibility from '../../hooks/useModalAccessibility';
import {
  SettingsMobileNavigation,
  SettingsSidebar,
} from './SettingsNavigationControls';
import {
  accountScopedSections,
  connectionSettingsSections,
  getSettingsNavigationContext,
  type SettingsSectionId,
} from './settingsNavigation';
import './settings-tokens.css';
import './settings-foundation.css';
import './settings-layout.css';
import './settings-components.css';
import './settings-pages.css';
import './settings-v3.css';

export type { SettingsSectionId } from './settingsNavigation';

type SettingsAccountOption = {
  id: number;
  label: string;
  email: string;
};

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
  accountOptions?: SettingsAccountOption[];
  activeAccountId?: number | null;
  onSelectAccountId?: (accountId: number) => void;
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
  'notifications',
  'about',
]);

const accountWorkspaceTabs: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'accounts', label: '概览' },
  { id: 'providers', label: '服务器' },
  { id: 'auth', label: '登录与安全' },
  { id: 'identities', label: '身份与签名' },
  { id: 'sync', label: '同步' },
  { id: 'privacy', label: '隐私' },
];

function SettingsAccountWorkspace({
  activeSection,
  canUseAccountTabs,
  accountSwitchDisabled,
  currentAccountLabel,
  accountOptions,
  activeAccountId,
  connectionSummary,
  onSelectAccountId,
  onNavigate,
}: {
  activeSection: SettingsSectionId;
  canUseAccountTabs: boolean;
  accountSwitchDisabled: boolean;
  currentAccountLabel: string;
  accountOptions: SettingsAccountOption[];
  activeAccountId: number | null;
  connectionSummary?: string;
  onSelectAccountId?: (accountId: number) => void;
  onNavigate: (section: SettingsSectionId) => void;
}) {
  if (!accountScopedSections.has(activeSection)) return null;

  const hasConnectionSummary = Boolean(connectionSummary)
    && connectionSummary !== '尚未开始验证';
  const canSwitchAccount = accountOptions.length > 0 && Boolean(onSelectAccountId);

  return (
    <div className="settings-account-workspace">
      <div className="settings-account-workspace-topline">
        {canSwitchAccount ? (
          <label
            className="settings-account-picker"
            title={accountSwitchDisabled ? '请先保存或放弃当前账号的修改' : '切换当前设置账号'}
          >
            <span>当前账号</span>
            <CustomSelect
              dense
              ariaLabel="切换当前设置账号"
              value={String(activeAccountId ?? '')}
              options={accountOptions.map((account) => ({
                value: String(account.id),
                label: account.label,
                meta: account.email,
              }))}
              disabled={accountSwitchDisabled}
              onChange={(nextValue) => onSelectAccountId?.(Number(nextValue))}
            />
          </label>
        ) : (
          <span className="settings-account-current">
            <small>当前账号</small>
            <strong>{currentAccountLabel || '尚未添加账号'}</strong>
          </span>
        )}
        {hasConnectionSummary && (
          <span className="settings-account-connection-state" title={connectionSummary}>
            {connectionSummary}
          </span>
        )}
      </div>
      <nav className="settings-context-tabs" aria-label="账号设置分类">
        {accountWorkspaceTabs.map((tab) => {
          const disabled = tab.id !== 'accounts' && !canUseAccountTabs;
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
    </div>
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
  accountOptions = [],
  activeAccountId = null,
  onSelectAccountId,
  onClose,
}: SettingsFrameProps) {
  const {
    group: activeGroup,
    item: activeItem,
  } = getSettingsNavigationContext(activeSection);
  const isAccountEditingSection = saveAndVerifySettingsSections.has(activeSection);
  const canActOnConnection = connectionSettingsSections.has(activeSection) && canSaveAndVerify;
  const showSaveAction = isAccountEditingSection && canSaveAndVerify;
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const modalRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useModalAccessibility({
    dialogRef: modalRef,
    backdropRef,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (!isDirty) setShowDiscardConfirm(false);
  }, [isDirty]);

  const requestClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      const settingsDialog = modalRef.current;
      const startedInNestedDialog = settingsDialog !== null
        && event.composedPath().some((target) => (
          target instanceof HTMLElement
          && target !== settingsDialog
          && target.matches('[aria-modal="true"]')
        ));
      if (startedInNestedDialog) return;

      event.preventDefault();
      if (showDiscardConfirm) {
        setShowDiscardConfirm(false);
        return;
      }
      requestClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, onClose, showDiscardConfirm]);

  return (
    <div
      className="settings-backdrop"
      ref={backdropRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
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
            </span>
          </div>
          <div className="settings-header-actions">
            {canActOnConnection && (
              <button
                type="button"
                className="settings-header-button secondary"
                aria-label="测试连接"
                title="测试当前账号的 IMAP 与 SMTP 服务器连接"
                disabled={isBusy}
                onClick={onTestConnection}
              >
                <FlaskConical size={15} />
                <span>测试连接</span>
              </button>
            )}
            {showSaveAction && (
              <button
                type="button"
                className="settings-header-button primary"
                aria-label="保存账号设置"
                title={isDirty ? '保存当前账号设置' : '当前没有未保存修改'}
                disabled={isBusy || !isDirty}
                onClick={onSave}
              >
                {isBusy ? <LoaderCircle className="settings-action-spinner" size={15} /> : <Save size={15} />}
                <span>{isBusy ? '保存中' : '保存修改'}</span>
              </button>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              className="settings-close-button"
              aria-label="关闭设置"
              title="关闭设置"
              data-no-tooltip
              onClick={requestClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        {showDiscardConfirm && (
          <div className="settings-discard-confirm" role="alertdialog" aria-label="放弃未保存的修改">
            <span>
              <strong>放弃未保存的修改？</strong>
              <small>当前账号的修改还没有保存。</small>
            </span>
            <div>
              <button type="button" onClick={() => setShowDiscardConfirm(false)}>继续编辑</button>
              <button type="button" className="danger" onClick={onClose}>放弃修改</button>
            </div>
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
            <SettingsAccountWorkspace
              activeSection={activeSection}
              canUseAccountTabs={canSaveAndVerify}
              accountSwitchDisabled={isDirty}
              currentAccountLabel={subtitle}
              accountOptions={accountOptions}
              activeAccountId={activeAccountId}
              connectionSummary={connectionSummary}
              onSelectAccountId={onSelectAccountId}
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

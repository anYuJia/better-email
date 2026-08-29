import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import {
  ChevronLeft,
  FlaskConical,
  LoaderCircle,
  Save,
  X,
} from 'lucide-react';
import SettingsPageShell from './SettingsPageShell';
import { CustomSelect } from './accounts/CustomSelect';
import useModalAccessibility from '../../hooks/useModalAccessibility';
import { SettingsSidebar } from './SettingsNavigationControls';
import {
  accountScopedSections,
  connectionSettingsSections,
  getSettingsNavigationContext,
  type SettingsSectionId,
} from './settingsNavigation';
import './settings-tokens.css';
import './settings-foundation.css';
import './settings-components.css';
import './settings-pages.css';
import './settings-primitives.css';
import './settings-shell.css';
import './settings-responsive.css';

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
  isTestingConnection?: boolean;
  connectionSummary?: string;
  connectionTestFeedback?: { tone: 'success' | 'error'; message: string } | null;
  accountOptions?: SettingsAccountOption[];
  activeAccountId?: number | null;
  onSelectAccountId?: (accountId: number) => void;
  onClose: () => void;
};

const SETTINGS_MOBILE_MEDIA_QUERY = '(max-width: 720px)';

function useSettingsMobileViewport() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(SETTINGS_MOBILE_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(SETTINGS_MOBILE_MEDIA_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return isMobile;
}

const saveAndVerifySettingsSections = new Set<SettingsSectionId>([
  'accounts',
  'providers',
  'auth',
  'privacy',
]);

function SettingsAccountContext({
  activeSection,
  accountSwitchDisabled,
  currentAccountLabel,
  accountOptions,
  activeAccountId,
  connectionSummary,
  onSelectAccountId,
}: {
  activeSection: SettingsSectionId;
  accountSwitchDisabled: boolean;
  currentAccountLabel: string;
  accountOptions: SettingsAccountOption[];
  activeAccountId: number | null;
  connectionSummary?: string;
  onSelectAccountId?: (accountId: number) => void;
}) {
  if (!accountScopedSections.has(activeSection)) return null;

  const hasConnectionSummary = Boolean(connectionSummary)
    && connectionSummary !== '尚未开始验证';
  const canSwitchAccount = accountOptions.length > 0 && Boolean(onSelectAccountId);

  return (
    <div className="settings-account-workspace" aria-label="当前账号">
      <div className="settings-account-workspace-topline">
        {canSwitchAccount ? (
          <div
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
          </div>
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
  isTestingConnection = false,
  connectionSummary,
  connectionTestFeedback,
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
  const isMobileViewport = useSettingsMobileViewport();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const shellRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useModalAccessibility({
    dialogRef: shellRef,
    backdropRef: workspaceRef,
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
      const settingsShell = shellRef.current;
      const startedInNestedDialog = settingsShell !== null
        && event.composedPath().some((target) => (
          target instanceof HTMLElement
          && target !== settingsShell
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
    <div className="settings-workspace" ref={workspaceRef}>
      <section
        className="settings-modal settings-shell"
        data-ui="settings-app"
        data-page-layout="standard"
        role="region"
        aria-label={title}
        ref={shellRef}
        tabIndex={-1}
      >
        <header className="settings-main-header">
          <div className="settings-title">
            <button
              type="button"
              className="settings-mobile-back"
              aria-label="返回设置"
              aria-hidden={isMobileViewport ? undefined : true}
              tabIndex={isMobileViewport ? undefined : -1}
              onClick={requestClose}
            >
              <ChevronLeft size={20} aria-hidden="true" />
              <span>设置</span>
            </button>
            <span className="settings-title-copy">
              <strong className="settings-desktop-title">{title}</strong>
              <strong className="settings-mobile-page-title">{activeItem.label}</strong>
            </span>
          </div>
          <div className="settings-header-actions">
            {canActOnConnection && (
              <button
                type="button"
                className="settings-header-button secondary"
                aria-label="测试连接"
                title="测试当前账号的 IMAP 与 SMTP 服务器连接"
                aria-busy={isTestingConnection}
                disabled={isBusy || isTestingConnection}
                onClick={onTestConnection}
              >
                {isTestingConnection ? <LoaderCircle className="settings-action-spinner" size={15} /> : <FlaskConical size={15} />}
                <span>{isTestingConnection ? '测试中…' : '测试连接'}</span>
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

        {connectionTestFeedback && (
          <div
            className={`settings-connection-feedback settings-connection-feedback--${connectionTestFeedback.tone}`}
            role={connectionTestFeedback.tone === 'error' ? 'alert' : 'status'}
          >
            {connectionTestFeedback.message}
          </div>
        )}

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
            accountSectionsEnabled={canSaveAndVerify}
            onNavigate={onNavigate}
          />
          <div className="settings-content">
            <SettingsAccountContext
              activeSection={activeSection}
              accountSwitchDisabled={isDirty}
              currentAccountLabel={subtitle}
              accountOptions={accountOptions}
              activeAccountId={activeAccountId}
              connectionSummary={connectionSummary}
              onSelectAccountId={onSelectAccountId}
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

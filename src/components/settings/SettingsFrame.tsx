import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import {
  ChevronLeft,
  FlaskConical,
  LoaderCircle,
  Save,
  X,
} from 'lucide-react';
import SettingsPageShell from './SettingsPageShell';
import AccountSwitcher from '../AccountSwitcher';
import type { Account, AccountScope } from '../../app/types';
import useModalAccessibility from '../../hooks/useModalAccessibility';
import { startDraggingCurrentWindow } from '../../tauriBridge';
import { SettingsSearch, SettingsSidebar } from './SettingsNavigationControls';
import useSettingsSurfaceMotion from './useSettingsSurfaceMotion';
import {
  accountScopedSections,
  connectionSettingsSections,
  getSettingsNavigationContext,
  getSettingsSectionPresentation,
  resolveSettingsNavigationSectionId,
  type SettingsSearchEntry,
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

type SettingsFrameProps = {
  standalone?: boolean;
  nativeCloseRequestVersion?: number;
  onReady?: () => void;
  title: string;
  activeSection: SettingsSectionId;
  children: React.ReactNode;
  onNavigate: (section: SettingsSectionId) => void;
  onTestConnection: () => void;
  onSave: () => void;
  onDiscardChanges?: () => void;
  canSaveAndVerify?: boolean;
  isDirty?: boolean;
  isBusy?: boolean;
  isTestingConnection?: boolean;
  connectionTestFeedback?: { tone: 'success' | 'error'; message: string } | null;
  accounts?: Account[];
  accountScope?: AccountScope;
  onAccountScopeChange?: (value: string) => void;
  onSetDefaultAccount?: (accountId: number) => void;
  onAddAccount?: () => void;
  canSave?: boolean;
  /** @deprecated Settings account tabs were replaced by the shared header scope picker. */
  accountOptions?: Array<{ id: number; label: string; email: string; isDefault?: boolean }>;
  /** @deprecated Settings account tabs were replaced by the shared header scope picker. */
  activeAccountId?: number | null;
  /** @deprecated Settings account tabs were replaced by the shared header scope picker. */
  onSelectAccountId?: (accountId: number) => void;
  onClose: () => void;
};

const SETTINGS_MOBILE_MEDIA_QUERY = '(max-width: 720px)';
const SETTINGS_EXIT_MS = 180;

function canAnimateSettingsExit() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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
  'identities',
  'sync',
]);

export default function SettingsFrame({
  standalone = false,
  nativeCloseRequestVersion = 0,
  onReady,
  title,
  activeSection,
  children,
  onNavigate,
  onTestConnection,
  onSave,
  onDiscardChanges = () => undefined,
  canSaveAndVerify = false,
  isDirty = false,
  isBusy = false,
  isTestingConnection = false,
  connectionTestFeedback,
  accounts = [],
  accountScope = 'all',
  onAccountScopeChange = () => undefined,
  onSetDefaultAccount = () => undefined,
  onAddAccount = () => undefined,
  canSave,
  onClose,
}: SettingsFrameProps) {
  const {
    group: activeGroup,
    item: activeItem,
  } = getSettingsNavigationContext(activeSection);
  const activePresentation = getSettingsSectionPresentation(activeSection);
  const parentSection = resolveSettingsNavigationSectionId(activeSection);
  const isNestedSection = parentSection !== activeSection;
  const parentPresentation = getSettingsSectionPresentation(parentSection);
  const isAccountEditingSection = saveAndVerifySettingsSections.has(activeSection);
  const canActOnConnection = connectionSettingsSections.has(activeSection) && canSaveAndVerify;
  const showSaveAction = canSave ?? (isAccountEditingSection && canSaveAndVerify);
  const accountSectionsEnabled = accounts.length > 0 || canSaveAndVerify;
  const isMobileViewport = useSettingsMobileViewport();
  const isAccountScoped = accountScopedSections.has(activeSection);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SettingsSearchEntry | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [pendingAccountScope, setPendingAccountScope] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [inputModality, setInputModality] = useState<'keyboard' | 'pointer'>('keyboard');
  const shellRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  const closingRef = useRef(false);
  const handledNativeCloseRequestRef = useRef(0);

  useEffect(() => {
    setSearchTarget((current) => current?.section === activeSection ? current : null);
  }, [activeSection]);
  useEffect(() => { setSearchTarget(null); }, [accountScope, isClosing]);

  useModalAccessibility({
    dialogRef: shellRef,
    backdropRef: workspaceRef,
    initialFocusRef: shellRef,
  });

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!isDirty) setShowDiscardConfirm(false);
  }, [isDirty]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  const completeClose = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    onCloseRef.current();
  }, []);

  useSettingsSurfaceMotion(shellRef, !isClosing, {
    enabled: isMobileViewport && !standalone,
    onExited: completeClose,
  });

  useEffect(() => {
    if (!isClosing || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { if (media.matches) completeClose(); };
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, [isClosing]);

  const finishClose = () => {
    if (closingRef.current) return;
    if (standalone || !canAnimateSettingsExit()) {
      onClose();
      return;
    }
    closingRef.current = true;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(completeClose, SETTINGS_EXIT_MS);
  };

  const performClose = (discardChanges = false) => {
    if (discardChanges) onDiscardChanges();
    setShowDiscardConfirm(false);
    if (isMobileViewport && isNestedSection) {
      onClose();
      return;
    }
    finishClose();
  };

  const requestClose = () => {
    if (closingRef.current) return;
    if (isSearchExpanded) {
      setIsSearchExpanded(false);
      return;
    }
    if (isDirty) {
      setPendingAccountScope(null);
      setShowDiscardConfirm(true);
      return;
    }
    performClose();
  };

  const requestAccountScopeChange = (value: string) => {
    if (isDirty) {
      setPendingAccountScope(value);
      setShowDiscardConfirm(false);
      return;
    }
    onAccountScopeChange(value);
  };

  const discardAndSwitchAccountScope = () => {
    if (pendingAccountScope === null) return;
    const nextScope = pendingAccountScope;
    setPendingAccountScope(null);
    onDiscardChanges();
    onAccountScopeChange(nextScope);
  };

  const saveAndSwitchAccountScope = () => {
    if (pendingAccountScope === null) return;
    onSave();
  };

  useEffect(() => {
    if (pendingAccountScope === null || isDirty || isBusy) return;
    const nextScope = pendingAccountScope;
    setPendingAccountScope(null);
    onAccountScopeChange(nextScope);
  }, [isBusy, isDirty, onAccountScopeChange, pendingAccountScope]);

  useEffect(() => {
    if (
      nativeCloseRequestVersion <= 0
      || nativeCloseRequestVersion <= handledNativeCloseRequestRef.current
    ) return;
    handledNativeCloseRequestRef.current = nativeCloseRequestVersion;
    requestClose();
  }, [nativeCloseRequestVersion]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
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
  }, [isClosing, isDirty, isMobileViewport, isNestedSection, isSearchExpanded, onClose, showDiscardConfirm]);

  return (
    <div
      className={`settings-workspace${standalone ? ' is-standalone' : ''}${isClosing ? ' is-closing' : ''}`}
      data-input-modality={inputModality}
      ref={workspaceRef}
      onPointerDownCapture={() => setInputModality('pointer')}
      onKeyDownCapture={(event) => {
        if (
          event.key === 'Tab'
          || event.key === 'Enter'
          || event.key === ' '
          || event.key === 'Escape'
          || event.key === 'Home'
          || event.key === 'End'
          || event.key.startsWith('Arrow')
        ) {
          setInputModality('keyboard');
        }
      }}
    >
      <section
        className="settings-modal settings-shell"
        data-ui="settings-app"
        data-standalone={standalone ? 'true' : 'false'}
        data-page-layout="standard"
        data-settings-section={activeSection}
        data-account-scoped={isAccountScoped ? 'true' : 'false'}
        role="region"
        aria-label={title}
        ref={shellRef}
        tabIndex={-1}
        {...(isClosing ? { inert: '' } : {})}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget
            && /settings-(?:mobile-)?shell-exit/.test(event.animationName)) completeClose();
        }}
      >
        <header className="settings-main-header">
          {standalone && (
            <div
              className="settings-titlebar-drag-region"
              data-tauri-drag-region
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if ((event.target as HTMLElement).closest('button, input, textarea, select, label, a, [role="button"]')) return;
                void startDraggingCurrentWindow().catch(() => undefined);
              }}
              aria-hidden="true"
            />
          )}
          <div className="settings-header-leading" {...(isMobileViewport && isSearchExpanded ? { inert: '', 'aria-hidden': true } : {})}>
            <div className="settings-title">
              <button
                type="button"
                className="settings-mobile-back"
                aria-label={isNestedSection ? `返回${parentPresentation.label}` : '返回设置'}
                aria-hidden={isMobileViewport ? undefined : true}
                tabIndex={isMobileViewport ? undefined : -1}
                onClick={requestClose}
              >
                <ChevronLeft size={20} aria-hidden="true" />
                <span>{isNestedSection ? parentPresentation.label : '设置'}</span>
              </button>
              <span className="settings-title-copy">
                <strong className="settings-desktop-title">{title}</strong>
                <strong className="settings-mobile-page-title">{activePresentation.label}</strong>
              </span>
            </div>
            {isAccountScoped && <AccountSwitcher
              className="settings-header-account-switcher"
              accountScope={accountScope}
              accounts={accounts}
              disabled={isBusy}
              onChange={requestAccountScopeChange}
              onSetDefault={onSetDefaultAccount}
              onAddAccount={onAddAccount}
            />}
          </div>
          <SettingsSearch
            mobile={isMobileViewport}
            expanded={isSearchExpanded}
            onExpandedChange={setIsSearchExpanded}
            accountSectionsEnabled={accountSectionsEnabled}
            onNavigate={(entry) => {
              // A new object also identifies a repeated search for the same
              // target. The ready content, not a fixed delay, owns focus.
              setSearchTarget({ ...entry });
              onNavigate(entry.section);
            }}
          />
          <div className="settings-header-actions" {...(isMobileViewport && isSearchExpanded ? { inert: '', 'aria-hidden': true } : {})}>
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
                {isTestingConnection ? <LoaderCircle className="settings-action-spinner" size={16} /> : <FlaskConical size={16} />}
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
                {isBusy ? <LoaderCircle className="settings-action-spinner" size={16} /> : <Save size={16} />}
                <span>{isBusy ? '保存中' : '保存修改'}</span>
              </button>
            )}
            {!standalone && (
              <button
                type="button"
                className="settings-close-button"
                aria-label="关闭设置"
                title="关闭设置"
                data-no-tooltip
                onClick={requestClose}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
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
              <small>当前设置的修改还没有保存。</small>
            </span>
            <div>
              <button type="button" onClick={() => setShowDiscardConfirm(false)}>继续编辑</button>
              <button type="button" className="danger" onClick={() => performClose(true)}>放弃修改</button>
            </div>
          </div>
        )}

        {pendingAccountScope !== null && (
          <div
            className="settings-discard-confirm settings-scope-switch-confirm"
            role="alertdialog"
            aria-label="切换邮箱范围前处理未保存修改"
          >
            <span>
              <strong>当前有未保存修改</strong>
              <small>切换邮箱范围前请选择如何处理。</small>
            </span>
            <div>
              <button type="button" onClick={() => setPendingAccountScope(null)}>取消</button>
              <button type="button" className="danger" onClick={discardAndSwitchAccountScope}>放弃并切换</button>
              <button type="button" className="primary" onClick={saveAndSwitchAccountScope}>保存并切换</button>
            </div>
          </div>
        )}

        <div className="settings-body">
          <SettingsSidebar
            activeSection={activeSection}
            accountSectionsEnabled={accountSectionsEnabled}
            onNavigate={(section) => { setSearchTarget(null); onNavigate(section); }}
          />
          <div className="settings-content-area">
            <div className="settings-content">
              <SettingsPageShell
                activeSection={activeSection}
                group={activeGroup}
                item={activeItem}
                accountScope={accountScope}
                accounts={accounts}
                searchTarget={isClosing ? null : searchTarget}
              >
                {children}
              </SettingsPageShell>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

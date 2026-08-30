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
import SettingsAccountTabs, {
  type SettingsAccountTabOption,
} from './accounts/SettingsAccountTabs';
import useModalAccessibility from '../../hooks/useModalAccessibility';
import { SettingsSidebar } from './SettingsNavigationControls';
import {
  accountScopedSections,
  connectionSettingsSections,
  getSettingsNavigationContext,
  getSettingsSectionPresentation,
  resolveSettingsNavigationSectionId,
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
  canSaveAndVerify?: boolean;
  isDirty?: boolean;
  isBusy?: boolean;
  isTestingConnection?: boolean;
  connectionTestFeedback?: { tone: 'success' | 'error'; message: string } | null;
  accountOptions?: SettingsAccountTabOption[];
  activeAccountId?: number | null;
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
  canSaveAndVerify = false,
  isDirty = false,
  isBusy = false,
  isTestingConnection = false,
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
  const activePresentation = getSettingsSectionPresentation(activeSection);
  const parentSection = resolveSettingsNavigationSectionId(activeSection);
  const isNestedSection = parentSection !== activeSection;
  const parentPresentation = getSettingsSectionPresentation(parentSection);
  const isAccountEditingSection = saveAndVerifySettingsSections.has(activeSection);
  const canActOnConnection = connectionSettingsSections.has(activeSection) && canSaveAndVerify;
  const showSaveAction = isAccountEditingSection && canSaveAndVerify;
  const showAccountTabs = accountScopedSections.has(activeSection)
    && accountOptions.length > 1;
  const isMobileViewport = useSettingsMobileViewport();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [inputModality, setInputModality] = useState<'keyboard' | 'pointer'>('keyboard');
  const shellRef = useRef<HTMLElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const handledNativeCloseRequestRef = useRef(0);

  useModalAccessibility({
    dialogRef: shellRef,
    backdropRef: workspaceRef,
    initialFocusRef: shellRef,
  });

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    if (!isDirty) setShowDiscardConfirm(false);
  }, [isDirty]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  const finishClose = () => {
    if (closingRef.current) return;
    if (standalone || !canAnimateSettingsExit()) {
      onClose();
      return;
    }
    closingRef.current = true;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, SETTINGS_EXIT_MS);
  };

  const performClose = () => {
    setShowDiscardConfirm(false);
    if (isMobileViewport && isNestedSection) {
      onClose();
      return;
    }
    finishClose();
  };

  const requestClose = () => {
    if (closingRef.current) return;
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    performClose();
  };

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
  }, [isClosing, isDirty, isMobileViewport, isNestedSection, onClose, showDiscardConfirm]);

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
        role="region"
        aria-label={title}
        ref={shellRef}
        tabIndex={-1}
      >
        <header className="settings-main-header">
          {standalone && (
            <div
              className="settings-titlebar-drag-region"
              data-tauri-drag-region
              aria-hidden="true"
            />
          )}
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
            {!standalone && (
              <button
                type="button"
                className="settings-close-button"
                aria-label="关闭设置"
                title="关闭设置"
                data-no-tooltip
                onClick={requestClose}
              >
                <X size={16} aria-hidden="true" />
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
              <small>当前账号的修改还没有保存。</small>
            </span>
            <div>
              <button type="button" onClick={() => setShowDiscardConfirm(false)}>继续编辑</button>
              <button type="button" className="danger" onClick={performClose}>放弃修改</button>
            </div>
          </div>
        )}

        <div className="settings-body">
          <SettingsSidebar
            activeSection={activeSection}
            accountSectionsEnabled={canSaveAndVerify}
            onNavigate={onNavigate}
          />
          <div className={`settings-content-area${showAccountTabs ? ' has-account-tabs' : ''}`}>
            {showAccountTabs && (
              <SettingsAccountTabs
                accounts={accountOptions}
                activeAccountId={activeAccountId}
                switchDisabled={isDirty}
                onSelect={(accountId) => onSelectAccountId?.(accountId)}
              />
            )}
            <div className="settings-content">
              <SettingsPageShell
                activeSection={activeSection}
                group={activeGroup}
                item={activeItem}
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

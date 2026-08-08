import { useEffect, useRef } from 'react';
import type React from 'react';
import {
  BadgeCheck,
  FlaskConical,
  LoaderCircle,
  Save,
  X,
} from 'lucide-react';
import SettingsPageShell from './SettingsPageShell';
import {
  SettingsMobileNavigation,
  SettingsSidebar,
} from './SettingsNavigationControls';
import {
  connectionSettingsSections,
  getSettingsNavigationContext,
  settingsNavigationItems,
  type SettingsSectionId,
} from './settingsNavigation';
import './settings-tokens.css';
import './settings-foundation.css';
import './settings-layout.css';
import './settings-components.css';
import './settings-pages.css';

export type { SettingsSectionId } from './settingsNavigation';

type SettingsFrameProps = {
  title: string;
  subtitle: string;
  activeSection: SettingsSectionId;
  children: React.ReactNode;
  onNavigate: (section: SettingsSectionId) => void;
  onTestConnection: () => void;
  onSave: () => void;
  onSaveAndVerify: () => void;
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
]);

export default function SettingsFrame({
  title,
  subtitle,
  activeSection,
  children,
  onNavigate,
  onTestConnection,
  onSave,
  onSaveAndVerify,
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
  const hasConnectionActions = saveAndVerifySettingsSections.has(activeSection) && canSaveAndVerify;
  const shouldShowConnectionSummary = hasConnectionActions
    && Boolean(connectionSummary)
    && connectionSummary !== '尚未开始验证';
  const modalRef = useRef<HTMLElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<Element | null>(null);

  // Focus the dialog on open and restore focus to the previously focused
  // element when it closes.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement;
    const modal = modalRef.current;
    const focusTarget = modal?.querySelector<HTMLElement>('.settings-close-button')
      ?? modal?.querySelector<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
    focusTarget?.focus();
    return () => {
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  // Make the rest of the application inert while settings are open so that
  // keyboard and screen-reader focus cannot escape the dialog.
  useEffect(() => {
    const backdrop = backdropRef.current;
    const container = backdrop?.parentElement;
    if (!backdrop || !container) return undefined;
    const siblings = Array.from(container.children).filter((element) => element !== backdrop);
    const previouslyInert = new Map<Element, boolean>();
    for (const sibling of siblings) {
      previouslyInert.set(sibling, sibling.hasAttribute('inert'));
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }
    return () => {
      for (const sibling of siblings) {
        if (previouslyInert.get(sibling)) continue;
        sibling.removeAttribute('inert');
        sibling.removeAttribute('aria-hidden');
      }
    };
  }, []);

  // Keep Tab navigation inside the dialog while it is open.
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const modalElement: HTMLElement = modal;

    const focusableSelector = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modalElement.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!modalElement.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    modalElement.addEventListener('keydown', handleKeyDown);
    return () => modalElement.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
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
      <section className="settings-modal" data-ui="settings-v2" role="dialog" aria-modal="true" aria-label={title} ref={modalRef}>
        <header className="settings-main-header">
          <div className="settings-title">
            <span className="settings-title-copy">
              <strong>{title}</strong>
              <small>
                {subtitle}
                {hasConnectionActions ? ' · ' + (isDirty ? '有未保存修改' : '已保存') : ''}
              </small>
            </span>
          </div>
          <div className="settings-header-actions">
            {hasConnectionActions ? (
              <>
                <button
                  type="button"
                  className="settings-header-button secondary"
                  aria-label="仅保存设置"
                  title={isDirty ? '保存当前账号设置，不执行连接验证' : '当前没有未保存修改'}
                  disabled={!isDirty || isBusy}
                  onClick={onSave}
                >
                  <Save size={15} />
                  <span>仅保存</span>
                </button>
                <button
                  type="button"
                  className="settings-header-button primary"
                  aria-label="保存并验证设置"
                  title="先保存当前账号设置，再检查服务器和登录认证"
                  disabled={isBusy}
                  onClick={onSaveAndVerify}
                >
                  {isBusy ? <LoaderCircle className="settings-action-spinner" size={15} /> : <BadgeCheck size={15} />}
                  <span>{isBusy ? '验证中' : '保存并验证'}</span>
                </button>
              </>
            ) : connectionSettingsSections.has(activeSection) ? (
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
            ) : (
              <button
                type="button"
                className="settings-header-button primary"
                aria-label="保存设置"
                title="保存当前账号设置"
                disabled={isBusy}
                onClick={onSave}
              >
                <Save size={15} />
                <span>保存</span>
              </button>
            )}
            <button
              type="button"
              className="settings-close-button"
              aria-label="关闭设置"
              title="关闭设置"
              onClick={onClose}
            >
              <X size={16} />
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
            <SettingsPageShell
              activeSection={activeSection}
              group={activeGroup}
              item={activeItem}
            >
              {children}
            </SettingsPageShell>
          </div>
        </div>
        {isDirty && (
          <div className="settings-floating-unsaved-bar" role="status" aria-live="polite">
            <span className="settings-floating-unsaved-info">
              <span className="settings-floating-unsaved-dot" />
              当前存在未保存的设置更改
            </span>
            <div className="settings-floating-unsaved-actions">
              <button
                type="button"
                className="st-btn st-btn-secondary st-btn-sm"
                disabled={isBusy}
                onClick={onSave}
              >
                仅保存
              </button>
              <button
                type="button"
                className="st-btn st-btn-primary st-btn-sm"
                disabled={isBusy}
                onClick={hasConnectionActions ? onSaveAndVerify : onSave}
              >
                {isBusy ? <LoaderCircle className="settings-action-spinner" size={13} /> : <Save size={13} />}
                <span>{isBusy ? '保存中...' : hasConnectionActions ? '保存并验证' : '保存修改'}</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import type React from 'react';
import {
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
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useModalAccessibility({
    dialogRef: modalRef,
    backdropRef,
    initialFocusRef: closeButtonRef,
  });

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
              isDirty ? (
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
              ) : null
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
            ) : activeSection === 'about' ? null : (
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
              ref={closeButtonRef}
              type="button"
              className="settings-close-button"
              aria-label="关闭设置"
              title="关闭设置"
              data-no-tooltip
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
                className="st-btn st-btn-primary st-btn-sm"
                disabled={isBusy}
                onClick={onSave}
              >
                {isBusy ? <LoaderCircle className="settings-action-spinner" size={13} /> : <Save size={13} />}
                <span>{isBusy ? '保存中...' : '保存修改'}</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

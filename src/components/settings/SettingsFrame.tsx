import { useEffect } from 'react';
import type React from 'react';
import {
  FlaskConical,
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
import './settings.css';
import './settings-shell.css';
import './settings-pages.css';
import './settings-design-language.css';

export type { SettingsSectionId } from './settingsNavigation';

type SettingsFrameProps = {
  title: string;
  subtitle: string;
  activeSection: SettingsSectionId;
  children: React.ReactNode;
  onNavigate: (section: SettingsSectionId) => void;
  onTestConnection: () => void;
  onSave: () => void;
  onClose: () => void;
};

export default function SettingsFrame({
  title,
  activeSection,
  children,
  onNavigate,
  onTestConnection,
  onSave,
  onClose,
}: SettingsFrameProps) {
  const {
    group: activeGroup,
    item: activeItem,
    index: activeIndex,
  } = getSettingsNavigationContext(activeSection);

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
      className="composer-backdrop settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="settings-main-header">
          <div className="settings-title">
            <span className="settings-app-mark" aria-hidden="true">
              <SettingsGlyph />
            </span>
            <span className="settings-title-copy">
              <strong>{title}</strong>
            </span>
          </div>
          <div className="settings-header-actions">
            {connectionSettingsSections.has(activeSection) && (
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
              type="button"
              className="settings-header-button primary"
              aria-label="保存设置"
              title="保存当前账号设置"
              onClick={onSave}
            >
              <Save size={15} />
              <span>保存</span>
            </button>
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
              pageIndex={activeIndex}
              onNavigate={onNavigate}
            >
              {children}
            </SettingsPageShell>
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 24 24" role="presentation">
      <path d="M5.4 7.2h13.2M7.7 12h8.6M9.8 16.8h4.4" />
      <circle cx="8.1" cy="7.2" r="1.5" />
      <circle cx="14.9" cy="12" r="1.5" />
      <circle cx="11.5" cy="16.8" r="1.5" />
    </svg>
  );
}

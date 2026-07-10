import { ChevronDown } from 'lucide-react';
import {
  settingsNavigationGroups,
  settingsNavigationItems,
  type SettingsNavigationItem,
  type SettingsSectionId,
} from './settingsNavigation';

type SettingsNavigationProps = {
  activeSection: SettingsSectionId;
  activeItem: SettingsNavigationItem;
  onNavigate: (section: SettingsSectionId) => void;
};

export function SettingsSidebar({
  activeSection,
  onNavigate,
}: Omit<SettingsNavigationProps, 'activeItem'>) {
  return (
    <nav className="settings-nav" aria-label="设置分类">
      <div className="settings-nav-intro">
        <strong>偏好设置</strong>
        <span>选择一个页面进行配置</span>
      </div>
      {settingsNavigationGroups.map((group) => (
        <div className="settings-nav-section" key={group.label}>
          <span className="settings-nav-group">{group.label}</span>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                type="button"
                className={active ? 'active' : ''}
                key={item.id}
                aria-current={active ? 'page' : undefined}
                aria-label={`${item.label}设置`}
                title={item.description}
                onClick={() => onNavigate(item.id)}
              >
                <span className="settings-nav-icon">
                  <Icon size={15} />
                </span>
                <span className="settings-nav-label">{item.label}</span>
                {active && <span className="settings-nav-active-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function SettingsMobileNavigation({
  activeSection,
  activeItem,
  onNavigate,
}: SettingsNavigationProps) {
  const ActiveIcon = activeItem.icon;

  return (
    <div className="settings-mobile-toolbar">
      <label className="settings-page-picker">
        <span>
          <ActiveIcon size={16} />
          <strong>{activeItem.label}</strong>
          <small>{settingsNavigationItems.length} 个页面</small>
        </span>
        <select
          aria-label="切换设置页面"
          value={activeSection}
          onChange={(event) => onNavigate(event.target.value as SettingsSectionId)}
        >
          {settingsNavigationGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </label>
    </div>
  );
}

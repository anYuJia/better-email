import { Monitor, Moon, Sun } from 'lucide-react';
import SettingsSection from './shared/SettingsSection';
import type { ThemeMode } from '../../hooks/useThemeMode';

type AppearanceSettingsProps = {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
};

const themeOptions: Array<{
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: 'system',
    label: '跟随系统',
    description: '根据操作系统的外观设置自动切换亮色与暗色。',
    icon: Monitor,
  },
  {
    value: 'light',
    label: '亮色',
    description: '始终使用明亮的界面外观。',
    icon: Sun,
  },
  {
    value: 'dark',
    label: '暗色',
    description: '始终使用深色的界面外观。',
    icon: Moon,
  },
];

export default function AppearanceSettings({
  themeMode,
  onThemeModeChange,
}: AppearanceSettingsProps) {
  return (
    <SettingsSection title="外观" description="选择 Better Email 的界面外观，改动会立即生效。">
      <div className="settings-theme-options" role="radiogroup" aria-label="界面外观">
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const active = themeMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              className={active ? 'settings-theme-option active' : 'settings-theme-option'}
              role="radio"
              aria-checked={active}
              onClick={() => onThemeModeChange(option.value)}
            >
              <Icon size={18} />
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}

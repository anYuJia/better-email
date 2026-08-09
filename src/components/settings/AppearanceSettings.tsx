import { Monitor, Moon, Sun } from 'lucide-react';
import type { KeyboardEvent } from 'react';
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
  const selectedOption = themeOptions.find((option) => option.value === themeMode) ?? themeOptions[0];

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = themeOptions.findIndex((option) => option.value === themeMode);
    let nextIndex = currentIndex;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % themeOptions.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + themeOptions.length) % themeOptions.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = themeOptions.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextOption = themeOptions[nextIndex];
    onThemeModeChange(nextOption.value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-mode="${nextOption.value}"]`)?.focus();
  };

  return (
    <SettingsSection title="外观" description="选择 Better Email 的界面外观，改动会立即生效。">
      <div className="settings-theme-preference">
        <div
          className="settings-theme-options"
          role="radiogroup"
          aria-label="界面外观"
          aria-describedby="settings-theme-description"
          onKeyDown={handleOptionKeyDown}
        >
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
                tabIndex={active ? 0 : -1}
                aria-label={`${option.label}：${option.description}`}
                data-theme-mode={option.value}
                title={option.description}
                onClick={() => onThemeModeChange(option.value)}
              >
                <Icon aria-hidden="true" size={16} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        <p id="settings-theme-description" className="settings-theme-description">
          {selectedOption.description}
        </p>
      </div>
    </SettingsSection>
  );
}

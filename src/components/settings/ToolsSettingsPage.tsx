import SettingsDestinationList from './SettingsDestinationList';
import {
  settingsToolDetailItems,
  type SettingsSectionId,
} from './settingsNavigation';

type ToolsSettingsPageProps = {
  onNavigate: (section: SettingsSectionId) => void;
};

export default function ToolsSettingsPage({
  onNavigate,
}: ToolsSettingsPageProps) {
  return (
    <div data-settings-section="tools">
      <SettingsDestinationList
        ariaLabel="效率工具"
        items={settingsToolDetailItems}
        onNavigate={onNavigate}
      />
    </div>
  );
}

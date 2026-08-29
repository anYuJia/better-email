import { ChevronRight } from 'lucide-react';
import type {
  SettingsNavigationItem,
  SettingsSectionId,
} from './settingsNavigation';

type SettingsDestinationListProps = {
  ariaLabel: string;
  items: SettingsNavigationItem[];
  onNavigate: (section: SettingsSectionId) => void;
};

export default function SettingsDestinationList({
  ariaLabel,
  items,
  onNavigate,
}: SettingsDestinationListProps) {
  return (
    <nav className="settings-destination-list" aria-label={ariaLabel}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            type="button"
            className="settings-destination-row"
            key={item.id}
            onClick={() => onNavigate(item.id)}
          >
            <span className="settings-destination-icon" aria-hidden="true">
              <Icon size={17} />
            </span>
            <span className="settings-destination-copy">
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </span>
            <ChevronRight size={17} aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}

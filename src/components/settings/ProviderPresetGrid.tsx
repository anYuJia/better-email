import {
  providerPresets,
  type AccountProviderPreset,
} from '../../providerCatalog';

type ProviderPresetGridProps = {
  activeProvider: string;
  compact?: boolean;
  onSelect: (preset: AccountProviderPreset) => void;
};

export default function ProviderPresetGrid({
  activeProvider,
  compact = false,
  onSelect,
}: ProviderPresetGridProps) {
  return (
    <section
      className={`provider-presets settings-provider-presets${compact ? ' compact' : ''}`}
      aria-label={compact ? '新账号服务商预设' : '服务商预设'}
    >
      {providerPresets.map((preset) => (
        <button
          type="button"
          className={activeProvider === preset.provider ? 'active' : ''}
          key={preset.id}
          onClick={() => onSelect(preset)}
        >
          <strong>{preset.label}</strong>
          <span>{preset.hint}</span>
        </button>
      ))}
    </section>
  );
}

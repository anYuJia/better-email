import type React from 'react';

type SettingsSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

/**
 * Accessible switch built on a real checkbox input. Replaces the legacy
 * `.checkbox-row` markup.
 */
export default function SettingsSwitch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  ariaLabel,
  className = '',
}: SettingsSwitchProps) {
  return (
    <label className={`st-switch ${className}`.trim()}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="st-switch-copy">
        <strong>{label}</strong>
        {description != null && <small>{description}</small>}
      </span>
    </label>
  );
}

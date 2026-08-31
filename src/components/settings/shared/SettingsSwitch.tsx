import { useEffect, useRef } from 'react';
import type React from 'react';

type SettingsSwitchProps = {
  checked: boolean;
  /** Shows that the current value differs between accounts in unified scope. */
  indeterminate?: boolean;
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
  indeterminate = false,
  onChange,
  label,
  description,
  disabled = false,
  ariaLabel,
  className = '',
}: SettingsSwitchProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={`st-switch${indeterminate ? ' is-indeterminate' : ''} ${className}`.trim()}>
      <span className="st-switch-copy">
        <strong>{label}</strong>
        {description != null && <small>{description}</small>}
      </span>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={indeterminate ? 'mixed' : checked}
        data-indeterminate={indeterminate ? 'true' : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

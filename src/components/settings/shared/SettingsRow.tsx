import type React from 'react';

type SettingsRowProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  className?: string;
};

/**
 * One setting row: copy on the left, control on the right. Stacks into a
 * single column on narrow screens.
 */
export default function SettingsRow({
  title,
  description,
  control,
  className = '',
}: SettingsRowProps) {
  return (
    <div className={`st-row ${className}`.trim()}>
      <span className="st-row-copy">
        <strong>{title}</strong>
        {description != null && <small>{description}</small>}
      </span>
      {control != null && <span className="st-row-control">{control}</span>}
    </div>
  );
}

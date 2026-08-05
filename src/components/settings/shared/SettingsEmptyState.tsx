import type React from 'react';

type SettingsEmptyStateProps = {
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Dashed empty-state placeholder.
 */
export default function SettingsEmptyState({
  children,
  actions,
  className = '',
}: SettingsEmptyStateProps) {
  return (
    <div className={`st-empty ${className}`.trim()}>
      {children}
      {actions != null && <div className="st-empty-actions">{actions}</div>}
    </div>
  );
}

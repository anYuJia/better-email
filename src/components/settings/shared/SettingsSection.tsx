import type React from 'react';

type SettingsSectionProps = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  dataSection?: string;
};

/**
 * Card-style settings section with an optional header row (title, description,
 * badge / actions). Replaces the legacy `.tool-panel` + `.tool-header` pair.
 */
export default function SettingsSection({
  title,
  description,
  badge,
  actions,
  children,
  className = '',
  dataSection,
}: SettingsSectionProps) {
  const hasHeader = Boolean(title || description || badge || actions);
  return (
    <section
      className={`st-section ${className}`.trim()}
      data-settings-section={dataSection}
    >
      {hasHeader && (
        <header className="st-section-header">
          <span className="st-section-heading">
            {title != null && <strong>{title}</strong>}
            {description != null && <small>{description}</small>}
          </span>
          {(badge || actions) && (
            <span className="st-section-meta">
              {badge}
              {actions}
            </span>
          )}
        </header>
      )}
      {children != null && <div className="st-section-body">{children}</div>}
    </section>
  );
}

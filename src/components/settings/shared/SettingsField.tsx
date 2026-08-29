import type React from 'react';

type SettingsFieldProps = {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /**
   * Custom controls such as the portalled select must not sit inside a
   * wrapping <label>, otherwise clicking the field copy can synthesize a
   * second click on the control.
   */
  labelMode?: 'implicit' | 'static';
};

/**
 * Labeled form field (label + control + optional hint/error). Renders a
 * <label> wrapper when no explicit htmlFor is given.
 */
export default function SettingsField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = '',
  labelMode = 'implicit',
}: SettingsFieldProps) {
  const body = (
    <>
      <span className="st-field-label">{label}</span>
      {children}
      {error != null && <span className="st-field-error">{error}</span>}
      {hint != null && <span className="st-field-hint">{hint}</span>}
    </>
  );
  if (htmlFor) {
    return (
      <div className={`st-field ${className}`.trim()}>
        <label className="st-field-label" htmlFor={htmlFor}>{label}</label>
        {children}
        {error != null && <span className="st-field-error">{error}</span>}
        {hint != null && <span className="st-field-hint">{hint}</span>}
      </div>
    );
  }
  if (labelMode === 'static') {
    return (
      <div className={`st-field st-field-static-label ${className}`.trim()}>{body}</div>
    );
  }
  return (
    <label className={`st-field ${className}`.trim()}>{body}</label>
  );
}

import type React from 'react';

type SettingsFieldProps = {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
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
  return (
    <label className={`st-field ${className}`.trim()}>{body}</label>
  );
}

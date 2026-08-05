import type React from 'react';

type SettingsBadgeProps = {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
  title?: string;
  className?: string;
};

/**
 * Small status pill. Minimum 12px text.
 */
export default function SettingsBadge({
  tone = 'neutral',
  children,
  title,
  className = '',
}: SettingsBadgeProps) {
  return (
    <span className={`st-badge st-badge-${tone} ${className}`.trim()} title={title}>
      {children}
    </span>
  );
}

import type React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
} from 'lucide-react';

type SettingsNoticeProps = {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
};

const toneIcons: Record<NonNullable<SettingsNoticeProps['tone']>, LucideIcon> = {
  info: Info,
  warning: AlertTriangle,
  danger: AlertTriangle,
  success: CheckCircle2,
};

/**
 * Inline notice with a tone, optional title and optional action slot.
 */
export default function SettingsNotice({
  tone = 'info',
  title,
  children,
  action,
  icon: IconOverride,
  className = '',
}: SettingsNoticeProps) {
  const Icon = IconOverride ?? toneIcons[tone];
  return (
    <div className={`st-notice st-notice-${tone} ${className}`.trim()} role={tone === 'danger' ? 'alert' : 'note'}>
      <span className="st-notice-icon" aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="st-notice-copy">
        {title != null && <strong>{title}</strong>}
        {children}
      </span>
      {action != null && <span className="st-notice-action">{action}</span>}
    </div>
  );
}

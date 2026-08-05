import type React from 'react';

type SettingsButtonProps = {
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-secondary' | 'ghost';
  size?: 'md' | 'sm';
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

/**
 * Settings button with semantic variants. Prefer this over raw <button>
 * inside pages; page styles must not restyle it.
 */
export default function SettingsButton({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  ...rest
}: SettingsButtonProps) {
  const classes = [
    'st-btn',
    variant === 'primary' ? 'st-btn-primary'
      : variant === 'danger' ? 'st-btn-danger'
        : variant === 'danger-secondary' ? 'st-btn-danger-secondary'
          : variant === 'ghost' ? 'st-btn-ghost'
            : 'st-btn-secondary',
    size === 'sm' ? 'st-btn-sm' : '',
    icon && !children ? 'st-btn-icon' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}

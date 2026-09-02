import type { ReactNode } from 'react';
import DesktopWindowChrome from './DesktopWindowChrome';

export default function StandaloneWindowChrome({
  title,
  subtitle,
  center,
  right,
}: {
  title: string;
  subtitle?: string;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <DesktopWindowChrome
      className="standalone-window-chrome"
      left={(
        <div className="standalone-window-title">
          <img src="/brand/v4/brand-mark-64.png" alt="" width={22} height={22} draggable={false} />
          <span className="standalone-window-title-copy">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </span>
        </div>
      )}
      center={center ? <div className="standalone-window-center-title">{center}</div> : null}
      right={right ? <div className="standalone-window-actions">{right}</div> : null}
    />
  );
}

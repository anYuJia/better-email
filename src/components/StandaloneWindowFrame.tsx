import type { ReactNode } from 'react';
import StandaloneWindowChrome from './StandaloneWindowChrome';

export default function StandaloneWindowFrame({
  kind,
  title,
  subtitle,
  children,
}: {
  kind: 'composer' | 'settings';
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className={`standalone-window-frame standalone-window-frame-${kind}`}>
      <StandaloneWindowChrome title={title} subtitle={subtitle} />
      <div className="standalone-window-content">{children}</div>
    </div>
  );
}

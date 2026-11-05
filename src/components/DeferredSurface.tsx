import type { ReactNode } from 'react';
import ComposerLoadingBoundary from './composer/ComposerLoadingBoundary';

type DeferredSurfaceProps = { label: string } | { compose: false | (() => void); mobile?: boolean; children: ReactNode };

export default function DeferredSurface(props: DeferredSurfaceProps) {
  if ('compose' in props) return <ComposerLoadingBoundary open={props.compose} mobile={props.mobile}>{props.children}</ComposerLoadingBoundary>;
  const { label } = props;
  return (
    <div className="deferred-overlay" role="status" aria-live="polite">
      <div className="deferred-surface">
        <span className="deferred-spinner" aria-hidden="true" />
        <strong>{label}</strong>
      </div>
    </div>
  );
}

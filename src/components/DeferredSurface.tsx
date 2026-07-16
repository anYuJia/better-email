type DeferredSurfaceProps = {
  label: string;
};

export default function DeferredSurface({ label }: DeferredSurfaceProps) {
  return (
    <div className="deferred-overlay" role="status" aria-live="polite">
      <div className="deferred-surface">
        <span className="deferred-spinner" aria-hidden="true" />
        <strong>{label}</strong>
      </div>
    </div>
  );
}

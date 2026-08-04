type ReaderSecurityBannerProps = {
  warnings: string[];
  showRemoteImageNote: boolean;
};

export default function ReaderSecurityBanner({ warnings, showRemoteImageNote }: ReaderSecurityBannerProps) {
  if (warnings.length === 0 && !showRemoteImageNote) return null;

  return (
    <div className="reader-warning-panel">
      <div className="reader-warning-heading">
        <strong>安全提示</strong>
        {showRemoteImageNote && (
          <span>远程图片默认阻止</span>
        )}
      </div>
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
    </div>
  );
}

type ReaderSecurityBannerProps = {
  warnings: string[];
  showRemoteImageNote: boolean;
  hasRenderableHtml: boolean;
  selectedSenderTrusted: boolean;
  selectedSenderDomain: string;
  onAllowRemoteImagesOnce: () => void;
  onTrustSender: () => void;
  onTrustDomain: () => void;
};

export default function ReaderSecurityBanner({
  warnings,
  showRemoteImageNote,
  hasRenderableHtml,
  selectedSenderTrusted,
  selectedSenderDomain,
  onAllowRemoteImagesOnce,
  onTrustSender,
  onTrustDomain,
}: ReaderSecurityBannerProps) {
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
      {showRemoteImageNote && hasRenderableHtml && (
        <div className="reader-warning-action-row">
          <button
            type="button"
            className="reader-warning-primary-action"
            onClick={onAllowRemoteImagesOnce}
          >
            显示本封图片
          </button>
          {!selectedSenderTrusted && (
            <>
              <button type="button" className="reader-warning-secondary-action" onClick={onTrustSender}>
                信任发件人
              </button>
              {selectedSenderDomain.trim() && (
                <button type="button" className="reader-warning-secondary-action" onClick={onTrustDomain}>
                  信任 {selectedSenderDomain}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

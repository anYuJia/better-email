type ReaderSecurityBannerProps = {
  warnings: string[];
  showRemoteImageNote: boolean;
  hasRenderableHtml: boolean;
  selectedSenderTrusted: boolean;
  selectedSenderDomain: string;
  selectedSenderIsExternal: boolean;
  selectedExternalBlocked: boolean;
  showLinkAction: boolean;
  linkActionLabel: string;
  onLinkAction: () => void;
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
  selectedSenderIsExternal,
  selectedExternalBlocked,
  showLinkAction,
  linkActionLabel,
  onLinkAction,
  onAllowRemoteImagesOnce,
  onTrustSender,
  onTrustDomain,
}: ReaderSecurityBannerProps) {
  if (warnings.length === 0 && !showRemoteImageNote && !selectedExternalBlocked && !showLinkAction) {
    return null;
  }

  const externalBlockNote = selectedExternalBlocked
    ? '发件人来自外部邮箱，已按账号策略拦截远程图片等远程内容。'
    : null;
  const showImageAction = showRemoteImageNote && hasRenderableHtml;
  const showActionRow = Boolean(
    !selectedExternalBlocked && (showLinkAction || showImageAction),
  );

  return (
    <div className="reader-warning-panel">
      <div className="reader-warning-heading">
        <strong>安全提示</strong>
        {(showRemoteImageNote || selectedExternalBlocked) && (
          <span>{selectedExternalBlocked ? '外部邮箱已拦截' : '远程图片默认阻止'}</span>
        )}
      </div>
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
      {externalBlockNote && <p>{externalBlockNote}</p>}
      {showActionRow && (
        <div className="reader-warning-action-row">
          {showLinkAction && (
            <button
              type="button"
              className="reader-warning-primary-action"
              onClick={onLinkAction}
            >
              {linkActionLabel}
            </button>
          )}
          {showImageAction && (
            <button
              type="button"
              className="reader-warning-primary-action"
              onClick={onAllowRemoteImagesOnce}
            >
              显示本封图片
            </button>
          )}
          {showImageAction && !selectedSenderTrusted && (
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

import { readerSecurityCopy } from '../../app/readerSecurityCopy';

type ReaderSecurityBannerProps = {
  warnings: string[];
  showRemoteImageNote: boolean;
  hasRenderableHtml: boolean;
  selectedSenderTrusted: boolean;
  selectedSenderDomain: string;
  selectedSenderIsExternal: boolean;
  selectedExternalBlocked: boolean;
  selectedWarnExternalSender: boolean;
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
  selectedExternalBlocked,
  selectedWarnExternalSender,
  showLinkAction,
  linkActionLabel,
  onLinkAction,
  onAllowRemoteImagesOnce,
  onTrustSender,
  onTrustDomain,
}: ReaderSecurityBannerProps) {
  if (
    warnings.length === 0
    && !showRemoteImageNote
    && !selectedExternalBlocked
    && !selectedWarnExternalSender
    && !showLinkAction
  ) {
    return null;
  }

  const externalBlockNote = selectedExternalBlocked
    ? '发件人来自外部邮箱，已按账号策略拦截远程图片等远程内容。'
    : null;
  const externalSenderNote = !selectedExternalBlocked && selectedWarnExternalSender
    ? '这封邮件来自其他邮箱 / 外部发件人，请注意核对发件人身份。'
    : null;
  const showImageAction = showRemoteImageNote && hasRenderableHtml;
  const showActionRow = Boolean(
    !selectedExternalBlocked && (showLinkAction || showImageAction),
  );

  return (
    <aside className="reader-warning-panel" aria-label="安全提示">
      <div className="reader-warning-heading">
        <strong>安全提示</strong>
        {(showRemoteImageNote || selectedExternalBlocked || selectedWarnExternalSender) && (
          <span className="reader-warning-badge">
            {selectedExternalBlocked
              ? '外部邮箱已拦截'
              : selectedWarnExternalSender
                ? '外部发件人'
                : '远程图片默认阻止'}
          </span>
        )}
      </div>
      {warnings.map((warning) => <p key={warning}>{warning}</p>)}
      {externalBlockNote && <p>{externalBlockNote}</p>}
      {externalSenderNote && <p>{externalSenderNote}</p>}
      {showLinkAction && <p>{readerSecurityCopy.linksHidden}</p>}
      {showActionRow && (
        <div className="reader-warning-action-row">
          {showImageAction && (
            <button
              type="button"
              className="reader-warning-primary-action"
              onClick={onAllowRemoteImagesOnce}
            >
              显示图片
            </button>
          )}
          {(showLinkAction || (showImageAction && !selectedSenderTrusted)) && (
            <details className="reader-warning-more compact-menu">
              <summary>更多</summary>
              <div>
                {showLinkAction && (
                  <button type="button" onClick={onLinkAction}>{linkActionLabel}</button>
                )}
                {showImageAction && !selectedSenderTrusted && (
                  <>
                    <button type="button" onClick={onTrustSender}>信任发件人</button>
                    {selectedSenderDomain.trim() && (
                      <button type="button" onClick={onTrustDomain}>信任 {selectedSenderDomain}</button>
                    )}
                  </>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </aside>
  );
}

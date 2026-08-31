import { useRef } from 'react';
import { MoreHorizontal, ShieldAlert, ShieldCheck } from 'lucide-react';
import { readerSecurityCopy } from '../../app/readerSecurityCopy';
import { useDetailsMenu } from '../../hooks/useDetailsMenu';

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
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  const moreMenu = useDetailsMenu(moreMenuRef, { floating: true });

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
  const contentWarnings = warnings.filter((warning) => !warning.includes('远程图片'));
  const showImageAction = showRemoteImageNote && hasRenderableHtml;
  const showActionRow = Boolean(
    !selectedExternalBlocked && (showLinkAction || showImageAction),
  );
  const isCaution = Boolean(
    selectedExternalBlocked || selectedWarnExternalSender || contentWarnings.length > 0,
  );
  const title = selectedExternalBlocked
    ? '已拦截外部内容'
    : selectedWarnExternalSender
      ? '请核对外部发件人'
      : contentWarnings.length > 0
        ? '请核对邮件内容'
        : showRemoteImageNote
          ? '远程图片已拦截'
          : '网页链接已隐藏';
  const privacyNote = showRemoteImageNote && !selectedExternalBlocked
    ? showLinkAction
      ? '图片未自动加载，网页链接也保持隐藏，以减少追踪和误触。'
      : '图片未自动加载，可避免追踪像素记录阅读行为。'
    : null;
  const notes = [...new Set([
    externalBlockNote,
    externalSenderNote,
    ...contentWarnings,
    privacyNote,
    showLinkAction && !showRemoteImageNote ? readerSecurityCopy.linksHidden : null,
  ].filter((note): note is string => Boolean(note)))];
  const SecurityIcon = isCaution ? ShieldAlert : ShieldCheck;

  return (
    <aside
      className={`reader-warning-panel${isCaution ? ' is-caution' : ''}`}
      aria-label="安全提示"
    >
      <span className="reader-warning-icon" aria-hidden="true">
        <SecurityIcon size={16} strokeWidth={1.8} />
      </span>
      <div className="reader-warning-content">
        <strong>{title}</strong>
        <div className="reader-warning-messages">
          {notes.map((note) => <p key={note}>{note}</p>)}
        </div>
      </div>
      {showActionRow && (
        <div className="reader-warning-action-row">
          {showImageAction && (
            <button
              type="button"
              className="reader-security-primary-action"
              onClick={onAllowRemoteImagesOnce}
            >
              显示图片
            </button>
          )}
          {(showLinkAction || (showImageAction && !selectedSenderTrusted)) && (
            <details
              className="reader-warning-more compact-menu"
              ref={moreMenuRef}
              data-floating-menu="true"
            >
              <summary aria-label="更多安全选项" title="更多安全选项">
                <MoreHorizontal size={16} aria-hidden="true" />
              </summary>
              <div>
                {showLinkAction && (
                  <button
                    type="button"
                    onClick={() => {
                      onLinkAction();
                      moreMenu.closeMenu();
                    }}
                  >
                    {linkActionLabel}
                  </button>
                )}
                {showImageAction && !selectedSenderTrusted && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onTrustSender();
                        moreMenu.closeMenu();
                      }}
                    >
                      信任发件人
                    </button>
                    {selectedSenderDomain.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          onTrustDomain();
                          moreMenu.closeMenu();
                        }}
                      >
                        信任 {selectedSenderDomain}
                      </button>
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

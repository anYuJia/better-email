import EmailReaderSkeleton from './EmailReaderSkeleton';
import EmailShadowView from './reader/EmailShadowView';
import PlainMessageBody, { EmptyMessageBody } from './reader/PlainMessageBody';
import { parseMailtoUrl } from '../mailUtils';
import { logWarn } from '../app/logger';

type ReaderBodyContentProps = {
  isBodyRenderReady: boolean;
  showPlaceholder: boolean;
  hasRenderableHtml: boolean;
  shouldOfferRemoteContent: boolean;
  readerHtml: string;
  plainBodyForReader: string;
  linksHidden: boolean;
  handleReaderHtmlClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleReaderHtmlContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onAllowRemoteImagesOnce: () => void;
  onOpenLink: (href: string) => void;
  onComposeNew: (fields?: { to?: string; cc?: string; bcc?: string; subject?: string; body?: string }) => void;
};

export default function ReaderBodyContent({
  isBodyRenderReady,
  showPlaceholder,
  hasRenderableHtml,
  shouldOfferRemoteContent,
  readerHtml,
  plainBodyForReader,
  linksHidden,
  handleReaderHtmlClick,
  handleReaderHtmlContextMenu,
  onAllowRemoteImagesOnce,
  onOpenLink,
  onComposeNew,
}: ReaderBodyContentProps) {
  // While the next message's body is being prepared, show the loading skeleton
  // instead of stale content from the previously rendered message.
  if (!isBodyRenderReady) {
    return showPlaceholder ? <EmailReaderSkeleton /> : null;
  }
  if (hasRenderableHtml) {
    return (
      <div className="reader-html-container">
        <EmailShadowView
          className="reader-html"
          html={readerHtml}
          linksHidden={linksHidden}
          onClick={handleReaderHtmlClick}
          onContextMenuCapture={handleReaderHtmlContextMenu}
          onContextMenu={handleReaderHtmlContextMenu}
          onLinkClick={(href) => {
            const lowerHref = href.toLowerCase();
            if (lowerHref.startsWith('mailto:')) {
              onComposeNew(parseMailtoUrl(href));
            } else if (lowerHref.startsWith('http://') || lowerHref.startsWith('https://')) {
              onOpenLink(href);
            } else {
              logWarn('Blocked navigation to unsafe/unknown protocol:', href);
            }
          }}
        />
      </div>
    );
  }
  if (shouldOfferRemoteContent) {
    return (
      <EmptyMessageBody
        title="正文主要由远程图片组成"
        detail="已先阻止自动加载，点击后会显示本邮件中的 HTTPS 图片；正文链接保持「已隐藏链接」，可在安全提示中查看后打开。"
        action={(
          <button
            type="button"
            className="reader-warning-primary-action"
            onClick={onAllowRemoteImagesOnce}
          >
            查看内容
          </button>
        )}
      />
    );
  }
  return <PlainMessageBody body={plainBodyForReader} linksHidden={linksHidden} />;
}

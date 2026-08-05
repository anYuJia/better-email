import type { Dispatch, SetStateAction } from 'react';
import EmailReaderSkeleton from './EmailReaderSkeleton';
import EmailShadowView from './reader/EmailShadowView';
import PlainMessageBody, { EmptyMessageBody } from './reader/PlainMessageBody';
import { parseMailtoUrl } from '../mailUtils';

type ReaderBodyContentProps = {
  isBodyRenderReady: boolean;
  showPlaceholder: boolean;
  hasRenderableHtml: boolean;
  shouldOfferRemoteContent: boolean;
  readerHtml: string;
  plainBodyForReader: string;
  handleReaderHtmlClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleReaderHtmlContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onAllowRemoteImagesOnce: () => void;
  interceptHttpsLinks: boolean;
  onOpenHttpsLink: (href: string) => void;
  onComposeNew: (fields?: { to?: string; cc?: string; bcc?: string; subject?: string; body?: string }) => void;
  onLinkClick: (href: string, text: string) => void;
  setClickedLink: Dispatch<SetStateAction<{ href: string; text: string } | null>>;
};

export default function ReaderBodyContent({
  isBodyRenderReady,
  showPlaceholder,
  hasRenderableHtml,
  shouldOfferRemoteContent,
  readerHtml,
  plainBodyForReader,
  handleReaderHtmlClick,
  handleReaderHtmlContextMenu,
  onAllowRemoteImagesOnce,
  interceptHttpsLinks,
  onOpenHttpsLink,
  onComposeNew,
  onLinkClick,
  setClickedLink,
}: ReaderBodyContentProps) {
  // While the next message's body is being prepared, keep the previously
  // rendered body on screen for at most the placeholder grace period; once the
  // loading placeholder is due, show the skeleton instead so a slow or failed
  // body can never leave stale content from the previous message on screen.
  if (!isBodyRenderReady) {
    if (showPlaceholder) {
      return <EmailReaderSkeleton />;
    }
    const hasRenderedContent = Boolean(readerHtml.trim() || plainBodyForReader.trim());
    if (!hasRenderedContent) return null;
  }
  if (hasRenderableHtml) {
    return (
      <div className="reader-html-container">
        <EmailShadowView
          className="reader-html"
          html={readerHtml}
          onClick={handleReaderHtmlClick}
          onContextMenuCapture={handleReaderHtmlContextMenu}
          onContextMenu={handleReaderHtmlContextMenu}
          onLinkClick={(href, text) => {
            const lowerHref = href.toLowerCase();
            if (lowerHref.startsWith('mailto:')) {
              onComposeNew(parseMailtoUrl(href));
            } else if (lowerHref.startsWith('http://') || lowerHref.startsWith('https://')) {
              if (interceptHttpsLinks || lowerHref.startsWith('http://')) {
                onLinkClick(href, text);
              } else {
                onOpenHttpsLink(href);
              }
            } else {
              console.warn('Blocked navigation to unsafe/unknown protocol:', href);
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
        detail="已先阻止自动加载，点击后会显示本邮件中的 HTTPS 图片；外部链接仍不会变成可点击跳转。"
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
  return <PlainMessageBody body={plainBodyForReader} />;
}

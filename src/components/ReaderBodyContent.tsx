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
  bodyFetchStatus?: 'loading' | 'error' | null;
  bodyFetchError?: string | null;
  onRetryBodyFetch?: () => void | Promise<void>;
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
  bodyFetchStatus = null,
  bodyFetchError = null,
  onRetryBodyFetch,
}: ReaderBodyContentProps) {
  // While the next message's body is being prepared, show the loading skeleton
  // instead of stale content from the previously rendered message.
  if (bodyFetchStatus === 'loading') {
    return <EmailReaderSkeleton />;
  }
  if (!isBodyRenderReady) {
    return showPlaceholder ? <EmailReaderSkeleton /> : null;
  }
  if (bodyFetchStatus === 'error') {
    return (
      <EmptyMessageBody
        role="alert"
        title="无法加载邮件正文"
        detail={`${bodyFetchError || '与邮件服务器的连接失败'}。请检查网络或账号连接后重试。`}
        action={onRetryBodyFetch ? (
          <button
            type="button"
            className="reader-warning-primary-action"
            onClick={() => {
              Promise.resolve(onRetryBodyFetch()).catch(() => undefined);
            }}
          >
            重试拉取正文
          </button>
        ) : undefined}
      />
    );
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
              try {
                onComposeNew(parseMailtoUrl(href));
              } catch (error) {
                const fallbackTo = href.slice(7).split('?')[0];
                let fallbackAddress = fallbackTo;

                try {
                  if (fallbackTo) {
                    fallbackAddress = decodeURIComponent(fallbackTo);
                  }
                } catch (decodeError) {
                  logWarn('Failed to decode mailto recipient, using raw value', fallbackTo, decodeError);
                }

                onComposeNew(fallbackAddress ? { to: fallbackAddress } : undefined);
                logWarn('Failed to parse mailto URL, using fallback recipient:', href, error);
              }
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

import { useState } from 'react';
import EmailReaderSkeleton from './EmailReaderSkeleton';
import EmailShadowView from './reader/EmailShadowView';
import PlainMessageBody, { EmptyMessageBody } from './reader/PlainMessageBody';
import type { MessageTranslationFormat } from '../hooks/useMessageTranslation';
import { htmlHasRenderableContent, parseMailtoUrl } from '../mailUtils';
import { logWarn } from '../app/logger';

export type ReaderTranslationContent = {
  format: MessageTranslationFormat;
  content: string;
};

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
  translation?: ReaderTranslationContent | null;
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
  translation = null,
  bodyFetchStatus = null,
  bodyFetchError = null,
  onRetryBodyFetch,
}: ReaderBodyContentProps) {
  const [expandedBody, setExpandedBody] = useState<string | null>(null);
  const translatedHtml = translation?.format === 'html' ? translation.content : '';
  const translatedPlain = translation?.format === 'plain' ? translation.content : '';
  const translatedHtmlReady = Boolean(
    translatedHtml.trim() && htmlHasRenderableContent(translatedHtml),
  );
  const translatedPlainReady = Boolean(translatedPlain.trim());
  const useTranslation = translatedHtmlReady || translatedPlainReady;
  const activeHasRenderableHtml = useTranslation ? translatedHtmlReady : hasRenderableHtml;
  const activeReaderHtml = useTranslation && translatedHtmlReady ? translatedHtml : readerHtml;
  const activePlainBody = useTranslation && translatedPlainReady ? translatedPlain : plainBodyForReader;
  const activeBody = activeHasRenderableHtml ? activeReaderHtml : activePlainBody;
  const requiresExplicitRender = activeBody.length > 256_000 && expandedBody !== activeBody;
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
  if (requiresExplicitRender) {
    return (
      <EmptyMessageBody
        title="这封邮件较大，尚未渲染完整内容"
        detail="正文完整保存在本机，没有截断。加载完整邮件可能需要更多内存。"
        action={<button type="button" className="reader-warning-primary-action" onClick={() => setExpandedBody(activeBody)}>加载完整邮件</button>}
      />
    );
  }
  if (activeHasRenderableHtml) {
    return (
      <div className="reader-html-container">
        <EmailShadowView
          className="reader-html"
          html={activeReaderHtml}
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
  if (!useTranslation && shouldOfferRemoteContent) {
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
  return <PlainMessageBody body={activePlainBody} linksHidden={linksHidden} />;
}

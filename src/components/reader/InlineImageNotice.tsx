import { ImageIcon } from 'lucide-react';
import type { InlineImageResolution } from '../../app/inlineImages';

type InlineImageNoticeProps = {
  inlineImageResolution: InlineImageResolution;
  inlineImageError: string | null;
  inlineImageRefreshError: string | null;
  isDownloadingInlineImages: boolean;
  isRefreshingInlineImages: boolean;
  onLoadInlineImages: () => void;
};

export default function InlineImageNotice({
  inlineImageResolution,
  inlineImageError,
  inlineImageRefreshError,
  isDownloadingInlineImages,
  isRefreshingInlineImages,
  onLoadInlineImages,
}: InlineImageNoticeProps) {
  if (inlineImageResolution.pendingAttachments.length === 0
    && inlineImageResolution.missingContentIds.length === 0) {
    return null;
  }
  return (
    <div className="inline-image-notice" role="status">
      <span className="inline-image-notice-icon" aria-hidden="true">
        <ImageIcon size={16} />
      </span>
      <span className="inline-image-notice-copy">
        <strong>
          {isRefreshingInlineImages
            ? '正在读取内嵌图片'
            : inlineImageResolution.pendingAttachments.length > 0
              ? `正文包含 ${inlineImageResolution.pendingAttachments.length} 张内嵌图片`
              : '部分内嵌图片不可用'}
        </strong>
        <small>
          {inlineImageError
            || inlineImageRefreshError
            || (isRefreshingInlineImages
              ? '正在从服务器重新获取附件信息'
              : inlineImageResolution.missingContentIds.length > 0
                ? `${inlineImageResolution.missingContentIds.length} 张图片暂未匹配到附件`
                : '按需加载，减少内存和网络占用')}
        </small>
      </span>
      {inlineImageResolution.pendingAttachments.length > 0 && (
        <button
          type="button"
          disabled={isDownloadingInlineImages}
          aria-busy={isDownloadingInlineImages}
          onClick={onLoadInlineImages}
        >
          {isDownloadingInlineImages ? '加载中…' : inlineImageError ? '重试' : '显示图片'}
        </button>
      )}
    </div>
  );
}

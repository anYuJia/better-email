import type {
  Attachment,
  OutboundAttachmentInput,
} from './types';

export type ForwardAttachmentPlan = {
  attachments: OutboundAttachmentInput[];
  unavailableCount: number;
  totalCount: number;
};

export function buildForwardAttachmentPlan(
  sourceAttachments: Attachment[],
  expectedTotalCount = sourceAttachments.length,
): ForwardAttachmentPlan {
  const attachments = sourceAttachments
    .filter((attachment) => attachment.is_downloaded && attachment.local_path.trim())
    .map((attachment) => ({
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      local_path: attachment.local_path,
    }));

  return {
    attachments,
    unavailableCount: Math.max(expectedTotalCount, sourceAttachments.length) - attachments.length,
    totalCount: Math.max(expectedTotalCount, sourceAttachments.length),
  };
}

export function forwardAttachmentStatus(plan: ForwardAttachmentPlan): string {
  if (plan.totalCount === 0) return '已创建转发草稿';
  if (plan.unavailableCount === 0) {
    return `已创建转发草稿，已带入 ${plan.attachments.length} 个附件`;
  }
  if (plan.attachments.length === 0) {
    return `已创建转发草稿；${plan.unavailableCount} 个附件尚未下载，未自动加入`;
  }
  return `已创建转发草稿，已带入 ${plan.attachments.length} 个附件；${plan.unavailableCount} 个附件尚未下载`;
}

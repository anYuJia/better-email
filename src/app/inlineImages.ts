import type { Attachment } from './types';

export type InlineImageResolution = {
  html: string;
  referencedContentIds: string[];
  resolvedContentIds: string[];
  pendingAttachments: Attachment[];
  missingContentIds: string[];
};

const CID_SOURCE_ATTRIBUTE =
  /\bsrc\s*=\s*(?:"\s*cid:([^"]*)"|'\s*cid:([^']*)'|cid:([^\s>]+))/i;
const IMAGE_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function decodeContentId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeContentId(value: string): string {
  let normalized = decodeContentId(value.trim()).replace(/^cid:/i, '').trim();
  while (normalized.startsWith('<') && normalized.endsWith('>')) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.toLowerCase();
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function attachmentIsReady(attachment: Attachment) {
  return attachment.is_downloaded && Boolean(attachment.local_path.trim());
}

function looksLikeImageAttachment(attachment: Attachment) {
  const mimeType = attachment.mime_type.toLowerCase();
  if (mimeType.startsWith('image/')) return true;

  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|heic|heif)(?:$|[?#])/i.test(attachment.filename)
    || /\.(png|jpe?g|gif|webp|svg|bmp|ico|heic|heif)(?:$|[?#])/i.test(attachment.content_id);
}

export function resolveCidInlineImages(
  html: string,
  attachments: Attachment[],
  assetUrlForAttachment: (attachment: Attachment) => string,
): InlineImageResolution {
  const inlineImagesByContentId = new Map<string, Attachment>();

  attachments
    .filter(
      (attachment) =>
        attachment.is_inline
        && looksLikeImageAttachment(attachment)
        && normalizeContentId(attachment.content_id),
    )
    .forEach((attachment) => {
      const contentId = normalizeContentId(attachment.content_id);
      const current = inlineImagesByContentId.get(contentId);
      if (!current || (!attachmentIsReady(current) && attachmentIsReady(attachment))) {
        inlineImagesByContentId.set(contentId, attachment);
      }
    });

  const referencedContentIds = new Set<string>();
  const resolvedContentIds = new Set<string>();
  const pendingAttachments = new Map<number, Attachment>();
  const missingContentIds = new Set<string>();

  const resolvedHtml = html.replace(IMAGE_TAG, (imageTag) => {
    const sourceMatch = CID_SOURCE_ATTRIBUTE.exec(imageTag);
    if (!sourceMatch) return imageTag;

    const contentId = normalizeContentId(
      sourceMatch[1] ?? sourceMatch[2] ?? sourceMatch[3] ?? '',
    );
    if (!contentId) return imageTag;
    referencedContentIds.add(contentId);

    const attachment = inlineImagesByContentId.get(contentId);
    if (!attachment) {
      missingContentIds.add(contentId);
      return imageTag.replace(
        sourceMatch[0],
        `data-better-email-inline-cid="${escapeAttribute(contentId)}"`,
      );
    }

    if (!attachmentIsReady(attachment)) {
      pendingAttachments.set(attachment.id, attachment);
      return imageTag.replace(
        sourceMatch[0],
        `data-better-email-inline-cid="${escapeAttribute(contentId)}"`,
      );
    }

    const assetUrl = assetUrlForAttachment(attachment).trim();
    if (!assetUrl) {
      pendingAttachments.set(attachment.id, attachment);
      return imageTag.replace(
        sourceMatch[0],
        `data-better-email-inline-cid="${escapeAttribute(contentId)}"`,
      );
    }

    resolvedContentIds.add(contentId);
    return imageTag.replace(
      sourceMatch[0],
      `src="${escapeAttribute(assetUrl)}" data-better-email-attachment-id="${attachment.id}"`,
    );
  });

  return {
    html: resolvedHtml,
    referencedContentIds: [...referencedContentIds],
    resolvedContentIds: [...resolvedContentIds],
    pendingAttachments: [...pendingAttachments.values()],
    missingContentIds: [...missingContentIds],
  };
}

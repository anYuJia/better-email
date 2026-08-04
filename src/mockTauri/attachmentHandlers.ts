import type { InvokeArgs, MockCommandHandler } from './types';
import { now } from './fixtures';
import { mimeTypeForMockPath } from './utils';
import {
  messages,
  attachments,
  labels,
  rules,
  outbox,
  mockStorageUsage,
  downloadMockAttachment,
  importMockEmlFile,
  clearMockAttachmentCache,
} from './state';

function handleLocalBackup(args?: InvokeArgs) {
  return {
    path: '/tmp/better-email-backup.json',
    exported_at: now,
    app_version: '0.1.0',
    schema_version: 1,
    accounts: 1,
    messages: messages.length,
    labels: labels.length,
    rules: rules.length,
    outbox_items: outbox.length,
    size_bytes: 8192,
    credentials_included: false,
  };
}

export const handlers: Record<string, MockCommandHandler> = {
  'list_attachments': (args) => attachments.filter((attachment) => attachment.message_id === args?.messageId),
  'download_attachment': downloadMockAttachment,
  'read_attachment_data_url': (args) => {
    const id = Number(args?.attachmentId);
    const attachment = attachments.find((item) => item.id === id);
    if (!attachment) throw new Error('attachment not found');
    const mimeType = attachment.mime_type?.trim() || mimeTypeForMockPath(attachment.filename);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" rx="18" fill="#f4f7fb"/><rect x="28" y="28" width="264" height="124" rx="12" fill="#ffffff" stroke="#d8e0ea"/><circle cx="78" cy="78" r="22" fill="#9ac7f7"/><path d="M42 136l64-54 46 36 34-28 92 46H42z" fill="#6f9ed2"/></svg>`;
    return `data:${mimeType};base64,${btoa(svg)}`;
  },
  'save_image_data_url_as': (args) => `图片已另存为 /tmp/${String(args?.filename || '邮件图片.png')}`,
  'open_attachment': (args) => {
    const attachment = attachments.find((item) => item.id === args?.attachmentId);
    return `已打开附件：${attachment?.filename ?? 'unknown'}`;
  },
  'reveal_attachment_in_finder': (args) => {
    const attachment = attachments.find((item) => item.id === args?.attachmentId);
    return `已在 Finder 中显示：${attachment?.filename ?? 'unknown'}`;
  },
  'copy_attachment_file_to_clipboard': (args) => {
    const attachment = attachments.find((item) => item.id === args?.attachmentId);
    return `已复制附件文件：${attachment?.filename ?? 'unknown'}`;
  },
  'save_attachment_as': (args) => {
    const attachment = attachments.find((item) => item.id === args?.attachmentId);
    return `已另存附件：${attachment?.filename ?? 'unknown'}`;
  },
  'export_message_as_eml': (args) => {
    const message = messages.find((item) => item.id === args?.messageId);
    return `邮件已导出为 /tmp/${message?.subject || 'better-email-message'}.eml`;
  },
  'import_eml_file': importMockEmlFile,
  'pick_outbound_attachments': () => [
    {
      filename: 'smoke-brief.txt',
      mime_type: 'text/plain',
      size_bytes: 16,
      local_path: '/tmp/better-email/smoke-brief.txt',
    },
  ],
  'outbound_attachments_from_paths': (args) => {
    const paths = Array.isArray(args?.paths) ? args.paths : [];
    return paths
      .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      .map((path) => {
        const filename = path.split(/[\\/]/).pop() || 'attachment';
        return {
          filename,
          mime_type: mimeTypeForMockPath(filename),
          size_bytes: 0,
          local_path: path,
        };
      });
  },
  'get_storage_usage': () => mockStorageUsage(),
  'clear_attachment_cache': clearMockAttachmentCache,
  'export_local_backup': handleLocalBackup,
  'preview_local_backup': handleLocalBackup,
  'import_local_backup': handleLocalBackup,
};

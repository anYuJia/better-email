import {
  File,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
} from 'lucide-react';
import type { Attachment } from '../../app/types';

export function attachmentKind(attachment: Attachment) {
  const filename = attachment.filename.toLowerCase();
  const mimeType = attachment.mime_type.toLowerCase();
  if (/\.(ppt|pptx|key)$/i.test(filename)) return 'presentation';
  if (/\.(xls|xlsx|csv|numbers)$/i.test(filename)) return 'spreadsheet';
  if (/\.(doc|docx|rtf|pdf|txt|md|log)$/i.test(filename)) return 'document';
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(filename)) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || /\.(zip|rar|7z|tar|gz)$/i.test(filename)) return 'archive';
  if (mimeType.includes('presentation') || /\.(ppt|pptx|key)$/i.test(filename)) return 'presentation';
  if (mimeType.includes('spreadsheet') || /\.(xls|xlsx|csv|numbers)$/i.test(filename)) return 'spreadsheet';
  if (mimeType.includes('pdf') || mimeType.startsWith('text/') || /\.(pdf|txt|md|log|rtf|doc|docx)$/i.test(filename)) return 'document';
  return 'file';
}

export function attachmentIcon(attachment: Attachment) {
  const kind = attachmentKind(attachment);
  const filename = attachment.filename.toLowerCase();
  if (kind === 'presentation') return <span className="attachment-file-type-mark">PPT</span>;
  if (kind === 'spreadsheet') return <span className="attachment-file-type-mark">XLS</span>;
  if (/\.pdf$/i.test(filename)) return <span className="attachment-file-type-mark">PDF</span>;
  if (/\.(doc|docx|rtf)$/i.test(filename)) return <span className="attachment-file-type-mark">DOC</span>;
  if (kind === 'archive') return <span className="attachment-file-type-mark">ZIP</span>;
  if (kind === 'image') return <FileImage size={15} strokeWidth={1.9} />;
  if (kind === 'audio') return <FileAudio size={15} strokeWidth={1.9} />;
  if (kind === 'video') return <FileVideo size={15} strokeWidth={1.9} />;
  if (kind === 'document') return <FileText size={15} strokeWidth={1.9} />;
  return <File size={15} strokeWidth={1.9} />;
}

export function attachmentTypeDescription(attachment: Attachment) {
  const filename = attachment.filename.toLowerCase();
  const kind = attachmentKind(attachment);
  if (/\.pdf$/i.test(filename)) return 'PDF 文档';
  if (/\.(ppt|pptx|key)$/i.test(filename)) return 'PowerPoint 演示文稿';
  if (/\.(xls|xlsx|csv|numbers)$/i.test(filename)) return filename.endsWith('.csv') ? 'CSV 表格' : 'Excel 表格';
  if (/\.(doc|docx|rtf)$/i.test(filename)) return 'Word 文档';
  if (/\.(zip|rar|7z|tar|gz)$/i.test(filename)) return '压缩文件';
  if (kind === 'image') return '图片';
  if (kind === 'audio') return '音频';
  if (kind === 'video') return '视频';
  if (kind === 'document') return '文档';
  return '附件';
}

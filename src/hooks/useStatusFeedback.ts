import { useEffect, useRef } from 'react';
import type { AttachmentImportItem } from '../app/attachmentImports';
import type { ComposerSendIssue } from './useComposerSend';

// A visible, actionable composer error already has its own live region.
// Keep global notifications for errors outside that surface or while hidden.
export default function useStatusFeedback(
  status: string,
  showToast: (message: string, tone: 'error') => void,
  composer: { visible: boolean; sendIssue: ComposerSendIssue | null; imports: AttachmentImportItem[] },
) {
  const previous = useRef(status);
  const sendError = composer.sendIssue?.message === status;
  const inline = composer.visible && (sendError
    || status.startsWith('保存失败，邮件内容已保留：')
    || (status.startsWith('附件准备失败：') && composer.imports.some(item => item.status === 'failed')));
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (inline || (!sendError && !/(?:^Error:|失败|错误|出错|无法|不能|被拒绝|超时|请先|尚未配置|不存在)/i.test(status))) return;
    showToast(status.replace(/^Error:\s*/i, ''), 'error');
  }, [status, inline, sendError, showToast]);
}

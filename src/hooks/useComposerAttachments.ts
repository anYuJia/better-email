import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { OutboundAttachmentInput } from '../app/types';
import { getCurrentWindow, invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';
import { logError } from '../app/logger';

type ComposerAttachmentsOptions = {
  isComposerOpen: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  onAttachmentsReady: (attachments: OutboundAttachmentInput[], statusPrefix?: string) => void;
  onInlineImagesReady: (attachments: OutboundAttachmentInput[]) => void;
  setAttachmentProgress?: (progress: number | null) => void;
};

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function nextInlineContentId(index: number) {
  return `inline-${Date.now().toString(36)}-${index}@better-email.local`;
}

export default function useComposerAttachments({
  isComposerOpen,
  setStatus,
  onAttachmentsReady,
  onInlineImagesReady,
  setAttachmentProgress,
}: ComposerAttachmentsOptions) {
  const [isComposerDropActive, setComposerDropActive] = useState(false);

  useEffect(() => {
    if (!isComposerOpen) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;

    getCurrentWindow().onDragDropEvent(async (event) => {
      if (!active) return;
      if (event.type === 'enter' || event.type === 'over') {
        setComposerDropActive(true);
        return;
      }
      if (event.type === 'leave') {
        setComposerDropActive(false);
        return;
      }
      setComposerDropActive(false);
      const paths = event.paths.filter((path) => path.trim());
      if (paths.length === 0) {
        setStatus('拖拽内容中没有文件');
        return;
      }
      // 操作系统拖放只暴露路径，renderer 可伪造任意路径，后端不能据此授权文件。
      // 因此 OS 拖放不再走路径 IPC（outbound_attachments_from_paths 已移除），
      // 回退到原生文件选择器流程（由后端登记具体文件）。
      // HTML5 拖放 / 粘贴（File 对象）仍走 save_temp_attachment，由后端写私有临时文件。
      setStatus('已捕获系统拖放文件，请通过「选择附件」选择要附加的文件');
      void pickDraftAttachments().catch((error) => {
        setStatus(`附件选择失败：${String(error)}`);
      });
    })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      })
      .catch((error) => {
        setStatus(`附件拖拽不可用：${String(error)}`);
      });

    return () => {
      active = false;
      setComposerDropActive(false);
      unlisten?.();
    };
  }, [isComposerOpen, onAttachmentsReady]);

  function setDropActive(next: boolean) {
    setComposerDropActive(next);
  }

  function reportAttachmentProgress(completed: number, total: number) {
    if (!setAttachmentProgress) return;
    if (total <= 0) {
      setAttachmentProgress(0);
      return;
    }
    const normalized = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
    setAttachmentProgress(normalized);
  }

  function clearAttachmentProgress() {
    setAttachmentProgress?.(null);
  }

  async function pickDraftAttachments() {
    const newAttachments = await invoke<OutboundAttachmentInput[]>(IPC.PickOutboundAttachments);
    if (newAttachments.length === 0) {
      setStatus('已取消选择附件');
      return;
    }
    onAttachmentsReady(newAttachments, '已添加附件');
  }

  async function buildInlineImageAttachments(files: File[]): Promise<OutboundAttachmentInput[]> {
    const savedAttachments: OutboundAttachmentInput[] = [];
    const total = files.length;
    if (total === 0) {
      return savedAttachments;
    }
    reportAttachmentProgress(0, total);
    for (const [index, file] of files.entries()) {
      try {
        if (total > 1) {
          setStatus(`正在插入图片 (${index + 1}/${total})...`);
        }
        const base64Data = await readFileAsBase64(file);
        const savedPath = await invoke<string>(IPC.SaveTempAttachment, {
          filename: file.name,
          base64Data,
        });
        savedAttachments.push({
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: Math.min(file.size, Number.MAX_SAFE_INTEGER),
          local_path: savedPath,
          content_id: nextInlineContentId(index),
          is_inline: true,
        });
        reportAttachmentProgress(index + 1, total);
      } catch (error) {
        clearAttachmentProgress();
        throw error;
      }
    }
    clearAttachmentProgress();
    return savedAttachments;
  }

  async function processDroppedOrPastedFiles(files: FileList | File[], statusPrefix = '已添加附件') {
    const validFiles = Array.from(files).filter((file) => file.name.trim());
    if (validFiles.length === 0) return;

    const totalFiles = validFiles.length;
    setStatus(`正在导入附件...`);
    reportAttachmentProgress(0, totalFiles);
    try {
      const savedAttachments: OutboundAttachmentInput[] = [];
      for (const [index, file] of validFiles.entries()) {
        setStatus(`正在导入附件 (${index + 1}/${totalFiles})...`);
        const base64Data = await readFileAsBase64(file);
        const savedPath = await invoke<string>(IPC.SaveTempAttachment, {
          filename: file.name,
          base64Data,
        });

        savedAttachments.push({
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: Math.min(file.size, Number.MAX_SAFE_INTEGER),
          local_path: savedPath,
        });
        reportAttachmentProgress(index + 1, totalFiles);
      }

      onAttachmentsReady(savedAttachments, statusPrefix);
    } catch (error) {
      logError(error);
      setStatus(`添加附件失败: ${String(error)}`);
    } finally {
      clearAttachmentProgress();
    }
  }

  function handleComposerAttachmentDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const files = event.dataTransfer.files;
    if (!files || files.length === 0) {
      setStatus('拖拽内容中没有文件');
      return;
    }
    void processDroppedOrPastedFiles(files, '已拖入附件');
  }

  function handleComposerAttachmentPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
    const otherFiles = Array.from(files).filter((file) => !file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      setStatus('正在插入图片...');
      buildInlineImageAttachments(imageFiles)
        .then((attachments) => onInlineImagesReady(attachments))
        .catch((error) => setStatus(`插入图片失败：${String(error)}`));
    }
    if (otherFiles.length > 0) {
      void processDroppedOrPastedFiles(otherFiles, '已粘贴附件');
    }
  }

  function handleComposerAttachmentDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  function handleComposerAttachmentDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(true);
  }

  function handleComposerAttachmentDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDropActive(false);
    }
  }

  return {
    isComposerDropActive,
    pickDraftAttachments,
    buildInlineImageAttachments,
    processDroppedOrPastedFiles,
    handleComposerAttachmentDrop,
    handleComposerAttachmentPaste,
    handleComposerAttachmentDragOver,
    handleComposerAttachmentDragEnter,
    handleComposerAttachmentDragLeave,
  };
}

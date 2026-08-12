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
      try {
        const newAttachments = await invoke<OutboundAttachmentInput[]>(IPC.OutboundAttachmentsFromPaths, { paths });
        onAttachmentsReady(newAttachments, '已拖入附件');
      } catch (error) {
        setStatus(`附件拖入失败：${String(error)}`);
      }
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
    for (const [index, file] of files.entries()) {
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
    }
    return savedAttachments;
  }

  async function processDroppedOrPastedFiles(files: FileList | File[], statusPrefix = '已添加附件') {
    const validFiles = Array.from(files).filter((file) => file.name.trim());
    if (validFiles.length === 0) return;

    setStatus('正在导入附件...');
    try {
      const savedAttachments: OutboundAttachmentInput[] = [];
      for (const file of validFiles) {
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
      }

      onAttachmentsReady(savedAttachments, statusPrefix);
    } catch (error) {
      logError(error);
      setStatus(`添加附件失败: ${String(error)}`);
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

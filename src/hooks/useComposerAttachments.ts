import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { OutboundAttachmentInput, PendingAttachmentRecovery } from '../app/types';
import { getCurrentWindow, invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';
import { importNativeDroppedAttachmentPaths } from '../app/nativeDroppedAttachments';
import { attachmentImportBlockReason, attachmentImportCancelled, normalizePendingAttachments, readAttachmentFile, type AttachmentImportItem } from '../app/attachmentImports';

type ComposerAttachmentsOptions = {
  isComposerOpen: boolean;
  setStatus: Dispatch<SetStateAction<string>>;
  onAttachmentsReady: (attachments: OutboundAttachmentInput[], statusPrefix?: string) => void;
  onInlineImagesReady: (attachments: OutboundAttachmentInput[]) => void;
  setAttachmentProgress?: (progress: number | null) => void;
  canImport?: () => boolean;
  getCurrentAttachments?: () => readonly OutboundAttachmentInput[];
};

type ImportSource = { kind: 'file'; file: File } | { kind: 'native'; path: string } | { kind: 'picker' };
type ImportWork = {
  id: string;
  source: ImportSource;
  inline: boolean;
  generation: number;
  attempt: number;
  controller: AbortController | null;
  recoveryFiles?: PendingAttachmentRecovery[];
};

function recoveredImportPatch(files: PendingAttachmentRecovery[]): Partial<AttachmentImportItem> {
  return {
    filename: `上次有 ${files.length} 个附件未准备好`, status: 'failed', progress: null,
    error: `请重新选择这些文件，或明确移除此提醒：${files.map(file => file.filename).join('、')}`,
    recoveryFiles: files,
  };
}

export default function useComposerAttachments(options: ComposerAttachmentsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [isComposerDropActive, setComposerDropActive] = useState(false);
  const [attachmentImports, setAttachmentImports] = useState<AttachmentImportItem[]>([]);
  const itemsRef = useRef<AttachmentImportItem[]>([]);
  const jobs = useRef(new Map<string, ImportWork>());
  const generation = useRef(0);
  const nextId = useRef(0);
  const mounted = useRef(true);
  const canStartImport = useCallback(() => {
    if (optionsRef.current.canImport?.() !== false) return true;
    optionsRef.current.setStatus('正在提交邮件，请等待完成后再添加附件。');
    return false;
  }, []);

  const publish = useCallback((items: AttachmentImportItem[]) => {
    itemsRef.current = items;
    if (!mounted.current) return;
    setAttachmentImports(items);
    const busy = items.some(item => item.status === 'queued' || item.status === 'preparing');
    optionsRef.current.setAttachmentProgress?.(busy
      ? Math.round(items.reduce((sum, item) => sum + (item.progress ?? 0), 0) / Math.max(1, items.length)) : null);
  }, []);
  const update = useCallback((id: string, patch: Partial<AttachmentImportItem>) => {
    publish(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item));
  }, [publish]);

  const resetAttachmentImports = useCallback(() => {
    generation.current += 1;
    for (const job of jobs.current.values()) job.controller?.abort();
    jobs.current.clear();
    publish([]);
    setComposerDropActive(false);
  }, [publish]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      for (const job of jobs.current.values()) job.controller?.abort();
      jobs.current.clear();
    };
  }, []);

  const register = useCallback((source: ImportSource, inline = false): ImportWork => {
    const id = `attachment-import-${++nextId.current}`;
    const filename = source.kind === 'file' ? source.file.name
      : source.kind === 'native' ? source.path.replace(/\\/g, '/').split('/').pop() || '附件'
        : '选择附件';
    const work: ImportWork = { id, source, inline, generation: generation.current, attempt: 0, controller: null };
    jobs.current.set(id, work);
    publish([...itemsRef.current, {
      id, filename, sizeBytes: source.kind === 'file' ? source.file.size : null,
      status: 'queued', progress: 0, error: null, source: source.kind, inline,
    }]);
    return work;
  }, [publish]);

  const run = useCallback(async (work: ImportWork, deliverInline = false): Promise<OutboundAttachmentInput[]> => {
    if (jobs.current.get(work.id) !== work || work.generation !== generation.current || !mounted.current) return [];
    const attempt = ++work.attempt;
    const controller = new AbortController();
    work.controller = controller;
    const current = () => mounted.current && work.generation === generation.current
      && jobs.current.get(work.id) === work && attempt === work.attempt;
    update(work.id, { status: 'preparing', progress: 0, error: null });
    try {
      let attachments: OutboundAttachmentInput[];
      if (work.source.kind === 'picker') {
        attachments = await invoke<OutboundAttachmentInput[]>(IPC.PickOutboundAttachments);
      } else if (work.source.kind === 'native') {
        const result = await importNativeDroppedAttachmentPaths([work.source.path]);
        if (result.failed) throw new Error(result.firstError || '无法读取拖入的附件，请重试。');
        attachments = result.attachments;
      } else {
        const { file } = work.source;
        const base64Data = await readAttachmentFile(file, controller.signal, percent => {
          if (current()) update(work.id, { progress: percent });
        });
        if (!current()) return [];
        update(work.id, { progress: 85 });
        const savedPath = await invoke<string>(IPC.SaveTempAttachment, { filename: file.name, base64Data });
        attachments = [{
          filename: file.name, mime_type: file.type || 'application/octet-stream',
          size_bytes: Math.min(file.size, Number.MAX_SAFE_INTEGER), local_path: savedPath,
          ...(work.inline ? { is_inline: true, content_id: `${work.id}-${attempt}-${Date.now().toString(36)}@better-email.local` } : {}),
        }];
      }
      if (!current()) return [];
      if (work.source.kind === 'picker') {
        if (work.recoveryFiles) {
          const remaining = work.recoveryFiles.filter(file => !(attachments.length && file.selection_unknown));
          const existing = optionsRef.current.getCurrentAttachments?.() ?? [];
          const regular: OutboundAttachmentInput[] = [];
          const images: OutboundAttachmentInput[] = [];
          for (const attachment of attachments) {
            const index = remaining.findIndex(file => file.filename === attachment.filename
              && (file.size_bytes === null || file.size_bytes === attachment.size_bytes));
            const recovered = index < 0 ? null : remaining.splice(index, 1)[0];
            if (existing.some(file => file.filename === attachment.filename && file.size_bytes === attachment.size_bytes)) continue;
            if (recovered?.is_inline) images.push({ ...attachment, is_inline: true,
              content_id: `${work.id}-${attempt}-${images.length}@better-email.local` });
            else regular.push(attachment);
          }
          if (regular.length) optionsRef.current.onAttachmentsReady(regular, '已重新添加附件');
          if (images.length) optionsRef.current.onInlineImagesReady(images);
          if (remaining.length) {
            work.recoveryFiles = remaining;
            update(work.id, recoveredImportPatch(remaining));
          } else {
            publish(itemsRef.current.filter(item => item.id !== work.id));
            jobs.current.delete(work.id);
          }
          return [...regular, ...images];
        }
        // A cancelled picker is not a failed file. Retrying its error reopens
        // the picker because the current IPC does not expose rejected paths.
        publish(itemsRef.current.filter(item => item.id !== work.id));
        if (attachments.length) {
          publish([...itemsRef.current, ...attachments.map(attachment => ({
            id: `attachment-import-${++nextId.current}`, filename: attachment.filename,
            sizeBytes: attachment.size_bytes, status: 'ready' as const, progress: 100,
            error: null, source: 'picker' as const, inline: false,
          }))]);
        }
      }
      if (attachments.length) {
        if (!work.inline) optionsRef.current.onAttachmentsReady(attachments, '已添加附件');
        else if (deliverInline) optionsRef.current.onInlineImagesReady(attachments);
      }
      if (work.source.kind !== 'picker') update(work.id, {
        status: 'ready', progress: 100, error: null, contentId: attachments[0]?.content_id,
      });
      jobs.current.delete(work.id);
      return attachments;
    } catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : String(error);
        update(work.id, { status: 'failed', progress: null, error: message });
        optionsRef.current.setStatus(`附件准备失败：${message}。可重试或移除失败项。`);
      }
      return [];
    } finally {
      if (attempt === work.attempt) work.controller = null;
    }
  }, [publish, update]);

  const processFiles = useCallback(async (files: FileList | File[], inline = false, deliverInline = false) => {
    if (!canStartImport()) return [];
    const session = generation.current;
    // Register the entire batch synchronously, before FileReader/IPC yields.
    // Completing one file cannot unlock send while another is still queued.
    const work = Array.from(files).map(file => register({ kind: 'file', file }, inline));
    const result: OutboundAttachmentInput[] = [];
    for (const job of work) result.push(...await run(job, deliverInline));
    if (inline && session !== generation.current) throw attachmentImportCancelled();
    return result;
  }, [canStartImport, register, run]);

  const processDroppedOrPastedFiles = useCallback(async (files: FileList | File[], _statusPrefix = '已添加附件') => {
    await processFiles(files);
  }, [processFiles]);
  const buildInlineImageAttachments = useCallback((files: File[]) => processFiles(files, true), [processFiles]);
  const pickDraftAttachments = useCallback(async () => {
    if (canStartImport()) await run(register({ kind: 'picker' }));
  }, [canStartImport, register, run]);
  const retryAttachmentImport = useCallback(async (id: string) => {
    const work = jobs.current.get(id);
    if (!work || itemsRef.current.find(item => item.id === id)?.status !== 'failed') return;
    if (!canStartImport()) return;
    await run(work, work.inline);
  }, [canStartImport, run]);
  const dismissAttachmentImport = useCallback((id: string) => {
    const work = jobs.current.get(id);
    jobs.current.delete(id);
    work?.controller?.abort();
    publish(itemsRef.current.filter(item => item.id !== id));
  }, [publish]);
  const getAttachmentSendBlockReason = useCallback(() => attachmentImportBlockReason(itemsRef.current), []);
  const restoreAttachmentImports = useCallback((value: unknown) => {
    const files = normalizePendingAttachments(value);
    if (!files.length) return;
    const work = register({ kind: 'picker' });
    work.recoveryFiles = files;
    update(work.id, recoveredImportPatch(files));
  }, [register, update]);

  useEffect(() => {
    if (!options.isComposerOpen) return undefined;
    let active = true;
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onDragDropEvent(event => {
      if (!active) return;
      if (event.type === 'enter' || event.type === 'over') { setComposerDropActive(true); return; }
      setComposerDropActive(false);
      if (event.type !== 'drop') return;
      if (!canStartImport()) return;
      const paths = [...new Set(event.paths.map(path => path.trim()).filter(Boolean))];
      if (!paths.length) { optionsRef.current.setStatus('拖拽内容中没有文件'); return; }
      const work = paths.map(path => register({ kind: 'native', path }));
      void (async () => { for (const job of work) await run(job); })();
    }).then(next => {
      if (active) unlisten = next;
      else next();
    }).catch(error => {
      if (active) optionsRef.current.setStatus(`附件拖拽不可用：${String(error)}`);
    });
    return () => { active = false; unlisten?.(); };
  }, [options.isComposerOpen, canStartImport, register, run]);

  function handleComposerAttachmentDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation(); setComposerDropActive(false);
    const files = event.dataTransfer.files;
    if (!files?.length) { optionsRef.current.setStatus('拖拽内容中没有文件'); return; }
    void processDroppedOrPastedFiles(files);
  }
  function handleComposerAttachmentPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files ?? []);
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation();
    const images = files.filter(file => file.type.startsWith('image/'));
    const others = files.filter(file => !file.type.startsWith('image/'));
    if (images.length) void processFiles(images, true, true).catch(() => undefined);
    if (others.length) void processDroppedOrPastedFiles(others);
  }
  function handleComposerAttachmentDragOver(event: React.DragEvent<HTMLElement>) {
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  }
  function handleComposerAttachmentDragEnter(event: React.DragEvent<HTMLElement>) {
    event.preventDefault(); setComposerDropActive(true);
  }
  function handleComposerAttachmentDragLeave(event: React.DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerDropActive(false);
  }

  return {
    attachmentImports,
    isImportingAttachments: attachmentImports.some(item => item.status === 'queued' || item.status === 'preparing'),
    retryAttachmentImport, dismissAttachmentImport, resetAttachmentImports, restoreAttachmentImports, getAttachmentSendBlockReason,
    isComposerDropActive, pickDraftAttachments, buildInlineImageAttachments, processDroppedOrPastedFiles,
    handleComposerAttachmentDrop, handleComposerAttachmentPaste, handleComposerAttachmentDragOver,
    handleComposerAttachmentDragEnter, handleComposerAttachmentDragLeave,
  };
}

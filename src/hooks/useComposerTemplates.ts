import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  loadTemplates,
  persistTemplates,
  saveTemplate,
  deleteTemplate,
  substituteTemplateVariables,
} from '../app/templateStore';
import type { ComposeTemplate, DraftInput } from '../app/types';

type ComposerTemplatesOptions = {
  draft: DraftInput;
  setDraft: Dispatch<SetStateAction<DraftInput>>;
  setRichComposer: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export default function useComposerTemplates({
  draft,
  setDraft,
  setRichComposer,
  setStatus,
}: ComposerTemplatesOptions) {
  const [composeTemplates, setComposeTemplates] = useState<ComposeTemplate[]>(loadTemplates);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    persistTemplates(composeTemplates);
  }, [composeTemplates]);

  const applyComposeTemplate = useCallback((template: ComposeTemplate) => {
    const contactEmail = draft.to
      .split(/[,;]/)
      .map((part) => part.trim())
      .find((part) => part.includes('@'))
      ?? '';
    const contactName = contactEmail.split('@')[0] || undefined;
    const context = {
      contactName,
      contactEmail: contactEmail || undefined,
    };
    const subjectResult = substituteTemplateVariables(template.subject, context);
    const bodyResult = substituteTemplateVariables(template.body, context);
    const htmlResult = substituteTemplateVariables(template.html_body, context);
    const notes: string[] = [];
    const next = { ...draft };
    const subject = subjectResult.resolved.trim();
    if (subject && !draft.subject.trim()) {
      next.subject = subject;
    } else if (subject) {
      notes.push('主题已保留');
    }
    const body = bodyResult.resolved.trim();
    if (body && !draft.body.trim()) {
      next.body = body;
    } else if (body && draft.body.trim() !== body) {
      next.body = `${draft.body.trimEnd()}\n\n—— 模板正文 ——\n${body}`;
    }
    const html = htmlResult.resolved.trim();
    if (html && !draft.html_body.trim()) {
      next.html_body = html;
    } else if (html && draft.html_body.trim() !== html) {
      next.html_body = `${draft.html_body.trimEnd()}\n${html}`;
    }
    setDraft(next);
    if (template.html_body.trim() || htmlResult.resolved.trim()) {
      setRichComposer(true);
    }
    const unresolved = [...subjectResult.unresolved, ...bodyResult.unresolved, ...htmlResult.unresolved];
    const hint = unresolved.length > 0
      ? `（未解析变量：${[...new Set(unresolved)].join('、')}）`
      : (notes.length > 0 ? `（${notes.join('；')}）` : '');
    setStatus(`已插入模板：${template.name}${hint}`);
  }, [draft, setDraft, setRichComposer, setStatus]);

  const saveDraftAsTemplate = useCallback(() => {
    const hasContent = draft.subject.trim() || draft.body.trim() || draft.html_body.trim();
    if (!hasContent) {
      setStatus('请先填写主题或正文后再保存模板');
      return;
    }
    const name = templateName.trim() || draft.subject.trim() || '未命名模板';
    const nextTemplate = saveTemplate({
      id: crypto.randomUUID(),
      name,
      subject: draft.subject,
      body: draft.body,
      html_body: draft.html_body,
      category: '',
      tags: [],
      account_id: draft.account_id,
      is_favorite: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setComposeTemplates(nextTemplate);
    setTemplateName('');
    setStatus(`模板已保存：${name}`);
  }, [draft, templateName, setStatus]);

  const deleteComposeTemplate = useCallback((template: ComposeTemplate) => {
    setComposeTemplates(deleteTemplate(template.id));
    setStatus(`模板已删除：${template.name}`);
  }, [setStatus]);

  return {
    composeTemplates,
    setComposeTemplates,
    templateName,
    setTemplateName,
    applyComposeTemplate,
    saveDraftAsTemplate,
    deleteComposeTemplate,
  };
}

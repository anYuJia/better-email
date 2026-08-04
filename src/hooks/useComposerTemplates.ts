import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  loadComposeTemplates,
  composeTemplatesStorageKey,
} from '../app/appConfig';
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
  const [composeTemplates, setComposeTemplates] = useState<ComposeTemplate[]>(loadComposeTemplates);
  const [templateName, setTemplateName] = useState('');

  useEffect(() => {
    window.localStorage.setItem(composeTemplatesStorageKey, JSON.stringify(composeTemplates));
  }, [composeTemplates]);

  const applyComposeTemplate = useCallback((template: ComposeTemplate) => {
    setDraft((current) => ({
      ...current,
      subject: template.subject,
      body: template.body,
      html_body: template.html_body,
    }));
    if (template.html_body.trim()) {
      setRichComposer(true);
    }
    setStatus(`已插入模板：${template.name}`);
  }, [setDraft, setRichComposer, setStatus]);

  const saveDraftAsTemplate = useCallback(() => {
    const hasContent = draft.subject.trim() || draft.body.trim() || draft.html_body.trim();
    if (!hasContent) {
      setStatus('请先填写主题或正文后再保存模板');
      return;
    }
    const name = templateName.trim() || draft.subject.trim() || '未命名模板';
    const nextTemplate: ComposeTemplate = {
      id: crypto.randomUUID(),
      name,
      subject: draft.subject,
      body: draft.body,
      html_body: draft.html_body,
    };
    setComposeTemplates((current) => [nextTemplate, ...current.filter((item) => item.name !== name)].slice(0, 12));
    setTemplateName('');
    setStatus(`模板已保存：${name}`);
  }, [draft, templateName, setStatus]);

  const deleteComposeTemplate = useCallback((template: ComposeTemplate) => {
    setComposeTemplates((current) => current.filter((item) => item.id !== template.id));
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

import { useLayoutEffect, useRef, useState } from 'react';
import { Loader2, MessageSquareText, Sparkles, WandSparkles, X } from 'lucide-react';
import type { Message } from '../../app/types';
import { aiErrorMessage, generateTemplate, summarizeMessage } from '../../app/aiService';
import type { AiRequestError } from '../../app/types/ai';
import {
  buildAiReplyPrompt,
  normalizeGeneratedReply,
  readerAiSource,
} from '../../app/aiContextActions';
import { useDetailsMenu } from '../../hooks/useDetailsMenu';
import { useWheelContainment } from '../../hooks/useWheelContainment';
import { ContextMenuContent, type ContextMenuItem } from '../ContextMenu';

type ReaderAiContextActionsProps = {
  message: Message;
  onComposeFromMessage: (message: Message, mode: 'reply' | 'replyAll' | 'forward', prefillBody?: string) => void;
};

type AiBusyAction = 'summary' | 'reply' | null;
type AiResultState = { messageKey: string; busyAction: AiBusyAction; summary: string; error: string };

export default function ReaderAiContextActions({
  message,
  onComposeFromMessage,
}: ReaderAiContextActionsProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const messageKey = `${message.account_id}:${message.id}`;
  const requestGeneration = useRef(0);
  const requestPending = useRef(false);
  const [result, setResult] = useState<AiResultState>({ messageKey, busyAction: null, summary: '', error: '' });
  const { busyAction, summary, error } = result.messageKey === messageKey
    ? result : { busyAction: null, summary: '', error: '' };
  useLayoutEffect(() => {
    requestGeneration.current += 1;
    requestPending.current = false;
    setResult({ messageKey, busyAction: null, summary: '', error: '' });
    return () => { requestGeneration.current += 1; };
  }, [messageKey]);
  const menu = useDetailsMenu(menuRef, { floating: true });
  useWheelContainment(resultRef, Boolean(summary || error));

  function updateResult(patch: Partial<Omit<AiResultState, 'messageKey'>>) {
    setResult((current) => ({ ...current, ...patch }));
  }

  function beginRequest(action: AiBusyAction) {
    if (requestPending.current) return null;
    requestPending.current = true;
    const generation = ++requestGeneration.current;
    updateResult({ busyAction: action, error: '' });
    return () => requestGeneration.current === generation;
  }

  function finishRequest(isCurrent: () => boolean) {
    if (!isCurrent()) return;
    requestPending.current = false;
    updateResult({ busyAction: null });
  }

  async function summarize() {
    const isCurrent = beginRequest('summary');
    if (!isCurrent) return;
    try {
      const source = readerAiSource(message);
      if (!source.trim()) {
        updateResult({ error: '当前邮件正文尚未加载，暂时无法总结。' });
        return;
      }
      const result = await summarizeMessage(source);
      if (!isCurrent()) return;
      updateResult({ summary: result.content.trim() });
      menu.closeMenu();
    } catch (caught) {
      if (!isCurrent()) return;
      updateResult({ error: aiErrorMessage(caught as AiRequestError) });
      menu.closeMenu();
    } finally {
      finishRequest(isCurrent);
    }
  }

  async function generateReply() {
    const isCurrent = beginRequest('reply');
    if (!isCurrent) return;
    try {
      const result = await generateTemplate(buildAiReplyPrompt(message));
      if (!isCurrent()) return;
      const body = normalizeGeneratedReply(result.content, message);
      if (!body) {
        updateResult({ error: 'AI 未生成有效回复正文，请重试。' });
        return;
      }
      menu.closeMenu();
      onComposeFromMessage(message, 'reply', body);
    } catch (caught) {
      if (!isCurrent()) return;
      updateResult({ error: aiErrorMessage(caught as AiRequestError) });
      menu.closeMenu();
    } finally {
      finishRequest(isCurrent);
    }
  }

  const menuItems: ContextMenuItem[] = [
    {
      id: 'ai-summary',
      label: '总结邮件',
      icon: busyAction === 'summary'
        ? <Loader2 size={16} className="reader-translation-spinner" />
        : <MessageSquareText size={16} />,
      disabled: Boolean(busyAction),
      onSelect: () => void summarize(),
    },
    {
      id: 'ai-reply',
      label: '生成回复',
      icon: busyAction === 'reply'
        ? <Loader2 size={16} className="reader-translation-spinner" />
        : <WandSparkles size={16} />,
      disabled: Boolean(busyAction),
      onSelect: () => void generateReply(),
    },
  ];

  return (
    <div className="reader-ai-context">
      <details
        ref={menuRef}
        className="reader-ai-menu compact-menu"
        data-floating-menu="true"
      >
        <summary
          className="reader-ai-trigger"
          aria-label="AI 邮件工具"
          aria-haspopup="menu"
          title="AI 邮件工具"
        >
          <Sparkles size={18} aria-hidden="true" />
          <span>AI</span>
        </summary>
        <div
          className="context-menu-surface context-menu--anchored reader-ai-menu-panel"
          data-floating-menu-panel="true"
        >
          <ContextMenuContent
            items={menuItems}
            onClose={menu.closeMenu}
            ariaLabel="AI 邮件工具"
            title="AI 工具"
            note="外部 AI 遵循隐私确认设置"
          />
        </div>
      </details>

      {(summary || error) && (
        <aside
          ref={resultRef}
          className={`reader-ai-result${error ? ' is-error' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div>
            <Sparkles size={16} aria-hidden="true" />
            <strong>{error ? 'AI 暂不可用' : 'AI 摘要'}</strong>
          </div>
          <p>{error || summary}</p>
          <button
            type="button"
            aria-label="关闭 AI 结果"
            title="关闭"
            onClick={() => {
              updateResult({ summary: '', error: '' });
            }}
          >
            <X size={16} />
          </button>
        </aside>
      )}
    </div>
  );
}

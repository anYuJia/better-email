import { useRef, useState } from 'react';
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

export default function ReaderAiContextActions({
  message,
  onComposeFromMessage,
}: ReaderAiContextActionsProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const [busyAction, setBusyAction] = useState<AiBusyAction>(null);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const menu = useDetailsMenu(menuRef, { floating: true });
  useWheelContainment(resultRef, Boolean(summary || error));

  async function summarize() {
    if (busyAction) return;
    setBusyAction('summary');
    setError('');
    try {
      const source = readerAiSource(message);
      if (!source.trim()) {
        setError('当前邮件正文尚未加载，暂时无法总结。');
        return;
      }
      const result = await summarizeMessage(source);
      setSummary(result.content.trim());
      menu.closeMenu();
    } catch (caught) {
      setError(aiErrorMessage(caught as AiRequestError));
      menu.closeMenu();
    } finally {
      setBusyAction(null);
    }
  }

  async function generateReply() {
    if (busyAction) return;
    setBusyAction('reply');
    setError('');
    try {
      const result = await generateTemplate(buildAiReplyPrompt(message));
      const body = normalizeGeneratedReply(result.content, message);
      if (!body) {
        setError('AI 未生成有效回复正文，请重试。');
        return;
      }
      menu.closeMenu();
      onComposeFromMessage(message, 'reply', body);
    } catch (caught) {
      setError(aiErrorMessage(caught as AiRequestError));
      menu.closeMenu();
    } finally {
      setBusyAction(null);
    }
  }

  const menuItems: ContextMenuItem[] = [
    {
      id: 'ai-summary',
      label: '总结邮件',
      icon: busyAction === 'summary'
        ? <Loader2 size={15} className="reader-translation-spinner" />
        : <MessageSquareText size={15} />,
      disabled: Boolean(busyAction),
      onSelect: () => void summarize(),
    },
    {
      id: 'ai-reply',
      label: '生成回复',
      icon: busyAction === 'reply'
        ? <Loader2 size={15} className="reader-translation-spinner" />
        : <WandSparkles size={15} />,
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
          <Sparkles size={15} aria-hidden="true" />
          <span>AI</span>
        </summary>
        <div className="context-menu-surface context-menu--anchored reader-ai-menu-panel">
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
            <Sparkles size={14} aria-hidden="true" />
            <strong>{error ? 'AI 暂不可用' : 'AI 摘要'}</strong>
          </div>
          <p>{error || summary}</p>
          <button
            type="button"
            aria-label="关闭 AI 结果"
            title="关闭"
            onClick={() => {
              setSummary('');
              setError('');
            }}
          >
            <X size={14} />
          </button>
        </aside>
      )}
    </div>
  );
}

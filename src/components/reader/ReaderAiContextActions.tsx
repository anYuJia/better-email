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
  const [busyAction, setBusyAction] = useState<AiBusyAction>(null);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');

  function closeMenu() {
    menuRef.current?.removeAttribute('open');
  }

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
      closeMenu();
    } catch (caught) {
      setError(aiErrorMessage(caught as AiRequestError));
      closeMenu();
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
      closeMenu();
      onComposeFromMessage(message, 'reply', body);
    } catch (caught) {
      setError(aiErrorMessage(caught as AiRequestError));
      closeMenu();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="reader-ai-context">
      <details ref={menuRef} className="reader-ai-menu compact-menu">
        <summary className="reader-ai-trigger" aria-label="AI 邮件工具" title="AI 邮件工具">
          <Sparkles size={15} aria-hidden="true" />
          <span>AI</span>
        </summary>
        <div role="menu" aria-label="AI 邮件工具">
          <button type="button" role="menuitem" onClick={() => void summarize()} disabled={Boolean(busyAction)}>
            {busyAction === 'summary' ? <Loader2 size={15} className="reader-translation-spinner" /> : <MessageSquareText size={15} />}
            总结邮件
          </button>
          <button type="button" role="menuitem" onClick={() => void generateReply()} disabled={Boolean(busyAction)}>
            {busyAction === 'reply' ? <Loader2 size={15} className="reader-translation-spinner" /> : <WandSparkles size={15} />}
            生成回复
          </button>
          <span className="reader-ai-privacy-note">外部 AI 仍遵循设置中的隐私确认</span>
        </div>
      </details>

      {(summary || error) && (
        <aside className={`reader-ai-result${error ? ' is-error' : ''}`} role="status" aria-live="polite">
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

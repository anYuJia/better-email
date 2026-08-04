import { Languages, Loader2, RefreshCw, XCircle } from 'lucide-react';
import type { MessageTranslationState } from '../../hooks/useMessageTranslation';
import './reader-translation.css';

type ReaderTranslationPanelProps = {
  state: MessageTranslationState;
  needsTranslation: boolean;
  onTranslate: () => void;
  onToggle: () => void;
};

export default function ReaderTranslationPanel({
  state,
  needsTranslation,
  onTranslate,
  onToggle,
}: ReaderTranslationPanelProps) {
  if (!needsTranslation && state.status === 'idle') return null;
  return (
    <div className="reader-translation-panel" data-translation-state={state.status}>
      {state.status === 'translating' && (
        <div className="reader-translation-banner">
          <Loader2 size={14} className="reader-translation-spinner" />
          <span>正在翻译为中文…</span>
        </div>
      )}
      {state.status === 'failed' && (
        <div className="reader-translation-banner failed">
          <XCircle size={14} />
          <span>{state.error || '翻译失败，请稍后重试。'}</span>
          <button type="button" onClick={onTranslate} title="重试">
            <RefreshCw size={13} /> 重试
          </button>
        </div>
      )}
      {state.status === 'success' && state.showTranslation && (
        <div className="reader-translation-content">
          <div className="reader-translation-header">
            <span><Languages size={13} /> 中文译文</span>
            <button type="button" onClick={onToggle}>查看原文</button>
          </div>
          <pre className="reader-translation-text">{state.translation}</pre>
        </div>
      )}
      {state.status === 'success' && !state.showTranslation && (
        <div className="reader-translation-banner">
          <span>已翻译为中文</span>
          <button type="button" onClick={onToggle}>显示译文</button>
        </div>
      )}
      {state.status === 'idle' && needsTranslation && (
        <div className="reader-translation-banner">
          <span>检测到外语邮件</span>
          <button type="button" className="reader-translate-action" onClick={onTranslate}>
            <Languages size={13} /> 翻译为中文
          </button>
        </div>
      )}
    </div>
  );
}

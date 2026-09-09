import { Languages, Loader2 } from 'lucide-react';
import type { MessageTranslationState } from '../../hooks/useMessageTranslation';

type ReaderTranslationPanelProps = {
  state: MessageTranslationState;
  needsTranslation: boolean;
  onToggle: () => void;
};

export default function ReaderTranslationPanel({
  state,
  needsTranslation,
  onToggle,
}: ReaderTranslationPanelProps) {
  // Translation failures are delivered through the app-wide toast. The
  // reader stays focused on the message, while the toolbar remains available
  // for retrying the operation.
  if (state.status === 'failed' || (!needsTranslation && state.status === 'idle')) return null;
  return (
    <div className="reader-translation-panel" data-translation-state={state.status}>
      {state.status === 'translating' && (
        <div className="reader-translation-banner">
          <Loader2 size={14} className="reader-translation-spinner" />
          <span>正在翻译为中文…</span>
        </div>
      )}
      {state.status === 'success' && state.showTranslation && (
        <div className="reader-translation-banner">
          <span><Languages size={13} /> 正在显示中文译文</span>
          <button type="button" onClick={onToggle}>查看原文</button>
        </div>
      )}
      {state.status === 'success' && !state.showTranslation && (
        <div className="reader-translation-banner">
          <span>已翻译为中文</span>
          <button type="button" onClick={onToggle}>显示译文</button>
        </div>
      )}
    </div>
  );
}

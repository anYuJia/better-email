import React from 'react';
import type { MessageSummary } from '../app/types';
import { messageMatchesLocalDateTimeRange, type LocalDateTimeRange } from '../mailUtils';
import MessageDateRangePicker from './MessageDateRangePicker';

type MessageSelectionControlsProps = {
  compact?: boolean;
  messages: MessageSummary[];
  selectedMessageIds: number[];
  hasMoreMessages: boolean;
  isAllMessagesSelected?: boolean;
  isSelectingAll?: boolean;
  isSelectingMessageGroup?: boolean;
  loading?: boolean;
  onToggleAllVisible: (checked: boolean) => void;
  onToggleMessageSelection: (messageId: number, checked: boolean) => void;
  onSelectMessageDateRange?: (range: LocalDateTimeRange) => void;
};

/** The same selection contract is shared by the desktop toolbar and touch selection row. */
export default function MessageSelectionControls({
  compact = false,
  messages,
  selectedMessageIds,
  hasMoreMessages,
  isAllMessagesSelected = false,
  isSelectingAll = false,
  isSelectingMessageGroup = false,
  loading = false,
  onToggleAllVisible,
  onToggleMessageSelection,
  onSelectMessageDateRange,
}: MessageSelectionControlsProps) {
  const checkboxRef = React.useRef<HTMLInputElement>(null);
  const allSelected = React.useMemo(() => {
    if (isAllMessagesSelected) return true;
    if (hasMoreMessages || messages.length === 0 || selectedMessageIds.length !== messages.length) return false;
    const selected = new Set(selectedMessageIds);
    return messages.every((message) => selected.has(message.id));
  }, [hasMoreMessages, isAllMessagesSelected, messages, selectedMessageIds]);
  const mixed = selectedMessageIds.length > 0 && !allSelected;
  React.useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = mixed;
  }, [mixed]);

  const handleDateRangeConfirm = React.useCallback((range: LocalDateTimeRange) => {
    if (onSelectMessageDateRange) {
      onSelectMessageDateRange(range);
      return;
    }
    messages.forEach((message) => onToggleMessageSelection(
      message.id,
      messageMatchesLocalDateTimeRange(message.received_at, range),
    ));
  }, [messages, onSelectMessageDateRange, onToggleMessageSelection]);
  const busy = isSelectingAll || isSelectingMessageGroup;
  const disabled = loading || busy || messages.length === 0;

  return (
    <div className={compact ? 'message-selection-controls' : 'message-selection-strip'} aria-label="邮件批量选择操作">
      <label className="message-selection-all" title="选择当前筛选结果中的全部邮件">
        <input
          ref={checkboxRef}
          type="checkbox"
          aria-label="选择当前筛选结果中的全部邮件"
          aria-checked={mixed ? 'mixed' : allSelected}
          checked={allSelected}
          disabled={disabled}
          onChange={(event) => onToggleAllVisible(event.target.checked)}
        />
        <span className={compact ? 'sr-only' : 'message-selection-all-label'}>全选</span>
      </label>
      {(!compact || selectedMessageIds.length === 0) && (
        <MessageDateRangePicker onConfirm={handleDateRangeConfirm} disabled={disabled} iconOnly={compact} />
      )}
      <span className={compact ? 'sr-only' : 'message-selection-strip-summary'} aria-live="polite" aria-busy={busy}>
        {isSelectingAll ? '正在选择全部邮件…' : isSelectingMessageGroup ? '正在读取完整结果…'
          : selectedMessageIds.length > 0 ? `已选 ${selectedMessageIds.length} 封` : ''}
      </span>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { MessageSummary } from '../app/types';
import { messageDateGroup, messageMatchesLocalDateTimeRange, type LocalDateTimeRange } from '../mailUtils';

type SelectionSetter = Dispatch<SetStateAction<number[]>>;
type LoadAllMessages = () => Promise<MessageSummary[]>;
type SelectionMode = 'none' | 'partial' | 'all';

export default function useMessageSelectionControls(
  messages: MessageSummary[],
  setSelectedMessageIds: SelectionSetter,
  setStatus: Dispatch<SetStateAction<string>>,
  loadAllMessages?: LoadAllMessages,
  mailboxRefreshRef?: MutableRefObject<number>,
  selectedMessageIds: number[] = [],
  selectionContextKey = '',
  setSelectingAll?: Dispatch<SetStateAction<boolean>>,
) {
  const dateRangeRequestRef = useRef(0);
  const groupRequestRef = useRef(0);
  const groupBusyRef = useRef(false);
  const dateRangeBusyRef = useRef(false);
  const [groupSyncBusy, setGroupSyncBusy] = useState(false);
  const [dateRangeBusy, setDateRangeBusy] = useState(false);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('none');
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const messageSnapshotRef = useRef(new Map<number, MessageSummary>());
  const selectionContextRef = useRef(selectionContextKey);
  const previousSelectedCountRef = useRef(selectedMessageIds.length);
  const selectAllRequestRef = useRef(0);

  useEffect(() => {
    messages.forEach((message) => messageSnapshotRef.current.set(message.id, message));
  }, [messages]);

  useEffect(() => {
    if (selectionContextRef.current === selectionContextKey) return;
    selectionContextRef.current = selectionContextKey;
    messageSnapshotRef.current.clear();
    setSnapshotRevision((current) => current + 1);
    setSelectionMode('none');
    if (selectedMessageIds.length > 0) setSelectedMessageIds([]);
  }, [selectedMessageIds.length, selectionContextKey, setSelectedMessageIds]);

  useEffect(() => {
    const hadSelectedMessages = previousSelectedCountRef.current > 0;
    previousSelectedCountRef.current = selectedMessageIds.length;
    if (selectedMessageIds.length === 0 && hadSelectedMessages && selectionMode !== 'none') {
      messageSnapshotRef.current.clear();
      setSnapshotRevision((current) => current + 1);
      setSelectionMode('none');
    }
  }, [selectedMessageIds.length, selectionMode]);

  const rememberMessages = useCallback((sourceMessages: MessageSummary[]) => {
    let changed = false;
    sourceMessages.forEach((message) => {
      if (messageSnapshotRef.current.get(message.id) !== message) {
        messageSnapshotRef.current.set(message.id, message);
        changed = true;
      }
    });
    if (changed) setSnapshotRevision((current) => current + 1);
  }, []);

  const selectedMessages = useMemo(() => {
    const visibleById = new Map(messages.map((message) => [message.id, message]));
    const seen = new Set<number>();
    // Snapshot entries are written synchronously by rememberMessages before
    // selected ids are committed, so off-page selections remain actionable.
    return selectedMessageIds.flatMap((id) => {
      if (seen.has(id)) return [];
      seen.add(id);
      const message = messageSnapshotRef.current.get(id) ?? visibleById.get(id);
      return message ? [message] : [];
    });
  }, [messages, selectedMessageIds, snapshotRevision]);

  const clearSelection = useCallback(() => {
    messageSnapshotRef.current.clear();
    setSnapshotRevision((current) => current + 1);
    setSelectionMode('none');
    setSelectedMessageIds([]);
  }, [setSelectedMessageIds]);

  const markPartialSelection = useCallback((sourceMessages: MessageSummary[] = []) => {
    rememberMessages(sourceMessages);
    setSelectionMode('partial');
  }, [rememberMessages]);

  const markAllSelected = useCallback((sourceMessages: MessageSummary[]) => {
    rememberMessages(sourceMessages);
    setSelectionMode('all');
  }, [rememberMessages]);

  const toggleMessageSelection = useCallback((messageId: number, checked: boolean) => {
    if (checked) {
      const message = messages.find((item) => item.id === messageId);
      if (message) rememberMessages([message]);
    }
    markPartialSelection();
    setSelectedMessageIds((current) => {
      if (checked) return current.includes(messageId) ? current : [...current, messageId];
      return current.filter((id) => id !== messageId);
    });
  }, [markPartialSelection, messages, rememberMessages, setSelectedMessageIds]);

  const toggleAllMessages = useCallback(async (checked: boolean): Promise<number | null> => {
    const requestId = selectAllRequestRef.current + 1;
    selectAllRequestRef.current = requestId;
    if (!checked) {
      clearSelection();
      setSelectingAll?.(false);
      return null;
    }

    const refreshId = mailboxRefreshRef?.current;
    setSelectingAll?.(true);
    try {
      const allMessages = loadAllMessages ? await loadAllMessages() : messages;
      if (
        requestId !== selectAllRequestRef.current
        || (refreshId !== undefined && refreshId !== mailboxRefreshRef?.current)
      ) return null;
      const selectedIds = [...new Set(allMessages.map((message) => message.id))];
      markAllSelected(allMessages);
      setSelectedMessageIds(selectedIds);
      setStatus(`已选择 ${selectedIds.length} 封邮件`);
      return selectedIds.length;
    } catch (error) {
      if (requestId === selectAllRequestRef.current) setStatus(String(error));
      return null;
    } finally {
      if (requestId === selectAllRequestRef.current) setSelectingAll?.(false);
    }
  }, [clearSelection, loadAllMessages, mailboxRefreshRef, markAllSelected, messages, setSelectingAll, setSelectedMessageIds, setStatus]);

  const toggleMessageGroup = useCallback(async (groupId: string, visibleMessageIds: number[], checked: boolean) => {
    if (groupBusyRef.current || dateRangeBusyRef.current) return;
    groupBusyRef.current = true;
    setGroupSyncBusy(true);
    const requestId = groupRequestRef.current + 1;
    groupRequestRef.current = requestId;
    const startedRefreshId = mailboxRefreshRef?.current;
    try {
      const sourceMessages = loadAllMessages ? await loadAllMessages() : messages;
      if (
        requestId !== groupRequestRef.current
        || (startedRefreshId !== undefined && startedRefreshId !== mailboxRefreshRef?.current)
      ) return;
      const matchingIds = sourceMessages
        .filter((message) => groupId === 'all' || messageDateGroup(message.received_at).id === groupId)
        .map((message) => message.id);
      // A fallback keeps the component useful with callers that do not supply
      // an all-results loader (for example isolated component previews). Do
      // not use it merely because the complete result has no matching rows:
      // an empty group must remain empty rather than selecting visible rows.
      const selectedGroupIds = loadAllMessages ? matchingIds : visibleMessageIds;
      const groupIds = new Set(selectedGroupIds);
      rememberMessages(sourceMessages);
      setSelectionMode('partial');
      setSelectedMessageIds((current) => {
        const withoutGroup = current.filter((id) => !groupIds.has(id));
        return checked ? [...new Set([...withoutGroup, ...selectedGroupIds])] : withoutGroup;
      });
    } catch (error) {
      if (requestId === groupRequestRef.current) setStatus(String(error));
    } finally {
      if (requestId === groupRequestRef.current) {
        groupBusyRef.current = false;
        setGroupSyncBusy(false);
      }
    }
  }, [loadAllMessages, mailboxRefreshRef, messages, rememberMessages, setSelectedMessageIds, setStatus]);

  const selectMessagesByDateRange = useCallback(async (range: LocalDateTimeRange) => {
    if (groupBusyRef.current || dateRangeBusyRef.current) return;
    dateRangeBusyRef.current = true;
    setDateRangeBusy(true);
    const requestId = dateRangeRequestRef.current + 1;
    dateRangeRequestRef.current = requestId;
    const startedRefreshId = mailboxRefreshRef?.current;
    try {
      const sourceMessages = loadAllMessages ? await loadAllMessages() : messages;
      // A scope/search/folder change invalidates the in-flight result. Do not
      // let a slow range query select ids in the newly displayed mailbox.
      if (
        requestId !== dateRangeRequestRef.current
        || (startedRefreshId !== undefined && startedRefreshId !== mailboxRefreshRef?.current)
      ) return;
      rememberMessages(sourceMessages);
      setSelectionMode('partial');
      const matchingIds = [...new Set(sourceMessages
        .filter((message) => messageMatchesLocalDateTimeRange(message.received_at, range))
        .map((message) => message.id))];
      setSelectedMessageIds(matchingIds);
      setStatus(`已按日期范围选择 ${matchingIds.length} 封邮件：${range.startDate} ${range.startTime} 至 ${range.endDate} ${range.endTime}`);
    } catch (error) {
      if (requestId === dateRangeRequestRef.current) setStatus(String(error));
    } finally {
      if (requestId === dateRangeRequestRef.current) {
        dateRangeBusyRef.current = false;
        setDateRangeBusy(false);
      }
    }
  }, [loadAllMessages, mailboxRefreshRef, messages, rememberMessages, setSelectedMessageIds, setStatus]);

  return {
    toggleGroup: toggleMessageGroup,
    // The shared busy flag also covers date-range loading so the two
    // full-result selection operations cannot overwrite one another.
    groupSyncBusy: groupSyncBusy || dateRangeBusy,
    selectDateRange: selectMessagesByDateRange,
    selectedMessages,
    rememberMessages,
    markAllSelected,
    markPartialSelection,
    clearSelection,
    toggleMessageSelection,
    toggleAllMessages,
    isAllMessagesSelected: selectionMode === 'all' && selectedMessageIds.length > 0,
  };
}

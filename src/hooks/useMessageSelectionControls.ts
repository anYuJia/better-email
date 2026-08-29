import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { MessageSummary } from '../app/types';
import { messageDateGroup, messageMatchesLocalDateTimeRange, type LocalDateTimeRange } from '../mailUtils';

type SelectionSetter = Dispatch<SetStateAction<number[]>>;
type LoadAllMessages = () => Promise<MessageSummary[]>;

export default function useMessageSelectionControls(
  messages: MessageSummary[],
  setSelectedMessageIds: SelectionSetter,
  setStatus: Dispatch<SetStateAction<string>>,
  loadAllMessages?: LoadAllMessages,
  mailboxRefreshRef?: MutableRefObject<number>,
) {
  const dateRangeRequestRef = useRef(0);
  const groupRequestRef = useRef(0);
  const groupBusyRef = useRef(false);
  const dateRangeBusyRef = useRef(false);
  const [groupSyncBusy, setGroupSyncBusy] = useState(false);
  const [dateRangeBusy, setDateRangeBusy] = useState(false);

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
  }, [loadAllMessages, mailboxRefreshRef, messages, setSelectedMessageIds, setStatus]);

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
      setSelectedMessageIds(sourceMessages
        .filter((message) => messageMatchesLocalDateTimeRange(message.received_at, range))
        .map((message) => message.id));
      setStatus(`已按日期范围选择邮件：${range.startDate} ${range.startTime} 至 ${range.endDate} ${range.endTime}`);
    } catch (error) {
      if (requestId === dateRangeRequestRef.current) setStatus(String(error));
    } finally {
      if (requestId === dateRangeRequestRef.current) {
        dateRangeBusyRef.current = false;
        setDateRangeBusy(false);
      }
    }
  }, [loadAllMessages, mailboxRefreshRef, messages, setSelectedMessageIds, setStatus]);

  return {
    toggleGroup: toggleMessageGroup,
    // The shared busy flag also covers date-range loading so the two
    // full-result selection operations cannot overwrite one another.
    groupSyncBusy: groupSyncBusy || dateRangeBusy,
    selectDateRange: selectMessagesByDateRange,
  };
}

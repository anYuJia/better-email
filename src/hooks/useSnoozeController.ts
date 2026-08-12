import { useState, type Dispatch, type SetStateAction } from 'react';
import { canSnoozeRole } from '../app/snooze';
import type {
  Message,
  MessageSummary,
  ThreadSummary,
  UndoMessageSnapshot,
} from '../app/types';
import { formatDate } from '../mailUtils';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

export type SnoozeTarget = {
  messages: MessageSummary[];
  label: string;
};

type SnoozeControllerOptions = {
  selected: MessageSummary | null;
  selectedId: number | null;
  threadMessages: MessageSummary[];
  snapshotMessages: (messages: MessageSummary[]) => UndoMessageSnapshot[];
  setSelectedId: Dispatch<SetStateAction<number | null>>;
  setSelectedMessageIds: Dispatch<SetStateAction<number[]>>;
  setActiveThread: Dispatch<SetStateAction<ThreadSummary | null>>;
  setThreadMessages: Dispatch<SetStateAction<MessageSummary[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
  clearSelectedDetailIf: (messageId: number) => void;
  invalidateSelectedDetail: (messageId: number) => void;
  refreshAll: () => Promise<void>;
  queueUndoAction: (
    title: string,
    snapshots: UndoMessageSnapshot[],
    detail?: string,
  ) => void;
};

export default function useSnoozeController({
  selected,
  selectedId,
  threadMessages,
  snapshotMessages,
  setSelectedId,
  setSelectedMessageIds,
  setActiveThread,
  setThreadMessages,
  setStatus,
  clearSelectedDetailIf,
  invalidateSelectedDetail,
  refreshAll,
  queueUndoAction,
}: SnoozeControllerOptions) {
  const [snoozeTarget, setSnoozeTarget] = useState<SnoozeTarget | null>(null);

  function requestSnooze(items: MessageSummary[]) {
    const targetMessages = [...new Map(
      items
          .filter((message) => canSnoozeRole(message.folder_role))
          .map((message) => [message.id, message]),
    ).values()];
    if (targetMessages.length === 0) {
      setStatus('所选邮件无法稍后处理');
      return;
    }
    setSnoozeTarget({
      messages: targetMessages,
      label: targetMessages.length === 1
          ? targetMessages[0].subject || '(无主题)'
          : `${targetMessages.length} 封邮件`,
    });
  }

  async function confirmSnooze(snoozedUntil: string) {
    const target = snoozeTarget;
    const timestamp = Date.parse(snoozedUntil);
    if (!target || Number.isNaN(timestamp) || timestamp <= Date.now()) {
      setStatus('请选择一个晚于当前时间的稍后处理时间');
      return;
    }

    const undoSnapshots = snapshotMessages(target.messages);
    const messageIds = target.messages.map((message) => message.id);
    // 批量命令在单个数据库事务内处理全部目标：要么全部稍后处理，要么全部不生效。
    // 失败时不做任何选择清除、不登记撤销，也不显示“全部已稍后处理”。
    try {
      await invoke<Message[]>(IPC.SnoozeMessages, { messageIds, snoozedUntil });
    } catch (error) {
      setStatus(`稍后处理失败，未做任何更改：${String(error)}`);
      return;
    }

    // 后端已成功：立即登记撤销并清空选择，绝不因本地刷新失败而丢失撤销入口。
    const count = target.messages.length;
    const targetIds = new Set(target.messages.map((message) => message.id));
    setSnoozeTarget(null);
    setSelectedMessageIds((current) => current.filter((messageId) => !targetIds.has(messageId)));
    if (selectedId !== null && targetIds.has(selectedId)) {
      clearSelectedDetailIf(selectedId);
      setSelectedId(null);
    }
    for (const messageId of targetIds) {
      invalidateSelectedDetail(messageId);
    }
    if (threadMessages.some((message) => targetIds.has(message.id))) {
      setActiveThread(null);
      setThreadMessages([]);
    }
    queueUndoAction('稍后处理', undoSnapshots, count > 1 ? `${count} 封邮件` : undefined);

    // 本地视图刷新失败不能把已成功的稍后处理说成“未做任何更改”，也不能产生
    // 未处理的 Promise rejection；撤销保持可操作。
    try {
      await refreshAll();
      setStatus(
        count === 1
          ? `已稍后处理到 ${formatDate(snoozedUntil)}`
          : `已将 ${count} 封邮件稍后处理到 ${formatDate(snoozedUntil)}`,
      );
    } catch (error) {
      setStatus(`已稍后处理，但本地列表刷新失败：${String(error)}`);
    }
  }

  function snoozeSelected() {
    if (!selected) return;
    requestSnooze([selected]);
  }

  return {
    snoozeTarget,
    setSnoozeTarget,
    requestSnooze,
    confirmSnooze,
    snoozeSelected,
  };
}

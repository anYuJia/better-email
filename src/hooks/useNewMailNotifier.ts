import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { MessageSummary, SyncRun } from '../app/types';
import type { NotificationPolicy } from '../mailUtils';
import {
  newMailNotificationDecision,
  notificationThreadScopeKey,
} from '../mailUtils';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '../tauriBridge';
import { invoke } from '../tauriBridge';
import { IPC } from '../ipc/commands';

type NewMailNotifierOptions = {
  notificationPolicy: NotificationPolicy;
  getCurrentMessages: () => MessageSummary[];
  setLastNewMailNotice: Dispatch<SetStateAction<string | null>>;
  setNotificationStatus: Dispatch<SetStateAction<string>>;
};

export default function useNewMailNotifier({
  notificationPolicy,
  getCurrentMessages,
  setLastNewMailNotice,
  setNotificationStatus,
}: NewMailNotifierOptions) {
  const notifyNewMail = useCallback(async (run: SyncRun, latestMessages?: MessageSummary[]) => {
    // 通知候选优先使用本次同步真正新增的消息 id（Rust 返回），不依赖当前 UI 列表：
    // 用户在归档/搜索/自定义排序/非收件箱视图时，仍只通知本次真正的新邮件。
    let candidates: MessageSummary[] = [];
    const newIds = run.new_message_ids ?? [];
    if (newIds.length > 0) {
      try {
        const newMessages = await invoke<MessageSummary[]>(IPC.ListMessagesByIds, {
          messageIds: newIds,
        });
        candidates = newMessages;
      } catch {
        // 查询失败降级：回退到可见列表顶部（仅影响通知正文，不阻塞同步）。
        setNotificationStatus('新邮件详情读取失败');
      }
    }
    if (candidates.length === 0) {
      const currentMessages = getCurrentMessages();
      candidates = (latestMessages ?? currentMessages)
        .slice(0, Math.max(0, run.new_messages ?? run.imported_messages));
    }
    const accountIds = [...new Set(
      candidates
        .map((message) => message.account_id)
        .filter((accountId) => accountId > 0),
    )];
    const mutedThreadScopes = (
      await Promise.all(accountIds.map(async (accountId) => {
        // 单个账号静音查询失败不得产生未处理 rejection：降级为「无静音会话」。
        try {
          const threadKeys = await invoke<string[]>(IPC.ListMutedThreadKeys, { accountId });
          return threadKeys.map((threadKey) => notificationThreadScopeKey({
            account_id: accountId,
            thread_key: threadKey,
            sender_email: '',
            sender_name: '',
            subject: '',
          }));
        } catch {
          setNotificationStatus('静音会话查询失败，已按未静音处理');
          return [];
        }
      }))
    ).flat();
    const decision = newMailNotificationDecision(
      run,
      notificationPolicy,
      candidates,
      new Date(),
      mutedThreadScopes,
    );
    const body = decision.body;
    setLastNewMailNotice(body);
    if (!body) {
      if (decision.reason === 'quiet-hours') setNotificationStatus('免打扰时段已静音');
      if (decision.reason === 'vip-only-no-match') setNotificationStatus('VIP 策略已过滤');
      if (decision.reason === 'account-muted') setNotificationStatus('账号静音已过滤');
      if (decision.reason === 'thread-muted') setNotificationStatus('静音会话已过滤');
      return;
    }

    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }
      if (!granted) {
        setNotificationStatus('系统提醒未授权');
        return;
      }
      sendNotification({ title: 'Better Email', body });
      setNotificationStatus(
        decision.vipMatches > 0
          ? 'VIP 系统提醒已发送'
          : decision.priorityMatches > 0
            ? '重点账号提醒已发送'
            : '系统提醒已发送',
      );
    } catch {
      setNotificationStatus('系统提醒不可用');
    }
  }, [getCurrentMessages, notificationPolicy, setLastNewMailNotice, setNotificationStatus]);

  return { notifyNewMail };
}

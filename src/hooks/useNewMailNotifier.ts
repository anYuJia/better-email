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
    const currentMessages = getCurrentMessages();
    const candidates = (latestMessages ?? currentMessages)
      .slice(0, Math.max(0, run.imported_messages));
    const accountIds = [...new Set(
      candidates
        .map((message) => message.account_id)
        .filter((accountId) => accountId > 0),
    )];
    const mutedThreadScopes = (
      await Promise.all(accountIds.map(async (accountId) => {
        const threadKeys = await invoke<string[]>(IPC.ListMutedThreadKeys, { accountId });
        return threadKeys.map((threadKey) => notificationThreadScopeKey({
          account_id: accountId,
          thread_key: threadKey,
          sender_email: '',
          sender_name: '',
          subject: '',
        }));
      }))
    ).flat();
    const decision = newMailNotificationDecision(
      run,
      notificationPolicy,
      latestMessages ?? currentMessages,
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

import type { SendUndoDelaySeconds } from '../../app/appConfig';
import type { ThemeMode } from '../../hooks/useThemeMode';
import type { NotificationPolicy } from '../../mailUtils';
import AppearanceSettings from './AppearanceSettings';
import NotificationSettingsPage from './pages/NotificationSettingsPage';
import SendingSettingsPage from './pages/SendingSettingsPage';

type GeneralSettingsProps = {
  themeMode: ThemeMode;
  notificationPolicy: NotificationPolicy;
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  onThemeModeChange: (mode: ThemeMode) => void;
  onNotificationPolicyChange: (policy: NotificationPolicy) => void;
  onSendUndoDelayChange: (seconds: SendUndoDelaySeconds) => void;
};

export default function GeneralSettings({
  themeMode,
  notificationPolicy,
  sendUndoDelaySeconds,
  onThemeModeChange,
  onNotificationPolicyChange,
  onSendUndoDelayChange,
}: GeneralSettingsProps) {
  return (
    <>
      <AppearanceSettings
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
      />
      <SendingSettingsPage
        sendUndoDelaySeconds={sendUndoDelaySeconds}
        onSendUndoDelayChange={onSendUndoDelayChange}
      />
      <NotificationSettingsPage
        notificationPolicy={notificationPolicy}
        onNotificationPolicyChange={onNotificationPolicyChange}
      />
    </>
  );
}

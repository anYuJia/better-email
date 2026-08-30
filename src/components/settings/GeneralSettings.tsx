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
  crossAccountRiskWarning: boolean;
  accountPreferenceBusy: boolean;
  onThemeModeChange: (mode: ThemeMode) => void;
  onNotificationPolicyChange: (policy: NotificationPolicy) => void;
  onSendUndoDelayChange: (seconds: SendUndoDelaySeconds) => void;
  onCrossAccountRiskWarningChange: (checked: boolean) => void;
};

export default function GeneralSettings({
  themeMode,
  notificationPolicy,
  sendUndoDelaySeconds,
  crossAccountRiskWarning,
  accountPreferenceBusy,
  onThemeModeChange,
  onNotificationPolicyChange,
  onSendUndoDelayChange,
  onCrossAccountRiskWarningChange,
}: GeneralSettingsProps) {
  return (
    <>
      <AppearanceSettings
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
      />
      <SendingSettingsPage
        sendUndoDelaySeconds={sendUndoDelaySeconds}
        crossAccountRiskWarning={crossAccountRiskWarning}
        accountPreferenceBusy={accountPreferenceBusy}
        onSendUndoDelayChange={onSendUndoDelayChange}
        onCrossAccountRiskWarningChange={onCrossAccountRiskWarningChange}
      />
      <NotificationSettingsPage
        notificationPolicy={notificationPolicy}
        onNotificationPolicyChange={onNotificationPolicyChange}
      />
    </>
  );
}

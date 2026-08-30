import {
  sendUndoDelayOptions,
  type SendUndoDelaySeconds,
} from '../../../app/appConfig';
import { CustomSelect } from '../accounts/CustomSelect';
import {
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from '../shared';

type SendingSettingsPageProps = {
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  crossAccountRiskWarning: boolean;
  accountPreferenceBusy: boolean;
  onSendUndoDelayChange: (seconds: SendUndoDelaySeconds) => void;
  onCrossAccountRiskWarningChange: (checked: boolean) => void;
};

export default function SendingSettingsPage({
  sendUndoDelaySeconds,
  crossAccountRiskWarning,
  accountPreferenceBusy,
  onSendUndoDelayChange,
  onCrossAccountRiskWarningChange,
}: SendingSettingsPageProps) {
  return (
    <SettingsSection dataSection="sending">
      <SettingsRow
        title="撤销发送"
        description="发送后保留一小段时间，期间可撤回到草稿。"
        control={
          <div className="settings-inline-select" aria-label="撤销发送延迟">
            <CustomSelect
              dense
              ariaLabel="撤销发送延迟"
              value={String(sendUndoDelaySeconds)}
              options={sendUndoDelayOptions.map((option) => ({
                value: String(option.value),
                label: option.value === 0 ? '关闭' : option.label,
              }))}
              onChange={(value) => onSendUndoDelayChange(Number(value) as SendUndoDelaySeconds)}
            />
          </div>
        }
      />
      <SettingsSwitch
        label="跨邮箱发送提醒"
        description="发件账号与当前邮件所属账号不一致时提醒；该偏好适用于所有邮箱账号。"
        checked={crossAccountRiskWarning}
        disabled={accountPreferenceBusy}
        onChange={onCrossAccountRiskWarningChange}
      />
    </SettingsSection>
  );
}

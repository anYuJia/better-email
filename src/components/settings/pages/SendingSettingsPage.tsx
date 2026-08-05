import {
  sendUndoDelayOptions,
  type SendUndoDelaySeconds,
} from '../../../app/appConfig';
import { CustomSelect } from '../accounts/CustomSelect';
import {
  SettingsBadge,
  SettingsField,
  SettingsRow,
  SettingsSection,
} from '../shared';

type SendingSettingsPageProps = {
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  onSendUndoDelayChange: (seconds: SendUndoDelaySeconds) => void;
};

export default function SendingSettingsPage({
  sendUndoDelaySeconds,
  onSendUndoDelayChange,
}: SendingSettingsPageProps) {
  return (
    <SettingsSection
      title="发送与撤回"
      description="发送后短暂保留在发件箱，误发时可立即撤回到草稿箱"
      badge={
        <SettingsBadge tone={sendUndoDelaySeconds > 0 ? 'info' : 'neutral'}>
          {sendUndoDelaySeconds > 0 ? `${sendUndoDelaySeconds} 秒` : '已关闭'}
        </SettingsBadge>
      }
      dataSection="sending"
    >
      <SettingsRow
        title="撤销发送延迟"
        description="倒计时结束后自动进入 SMTP 后台任务，应用重启后仍会继续。"
        control={
          <SettingsField label="延迟时间">
            <CustomSelect
              value={String(sendUndoDelaySeconds)}
              options={sendUndoDelayOptions.map((o) => ({ value: String(o.value), label: o.label }))}
              onChange={(val) => onSendUndoDelayChange(Number(val) as SendUndoDelaySeconds)}
            />
          </SettingsField>
        }
      />
      <p className="st-field-hint">
        “发件箱”用于手动排队或稍后发送；“发送”按钮使用这里设置的撤销延迟。
      </p>
    </SettingsSection>
  );
}

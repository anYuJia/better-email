import {
  sendUndoDelayOptions,
  type SendUndoDelaySeconds,
} from '../../../app/appConfig';
import { CustomSelect } from '../accounts/CustomSelect';
import {
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
      title="发送"
      description="减少误发，不增加额外操作。"
      dataSection="sending"
    >
      <SettingsRow
        title="撤销发送"
        description="发送后保留一小段时间，期间可撤回到草稿。"
        control={
          <div className="settings-inline-select" aria-label="撤销发送延迟">
            <CustomSelect
              dense
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
    </SettingsSection>
  );
}

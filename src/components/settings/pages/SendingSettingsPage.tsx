import {
  sendUndoDelayOptions,
  type SendUndoDelaySeconds,
} from '../../../app/appConfig';
import { CustomSelect } from '../accounts/CustomSelect';

type SendingSettingsPageProps = {
  sendUndoDelaySeconds: SendUndoDelaySeconds;
  onSendUndoDelayChange: (seconds: SendUndoDelaySeconds) => void;
};

export default function SendingSettingsPage({
  sendUndoDelaySeconds,
  onSendUndoDelayChange,
}: SendingSettingsPageProps) {
  return (
    <div className="settings-experience-stack">
      <section className="tool-panel settings-send-panel" data-settings-section="sending">
        <header className="tool-header">
          <span>
            <strong>发送与撤回</strong>
            <small>发送后短暂保留在发件箱，误发时可立即撤回到草稿箱</small>
          </span>
          <em>{sendUndoDelaySeconds > 0 ? `${sendUndoDelaySeconds} 秒` : '已关闭'}</em>
        </header>
        <div className="settings-send-control">
          <span>
            <strong>撤销发送延迟</strong>
            <small>倒计时结束后自动进入 SMTP 后台任务，应用重启后仍会继续。</small>
          </span>
          <label>
            <span>延迟时间</span>
            <CustomSelect
              value={String(sendUndoDelaySeconds)}
              options={sendUndoDelayOptions.map((o) => ({ value: String(o.value), label: o.label }))}
              onChange={(val) => onSendUndoDelayChange(Number(val) as SendUndoDelaySeconds)}
            />
          </label>
        </div>
        <p className="settings-send-note">
          “发件箱”用于手动排队或稍后发送；“发送”按钮使用这里设置的撤销延迟。
        </p>
      </section>
    </div>
  );
}

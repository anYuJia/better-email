import {
  sendUndoDelayOptions,
  type SendUndoDelaySeconds,
} from '../../../app/appConfig';

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
            <select
              aria-label="撤销发送延迟"
              value={sendUndoDelaySeconds}
              onChange={(event) => onSendUndoDelayChange(Number(event.target.value) as SendUndoDelaySeconds)}
            >
              {sendUndoDelayOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="settings-send-note">
          “发件箱”用于手动排队或稍后发送；“发送”按钮使用这里设置的撤销延迟。
        </p>
      </section>
    </div>
  );
}

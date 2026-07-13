import {
  FileCheck2,
  Inbox,
  RefreshCw,
  Send,
} from 'lucide-react';
import type {
  ProviderWritebackValidationProgress,
  ProviderWritebackValidationStepId,
  ProviderWriteValidationStatus,
} from '../../app/providerWriteValidation';
import ProviderWritebackValidationPanel from './ProviderWritebackValidationPanel';

type ProviderWriteValidationSettingsProps = {
  status: ProviderWriteValidationStatus | null;
  loading: boolean;
  writebackProgress: ProviderWritebackValidationProgress | null;
  onPrepare: () => void;
  onRefresh: () => void;
  onLocate: (role: 'sent' | 'inbox') => void;
  onRunWritebackStep: (step: ProviderWritebackValidationStepId) => void;
  onResetWriteback: () => void;
};

export default function ProviderWriteValidationSettings({
  status,
  loading,
  writebackProgress,
  onPrepare,
  onRefresh,
  onLocate,
  onRunWritebackStep,
  onResetWriteback,
}: ProviderWriteValidationSettingsProps) {
  return (
    <details className="tool-panel settings-write-validation" open>
      <summary>
        <span>
          <strong>发送与回写验收</strong>
          <small>生成发给自己的验证草稿，真实发送前仍需在撰写器中确认</small>
        </span>
        <b>
          {status
            ? status.complete
              ? '核心步骤通过'
              : `${status.passedCoreStages}/${status.coreStageCount} 核心步骤`
            : '需手动确认'}
        </b>
      </summary>
      <div>
        <p>
          草稿不会自动发送，也不会自动添加附件。请检查收件人，按需添加不含敏感信息的小文件，
          再手动发送并验证已发送留档、自发自收、附件读取和远端状态回写。
        </p>
        <ol>
          <li>默认收件人为当前账号，避免向第三方发送测试邮件。</li>
          <li>主题包含唯一验证编号，便于在已发送和收件箱中定位。</li>
          <li>不要在草稿或附件中放入密码、授权码或 Token。</li>
        </ol>
        {status && (
          <section
            className="write-validation-status"
            data-write-validation-id={status.validationId}
          >
            <header>
              <span>
                <strong>当前验证</strong>
                <code>{status.validationId}</code>
              </span>
              <em>
                {status.complete
                  ? 'SMTP、Sent 留档和自发自收已确认'
                  : '刷新邮件头后继续检查后续状态'}
              </em>
            </header>
            <div className="write-validation-stage-grid">
              {status.stages.map((stage) => (
                <article
                  className={`write-validation-stage ${stage.tone}`}
                  data-validation-stage={stage.id}
                  key={stage.id}
                >
                  <span>{stage.title}</span>
                  <b>
                    {stage.tone === 'passed'
                      ? '通过'
                      : stage.tone === 'active'
                        ? '可继续'
                        : stage.tone === 'warning'
                          ? '待处理'
                          : stage.tone === 'failed'
                            ? '失败'
                            : '等待'}
                  </b>
                  <p>{stage.detail}</p>
                </article>
              ))}
            </div>
            {writebackProgress && (
              <ProviderWritebackValidationPanel
                progress={writebackProgress}
                onRunStep={onRunWritebackStep}
                onReset={onResetWriteback}
              />
            )}
          </section>
        )}
        <div className="settings-write-validation-actions">
          <button
            className="secondary"
            disabled={!status || loading}
            type="button"
            onClick={onRefresh}
          >
            <RefreshCw size={14} />
            {loading ? '刷新中' : '刷新状态'}
          </button>
          <button
            className="secondary"
            disabled={!status?.sentMessageId}
            type="button"
            onClick={() => onLocate('sent')}
          >
            <Send size={14} />
            定位已发送
          </button>
          <button
            className="secondary"
            disabled={!status?.receivedMessageId}
            type="button"
            onClick={() => onLocate('inbox')}
          >
            <Inbox size={14} />
            定位收件
          </button>
          <button type="button" onClick={onPrepare}>
            <FileCheck2 size={14} />
            {status ? '生成新验证草稿' : '生成验证草稿'}
          </button>
        </div>
      </div>
    </details>
  );
}

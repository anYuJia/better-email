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
import { SettingsBadge, SettingsButton, SettingsNotice, SettingsSection } from './shared';

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
    <SettingsSection
      title="发送与回写验收"
      description="生成发给自己的验证草稿，真实发送前仍需在撰写器中确认"
      badge={
        <SettingsBadge tone="neutral">
          {status
            ? status.complete
              ? '核心步骤通过'
              : `${status.passedCoreStages}/${status.coreStageCount} 核心步骤`
            : '需手动确认'}
        </SettingsBadge>
      }
      dataSection="sync"
    >
      <SettingsNotice tone="info">
        <p>
          验证草稿仅发给当前账号，发送前请手动确认收件人；不要在草稿或附件中放入密码、授权码或 Token。
        </p>
      </SettingsNotice>
      <details className="write-validation-guidance">
        <summary>查看验证说明</summary>
        <ol>
          <li>草稿不会自动发送，也不会自动添加附件。</li>
          <li>主题包含唯一验证编号，可在已发送和收件箱中定位。</li>
          <li>发送后可依次确认留档、自发自收、附件读取和远端状态回写。</li>
        </ol>
      </details>
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
      <div className="st-actions">
        <SettingsButton
          disabled={!status || loading}
          icon={<RefreshCw size={14} />}
          onClick={onRefresh}
        >
          {loading ? '刷新中' : '刷新状态'}
        </SettingsButton>
        <SettingsButton
          disabled={!status?.sentMessageId}
          icon={<Send size={14} />}
          onClick={() => onLocate('sent')}
        >
          定位已发送
        </SettingsButton>
        <SettingsButton
          disabled={!status?.receivedMessageId}
          icon={<Inbox size={14} />}
          onClick={() => onLocate('inbox')}
        >
          定位收件
        </SettingsButton>
        <SettingsButton variant="primary" icon={<FileCheck2 size={14} />} onClick={onPrepare}>
          {status ? '生成新验证草稿' : '生成验证草稿'}
        </SettingsButton>
      </div>
    </SettingsSection>
  );
}

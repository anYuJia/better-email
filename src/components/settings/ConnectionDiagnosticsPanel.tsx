import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  KeyRound,
  LoaderCircle,
  MailCheck,
  PlayCircle,
  Send,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { buildConnectionDiagnosticModel, type ConnectionDiagnosticStep } from '../../app/connectionDiagnostics';
import type {
  ProviderValidationReport,
  ProviderValidationStage,
} from '../../app/providerValidation';
import type {
  Account,
  ConnectionReport,
  CredentialStatus,
  CredentialVerificationReport,
} from '../../app/types';
import { formatDate } from '../../mailUtils';
import './connection-diagnostics.css';

type ConnectionDiagnosticsPanelProps = {
  account: Account;
  credentialStatus: CredentialStatus | null;
  connectionReport: ConnectionReport | null;
  credentialVerification: CredentialVerificationReport | null;
  providerValidationReport: ProviderValidationReport | null;
  providerValidationRunning: boolean;
  onRunProviderValidation: () => void;
};

const stepIcons = {
  network: Server,
  credential: KeyRound,
  incoming: MailCheck,
  smtp: Send,
};

function StepStateIcon({ step }: { step: ConnectionDiagnosticStep }) {
  if (step.state === 'success') return <CheckCircle2 size={15} />;
  if (step.state === 'warning' || step.state === 'error') return <AlertTriangle size={15} />;
  return <Circle size={15} />;
}

function ValidationStateIcon({ stage }: { stage: ProviderValidationStage }) {
  if (stage.state === 'success') return <CheckCircle2 size={13} />;
  if (stage.state === 'running') return <LoaderCircle className="connection-spinner" size={13} />;
  if (stage.state === 'warning' || stage.state === 'error') return <AlertTriangle size={13} />;
  return <Circle size={13} />;
}

export default function ConnectionDiagnosticsPanel({
  account,
  credentialStatus,
  connectionReport,
  credentialVerification,
  providerValidationReport,
  providerValidationRunning,
  onRunProviderValidation,
}: ConnectionDiagnosticsPanelProps) {
  const model = buildConnectionDiagnosticModel({
    account,
    credentialStatus,
    connectionReport,
    credentialVerification,
  });
  const hasTechnicalDetails = Boolean(connectionReport || credentialVerification);

  return (
    <section
      className={`connection-diagnostics ${model.state}`}
      data-connection-diagnostics
      aria-label="账号连接诊断"
    >
      <header>
        <span className="connection-diagnostics-icon" aria-hidden="true">
          <ShieldCheck size={17} />
        </span>
        <div className="connection-diagnostics-title">
          <strong>{model.title}</strong>
          <p>{model.summary}</p>
        </div>
        <div className="connection-diagnostics-actions">
          <em>{model.providerLabel}</em>
          <button
            type="button"
            disabled={providerValidationRunning}
            title="依次检查服务器、登录、文件夹发现和邮件头同步；不会发送邮件"
            onClick={onRunProviderValidation}
          >
            {providerValidationRunning
              ? <LoaderCircle className="connection-spinner" size={13} />
              : <PlayCircle size={13} />}
            {providerValidationRunning ? '验收中' : '只读验收'}
          </button>
        </div>
      </header>

      <div className="connection-diagnostic-steps" role="list">
        {model.steps.map((step) => {
          const Icon = stepIcons[step.id];
          return (
            <div className={step.state} data-diagnostic-step={step.id} key={step.id} role="listitem">
              <span className="connection-step-kind" aria-hidden="true">
                <Icon size={14} />
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
              <span className="connection-step-state" aria-label={step.state}>
                <StepStateIcon step={step} />
              </span>
            </div>
          );
        })}
      </div>

      <div className="connection-recommendations">
        <strong>建议操作</strong>
        <ol>
          {model.recommendations.map((recommendation) => (
            <li key={recommendation}>{recommendation}</li>
          ))}
        </ol>
      </div>

      <div
        className={`provider-validation ${providerValidationReport?.status ?? 'idle'}`}
        data-provider-validation
        data-provider-validation-status={providerValidationReport?.status ?? 'idle'}
      >
        {providerValidationReport ? (
          <>
            <div className="provider-validation-stages" role="list">
              {providerValidationReport.stages.map((stage) => (
                <span
                  className={stage.state}
                  data-provider-validation-stage={stage.id}
                  key={stage.id}
                  role="listitem"
                  title={stage.detail}
                >
                  <ValidationStateIcon stage={stage} />
                  <b>{stage.label}</b>
                </span>
              ))}
            </div>
            <p>{providerValidationReport.summary}</p>
          </>
        ) : (
          <p>只读验收按顺序检查服务器、登录、文件夹与邮件头同步，不发送邮件或修改远端状态。</p>
        )}
      </div>

      {hasTechnicalDetails && (
        <details className="connection-technical-details">
          <summary>
            <span>技术详情</span>
          </summary>
          <div>
            {credentialVerification && (
              <p>
                <strong>摘要</strong>
                <span>账号登录验证</span>
                <em>{credentialVerification.authenticated ? '全部通过' : '未通过'}</em>
                <small>{credentialVerification.message}</small>
              </p>
            )}
            {connectionReport?.endpoints.map((endpoint) => (
              <p key={`${endpoint.name}-${endpoint.address}`}>
                <strong>{endpoint.name}</strong>
                <span>{endpoint.address}</span>
                <em>{endpoint.reachable ? `${endpoint.latency_ms ?? 0} ms` : '不可达'}</em>
                <small>{endpoint.message}</small>
              </p>
            ))}
            {credentialVerification?.checks.map((check) => (
              <p key={`${check.name}-${check.address}`}>
                <strong>{check.name}</strong>
                <span>{check.address}</span>
                <em>{check.authenticated ? '认证成功' : '认证失败'}</em>
                <small>{check.message}</small>
              </p>
            ))}
            <footer>
              不显示或导出授权码与 Token
              {credentialVerification ? ` · ${formatDate(credentialVerification.checked_at)}` : ''}
            </footer>
          </div>
        </details>
      )}
    </section>
  );
}

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  KeyRound,
  MailCheck,
  Send,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { buildConnectionDiagnosticModel, type ConnectionDiagnosticStep } from '../../app/connectionDiagnostics';
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
};

const stepIcons = {
  network: Server,
  credential: KeyRound,
  imap: MailCheck,
  smtp: Send,
};

function StepStateIcon({ step }: { step: ConnectionDiagnosticStep }) {
  if (step.state === 'success') return <CheckCircle2 size={15} />;
  if (step.state === 'warning' || step.state === 'error') return <AlertTriangle size={15} />;
  return <Circle size={15} />;
}

export default function ConnectionDiagnosticsPanel({
  account,
  credentialStatus,
  connectionReport,
  credentialVerification,
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
        <div>
          <strong>{model.title}</strong>
          <p>{model.summary}</p>
        </div>
        <em>{model.providerLabel}</em>
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

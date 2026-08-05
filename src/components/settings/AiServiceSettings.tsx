import {
  CheckCircle2,
  Check,
  FlaskConical,
  Globe,
  KeyRound,
  PlugZap,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { AiServiceType } from '../../app/types/ai';
import useAiService from '../../hooks/useAiService';
import {
  SettingsButton,
  SettingsField,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from './shared';

const SERVICE_OPTIONS: Array<{ value: AiServiceType; label: string; description: string; advanced?: boolean }> = [
  {
    value: 'mock',
    label: '本地演示模式',
    description: '离线模拟翻译、摘要与模板生成，无需网络，用于体验功能。',
  },
  {
    value: 'http',
    label: 'OpenAI 兼容接口',
    description: '连接任意兼容 OpenAI chat/completions 的服务。',
  },
  {
    value: 'mcp',
    label: 'MCP 服务',
    description: '调用外部 MCP 服务（JSON-RPC over HTTP），适合有技术背景的用户。',
    advanced: true,
  },
];

const AVAILABLE_FEATURES = ['翻译', '摘要', '模板生成'];

export default function AiServiceSettings() {
  const {
    config,
    patchConfig,
    maskedApiKey,
    testing,
    saving,
    testResult,
    saveConfig,
    runTestConnection,
  } = useAiService({ setStatus: () => undefined });
  const external = config.serviceType !== 'mock';
  const statusLabel = !config.enabled
    ? '未启用'
    : config.serviceType === 'mock'
      ? '本地演示'
      : config.serviceType === 'mcp'
        ? 'MCP 服务'
        : '外部 API';

  return (
    <SettingsSection
      badge={
        <span className="st-badge st-badge-info">{statusLabel}</span>
      }
      dataSection="ai"
    >
      <div className="ai-overview-row" aria-label="AI 服务状态">
        <span className="ai-overview-icon" aria-hidden="true"><Sparkles size={15} /></span>
        <span className="ai-overview-copy">
          <strong>可用功能：{AVAILABLE_FEATURES.join('、')}。</strong>
          <small>
            {external
              ? '启用外部服务后，邮件正文或提示词可能发送到配置的服务。'
              : '本地演示模式不会向任何外部服务器发送内容。'}
          </small>
        </span>
      </div>

      <div className={`settings-ai-config-area${config.enabled ? '' : ' is-dimmed'}`}>
        <SettingsSwitch
          label="开启 AI 服务"
          description="关闭后翻译、摘要与模板生成不可用，已保存的配置会保留。"
          checked={config.enabled}
          onChange={(checked) => patchConfig({ enabled: checked })}
        />

        <SettingsField label="服务来源">
          <div className="settings-ai-service-options">
            {SERVICE_OPTIONS.map((option) => {
              const active = config.serviceType === option.value;
              return (
                <label
                  key={option.value}
                  className={`settings-ai-service-option${active ? ' active' : ''}`}
                >
                  <input
                    type="radio"
                    name="ai-service-type"
                    value={option.value}
                    checked={active}
                    onChange={() => patchConfig({ serviceType: option.value })}
                  />
                  <strong>
                    {option.label}
                    {option.advanced && <em className="ai-service-badge">高级</em>}
                    <Check size={14} className="ai-service-check" aria-hidden="true" />
                  </strong>
                  <small>{option.description}</small>
                </label>
              );
            })}
          </div>
        </SettingsField>

        {external && (
          <>
            <SettingsField label={config.serviceType === 'mcp' ? 'MCP 服务地址' : 'API 服务地址'}>
              <input
                className="settings-text-input"
                type="url"
                placeholder={config.serviceType === 'mcp' ? 'https://mcp.example.com/mcp' : 'https://api.example.com/v1'}
                value={config.endpoint}
                onChange={(event) => patchConfig({ endpoint: event.target.value })}
              />
            </SettingsField>

            <SettingsField label="API Key / Token">
              <div className="settings-ai-key-row">
                <input
                  className="settings-text-input"
                  type="password"
                  placeholder={maskedApiKey || '输入 API Key'}
                  value={config.apiKey}
                  onChange={(event) => patchConfig({ apiKey: event.target.value })}
                  autoComplete="off"
                />
                <span className="settings-ai-key-hint">
                  <KeyRound size={12} aria-hidden="true" />
                  {maskedApiKey ? '已保存，输入新值可替换' : '未保存'}
                </span>
              </div>
            </SettingsField>

            <SettingsField label="默认模型">
              <input
                className="settings-text-input"
                type="text"
                placeholder="gpt-4o-mini"
                value={config.defaultModel}
                onChange={(event) => patchConfig({ defaultModel: event.target.value })}
              />
            </SettingsField>

            <SettingsField label="超时（秒）">
              <input
                className="settings-text-input"
                type="number"
                min={5}
                max={300}
                value={config.timeoutSeconds}
                onChange={(event) => patchConfig({ timeoutSeconds: Number(event.target.value) || 30 })}
              />
            </SettingsField>

            <SettingsNotice tone="warning" title="隐私确认" icon={ShieldAlert}>
              <p>
                开启翻译、模板生成或摘要后，邮件正文与提示词将被发送到上面配置的外部 AI 服务。
                请在确认服务商数据处理政策后使用；Better Email 不会在你的设备之外保存这些内容。
              </p>
              <SettingsSwitch
                label="我已阅读并同意将邮件内容发送到外部 AI 服务"
                description="未确认前，外部服务模式无法使用翻译、摘要与模板生成。"
                checked={config.privacyAcknowledged}
                onChange={(checked) => patchConfig({ privacyAcknowledged: checked })}
              />
            </SettingsNotice>
          </>
        )}

        {config.serviceType === 'mock' && (
          <SettingsNotice tone="info" title="本地演示模式" icon={FlaskConical}>
            <p>
              当前为本地模拟服务：翻译、模板生成与摘要返回稳定的示例结果，
              不会向任何外部服务器发送内容，无需网络连接，也不需要隐私确认。
            </p>
          </SettingsNotice>
        )}
      </div>

      <div className="st-actions">
        <SettingsButton onClick={runTestConnection} disabled={testing || !config.enabled}>
          <PlugZap size={14} />
          {testing ? '测试中…' : '测试连接'}
        </SettingsButton>
        <SettingsButton variant="primary" onClick={saveConfig} disabled={saving}>
          <Globe size={14} />
          {saving ? '保存中…' : '保存设置'}
        </SettingsButton>
      </div>

      {testResult && (
        <div className={`settings-ai-test-result${testResult.ok ? ' ok' : ' fail'}`}>
          {testResult.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          <span>{testResult.message}</span>
          {typeof testResult.latencyMs === 'number' && testResult.latencyMs > 0 && (
            <em>{testResult.latencyMs} ms</em>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

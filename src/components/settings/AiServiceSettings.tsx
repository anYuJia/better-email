import {
  CheckCircle2,
  KeyRound,
  PlugZap,
  Save,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { AiServiceType } from '../../app/types/ai';
import useAiService from '../../hooks/useAiService';
import {
  SettingsBadge,
  SettingsButton,
  SettingsField,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from './shared';

const AVAILABLE_FEATURES = ['翻译', '摘要', '模板生成'];

export type AiServiceSettingsMode = 'ai' | 'mcp';

type AiServiceSettingsProps = {
  mode?: AiServiceSettingsMode;
};

export default function AiServiceSettings({ mode = 'ai' }: AiServiceSettingsProps) {
  const isMcp = mode === 'mcp';
  const activeServiceType: AiServiceType = isMcp ? 'mcp' : 'http';
  const {
    config,
    patchConfig,
    testing,
    saving,
    saveError,
    testResult,
    saveConfig,
    runTestConnection,
  } = useAiService({ setStatus: () => undefined, serviceType: activeServiceType });

  const connectorEnabled = isMcp ? config.mcpEnabled === true : config.enabled;
  const providerEndpoint = isMcp ? config.mcpEndpoint ?? '' : config.endpoint;
  const providerHasApiKey = isMcp ? config.hasMcpApiKey : config.hasApiKey;
  const pageTitle = isMcp ? 'MCP 服务' : 'AI 功能';
  const pageDescription = isMcp
    ? '通过 MCP 连接外部工具，为 AI 功能提供可调用能力。'
    : `用于${AVAILABLE_FEATURES.join('、')}。`;

  return (
    <div className="settings-ai-page-stack">
      <SettingsSection
        title={pageTitle}
        description={pageDescription}
        badge={<SettingsBadge tone={connectorEnabled ? 'info' : 'neutral'}>
          {connectorEnabled ? '已启用' : '未启用'}
        </SettingsBadge>}
        dataSection={isMcp ? 'mcp' : 'ai'}
      >
        <SettingsSwitch
          label={isMcp ? '启用 MCP 服务' : '启用 AI 功能'}
          description={isMcp
            ? '启用后，AI 功能可以通过此 MCP 服务调用外部工具。'
            : '使用时，邮件内容可能会发送到你配置的外部 AI 服务。'}
          checked={connectorEnabled}
          onChange={(checked) => patchConfig(isMcp
            ? { mcpEnabled: checked }
            : { enabled: checked })}
        />
        {isMcp && !config.enabled && (
          <p className="settings-ai-gated-note">
            使用 MCP 处理邮件前，还需要在「AI 接入」中启用 AI 功能。
          </p>
        )}
      </SettingsSection>

      <div className={`settings-ai-config-area${connectorEnabled ? '' : ' is-dimmed'}`}>
        <SettingsSection
          title={isMcp ? '连接参数' : '服务与模型'}
          description={isMcp
            ? '配置 MCP 服务端点与访问凭据。'
            : '配置兼容 OpenAI API 的服务与模型。'}
          dataSection={isMcp ? 'mcp-connection' : 'ai-llm-provider'}
        >
          {!isMcp && (
            <SettingsField label="接入方式" labelMode="static">
              <span className="settings-ai-provider-value">OpenAI 兼容 API</span>
            </SettingsField>
          )}

          {!isMcp && (
            <SettingsField label="模型" hint="填写服务支持的模型名称">
              <input
                className="settings-text-input"
                type="text"
                placeholder="gpt-4o-mini"
                value={config.defaultModel}
                onChange={(event) => patchConfig({ defaultModel: event.target.value })}
              />
            </SettingsField>
          )}

          <SettingsNotice tone="warning" title="外部服务隐私" icon={ShieldAlert}>
            <p>
              {isMcp
                ? '调用 MCP 工具时，相关邮件内容与提示词可能会发送到你配置的 MCP 服务。'
                : '翻译、摘要或模板生成时，相关邮件内容与提示词会发送到你配置的服务。'}
            </p>
          </SettingsNotice>
          <SettingsSwitch
            label="允许向此服务发送邮件内容"
            description="确认后才能使用外部服务。"
            checked={config.privacyAcknowledged}
            onChange={(checked) => patchConfig({ privacyAcknowledged: checked })}
          />

          <details
            className="settings-disclosure settings-ai-advanced"
            data-settings-section={isMcp ? 'mcp-advanced' : 'ai-advanced'}
          >
            <summary>
              <span>
                <strong>{isMcp ? '服务凭据' : '高级连接'}</strong>
                <small>{isMcp ? '端点与访问 Token' : '端点、密钥与超时时间'}</small>
              </span>
              <em>{providerEndpoint ? '已配置' : '待配置'}</em>
            </summary>
            <div className="settings-disclosure-body st-field-grid">
              <SettingsField label={isMcp ? 'MCP 服务端点' : 'API 服务端点'}>
                <input
                  className="settings-text-input"
                  type="url"
                  placeholder={isMcp ? 'https://mcp.example.com' : 'https://api.example.com/v1'}
                  value={providerEndpoint}
                  onChange={(event) => patchConfig(isMcp
                    ? { mcpEndpoint: event.target.value }
                    : { endpoint: event.target.value })}
                />
              </SettingsField>

              <SettingsField label={isMcp ? '访问 Token' : 'API Key / Token'}>
                <div className="settings-ai-key-row">
                  <input
                    className="settings-text-input"
                    type="password"
                    placeholder={providerHasApiKey
                      ? '已保存，留空保持不变'
                      : '输入访问密钥'}
                    value={isMcp ? config.mcpApiKey ?? '' : config.apiKey}
                    onChange={(event) => patchConfig(isMcp
                      ? { mcpApiKey: event.target.value }
                      : { apiKey: event.target.value })}
                    autoComplete="off"
                  />
                  {providerHasApiKey && !(isMcp ? config.mcpApiKey : config.apiKey) ? (
                    <button
                      type="button"
                      className="settings-text-button"
                      onClick={() => patchConfig(isMcp
                        ? { clearMcpApiKey: true, hasMcpApiKey: false }
                        : { clearApiKey: true, hasApiKey: false })}
                    >
                      清除已保存密钥
                    </button>
                  ) : (
                    <span className="settings-ai-key-hint">
                      <KeyRound size={12} aria-hidden="true" />
                      {providerHasApiKey ? '已保存' : '未保存'}
                    </span>
                  )}
                </div>
              </SettingsField>

              <SettingsField label="请求超时" hint="5–300 秒">
                <input
                  className="settings-text-input"
                  type="number"
                  min={5}
                  max={300}
                  value={config.timeoutSeconds}
                  onChange={(event) => patchConfig({ timeoutSeconds: Number(event.target.value) || 30 })}
                />
              </SettingsField>
            </div>
          </details>

          <div className="st-actions settings-ai-actions">
            <SettingsButton
              onClick={runTestConnection}
              disabled={testing || !connectorEnabled}
            >
              <PlugZap size={14} />
              {testing ? '测试中…' : '测试连接'}
            </SettingsButton>
            <SettingsButton
              variant="primary"
              onClick={() => { saveConfig().catch(() => undefined); }}
              disabled={saving}
            >
              <Save size={14} />
              {saving ? '保存中…' : '保存设置'}
            </SettingsButton>
          </div>

          {saveError && (
            <p className="settings-ai-save-error" role="alert">{saveError}</p>
          )}

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
      </div>
    </div>
  );
}

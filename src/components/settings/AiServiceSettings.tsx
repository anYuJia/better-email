import {
  CheckCircle2,
  FlaskConical,
  KeyRound,
  PlugZap,
  Save,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { AiServiceType } from '../../app/types/ai';
import useAiService from '../../hooks/useAiService';
import { CustomSelect } from './accounts/CustomSelect';
import {
  SettingsBadge,
  SettingsButton,
  SettingsField,
  SettingsNotice,
  SettingsSection,
  SettingsSwitch,
} from './shared';

const AVAILABLE_FEATURES = ['翻译', '摘要', '模板生成'];

export default function AiServiceSettings() {
  const {
    config,
    patchConfig,
    testing,
    saving,
    saveError,
    testResult,
    saveConfig,
    runTestConnection,
  } = useAiService({ setStatus: () => undefined });

  const isMcp = config.serviceType === 'mcp';
  const external = config.serviceType !== 'mock';
  const providerEndpoint = isMcp ? config.mcpEndpoint ?? '' : config.endpoint;
  const providerApiKey = isMcp ? config.mcpApiKey ?? '' : config.apiKey;
  const providerHasApiKey = isMcp ? config.hasMcpApiKey : config.hasApiKey;
  const statusLabel = !config.enabled
    ? '未启用'
    : config.serviceType === 'mock'
      ? '本地演示'
      : config.serviceType === 'mcp'
        ? 'MCP'
        : '外部服务';

  return (
    <div className="settings-ai-page-stack">
      <SettingsSection
        title="AI 功能"
        description={`用于${AVAILABLE_FEATURES.join('、')}。`}
        badge={<SettingsBadge tone={config.enabled ? 'info' : 'neutral'}>{statusLabel}</SettingsBadge>}
        dataSection="ai"
      >
        <SettingsSwitch
          label="启用 AI 功能"
          description={external
            ? '使用时，邮件内容可能会发送到你配置的外部服务。'
            : '本地演示不会向外部服务器发送邮件内容。'}
          checked={config.enabled}
          onChange={(checked) => patchConfig({ enabled: checked })}
        />
      </SettingsSection>

      <div className={`settings-ai-config-area${config.enabled ? '' : ' is-dimmed'}`}>
        <SettingsSection
          title="服务与模型"
          description="选择 Better Email 如何处理 AI 请求。"
          dataSection="ai-llm-provider"
        >
          <SettingsField label="AI 服务">
            <CustomSelect
              dense
              value={config.serviceType}
              options={[
                { value: 'mock', label: '本地演示' },
                { value: 'http', label: 'OpenAI 兼容服务' },
                { value: 'mcp', label: 'MCP 服务' },
              ]}
              onChange={(val) => {
                const nextServiceType = val as AiServiceType;
                patchConfig({
                  serviceType: nextServiceType,
                  ...(nextServiceType === 'mcp' ? { mcpEnabled: true } : {}),
                });
              }}
            />
          </SettingsField>

          {!isMcp && external && (
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

          {external && (
            <>
              <SettingsNotice tone="warning" title="外部服务隐私" icon={ShieldAlert}>
                <p>翻译、摘要或模板生成时，相关邮件内容与提示词会发送到你配置的服务。</p>
              </SettingsNotice>
              <SettingsSwitch
                label="允许向此服务发送邮件内容"
                description="确认后才能使用外部 AI 服务。"
                checked={config.privacyAcknowledged}
                onChange={(checked) => patchConfig({ privacyAcknowledged: checked })}
              />

              <details
                className="settings-disclosure settings-ai-advanced"
                data-settings-section="ai-advanced"
              >
                <summary>
                  <span>
                    <strong>高级连接</strong>
                    <small>端点、密钥与超时时间</small>
                  </span>
                  <em>{providerEndpoint ? '已配置' : '待配置'}</em>
                </summary>
                <div className="settings-disclosure-body st-field-grid">
                  <SettingsField label={isMcp ? 'MCP 服务端点' : 'API 服务端点'}>
                    <input
                      className="settings-text-input"
                      type="url"
                      placeholder={isMcp ? 'http://127.0.0.1:8080/mcp' : 'https://api.example.com/v1'}
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
                        value={providerApiKey}
                        onChange={(event) => patchConfig(isMcp
                          ? { mcpApiKey: event.target.value }
                          : { apiKey: event.target.value })}
                        autoComplete="off"
                      />
                      {providerHasApiKey && !providerApiKey ? (
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
            </>
          )}

          {!external && (
            <SettingsNotice tone="info" title="本地演示" icon={FlaskConical}>
              <p>返回稳定的示例结果，不需要网络、密钥或隐私授权。</p>
            </SettingsNotice>
          )}

          <div className="st-actions settings-ai-actions">
            <SettingsButton onClick={runTestConnection} disabled={testing || !config.enabled}>
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

import {
  CheckCircle2,
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
  const external = config.serviceType !== 'mock';
  const statusLabel = !config.enabled
    ? '未启用'
    : config.serviceType === 'mock'
      ? '本地演示'
      : config.serviceType === 'mcp'
        ? 'MCP 服务'
        : '外部 API';

  return (
    <div className="settings-ai-page-stack">
      {/* 模块一：AI 服务状态 */}
      <SettingsSection
        title="AI 服务"
        description={`可用功能：${AVAILABLE_FEATURES.join('、')}。`}
        badge={<span className="st-badge st-badge-info">{statusLabel}</span>}
        dataSection="ai"
      >
        <div className="ai-hero-card">
          <div className="ai-overview-row" aria-label="AI 服务状态">
            <span className="ai-overview-icon" aria-hidden="true"><Sparkles size={16} /></span>
            <span className="ai-overview-copy">
              <strong>可用功能：{AVAILABLE_FEATURES.join('、')}。</strong>
              <small>
                {external
                  ? '启用外部服务后，邮件正文或提示词可能发送到配置的服务。'
                  : '本地演示模式不会向任何外部服务器发送内容。'}
              </small>
            </span>
          </div>

          <div className="ai-hero-toggle-row">
            <SettingsSwitch
              label="启用 AI 服务"
              description="启用翻译、摘要与模板生成功能。配置数据会安全保留。"
              checked={config.enabled}
              onChange={(checked) => patchConfig({ enabled: checked })}
            />
          </div>
        </div>
      </SettingsSection>

      {/* 核心服务区域 */}
      <div className={`settings-ai-config-area${config.enabled ? '' : ' is-dimmed'}`}>
        {/* 模块二：LLM 模型推理服务配置 */}
        <SettingsSection
          title="模型推理服务 (LLM)"
          description="用于处理应用内的邮件翻译、摘要与模板生成"
          badge={
            <SettingsBadge tone={external ? 'info' : 'neutral'}>
              {external ? '外部 API 引擎' : '本地演示模式'}
            </SettingsBadge>
          }
          dataSection="ai-llm-provider"
        >
          <SettingsField label="选择推理引擎来源" hint="按需选择本地离线演示模式或外部 OpenAI 兼容服务端点">
            <CustomSelect
              dense
              value={config.serviceType === 'mcp' ? 'http' : config.serviceType}
              options={[
                { value: 'mock', label: '本地演示模式 (Mock) — 离线示例，无外部请求' },
                { value: 'http', label: 'OpenAI 兼容 API — 连接兼容 chat/completions 的外部 LLM 服务' },
              ]}
              onChange={(val) => patchConfig({ serviceType: val as AiServiceType })}
            />
          </SettingsField>

          {external && (
            <div className="st-field-grid" style={{ marginTop: '16px' }}>
              <SettingsField label="API 服务端点">
                <input
                  className="settings-text-input"
                  type="url"
                  placeholder="https://api.example.com/v1"
                  value={config.endpoint}
                  onChange={(event) => patchConfig({ endpoint: event.target.value })}
                />
              </SettingsField>

              <SettingsField label="API Key / Token">
                <div className="settings-ai-key-row">
                  <input
                    className="settings-text-input"
                    type="password"
                    placeholder={config.hasApiKey ? '已保存 Key，留空保持不变' : '输入 API Key'}
                    value={config.apiKey}
                    onChange={(event) => patchConfig({ apiKey: event.target.value })}
                    autoComplete="off"
                  />
                  {config.hasApiKey && !config.apiKey ? (
                    <button
                      type="button"
                      className="settings-text-button"
                      onClick={() => patchConfig({ clearApiKey: true, hasApiKey: false })}
                    >
                      清除已保存 Key
                    </button>
                  ) : (
                    <span className="settings-ai-key-hint">
                      <KeyRound size={12} aria-hidden="true" />
                      {config.hasApiKey ? '已保存 Key' : '未保存'}
                    </span>
                  )}
                </div>
              </SettingsField>

              <SettingsField label="默认模型名称">
                <input
                  className="settings-text-input"
                  type="text"
                  placeholder="gpt-4o-mini"
                  value={config.defaultModel}
                  onChange={(event) => patchConfig({ defaultModel: event.target.value })}
                />
              </SettingsField>

              <SettingsField label="请求超时时间 (秒)">
                <input
                  className="settings-text-input"
                  type="number"
                  min={5}
                  max={300}
                  value={config.timeoutSeconds}
                  onChange={(event) => patchConfig({ timeoutSeconds: Number(event.target.value) || 30 })}
                />
              </SettingsField>

              <div style={{ gridColumn: '1 / -1' }}>
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
              </div>
            </div>
          )}

          {!external && (
            <SettingsNotice tone="info" title="本地演示模式" icon={FlaskConical} style={{ marginTop: '12px' }}>
              <p>
                当前为本地模拟服务：翻译、模板生成与摘要返回稳定的示例结果，
                不会向任何外部服务器发送内容，无需网络连接，也不需要隐私确认。
              </p>
            </SettingsNotice>
          )}

          <div className="st-actions" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--st-border)' }}>
            <SettingsButton onClick={runTestConnection} disabled={testing || !config.enabled}>
              <PlugZap size={14} />
              {testing ? '测试中…' : '测试连接'}
            </SettingsButton>
            <SettingsButton variant="primary" onClick={() => { saveConfig().catch(() => undefined); }} disabled={saving}>
              <Globe size={14} />
              {saving ? '保存中…' : '保存设置'}
            </SettingsButton>
          </div>
          {saveError && (
            <p className="settings-ai-save-error" role="alert">
              {saveError}
            </p>
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

        {/* 模块四：MCP (Model Context Protocol) 客户端配置 */}
        <SettingsSection
          title="MCP 服务 (Model Context Protocol)"
          description="连接外部 MCP 服务器，通过 JSON-RPC 调用翻译、摘要与模板生成工具"
          badge={
            <SettingsBadge tone={config.mcpEnabled ? 'success' : 'neutral'}>
              {config.mcpEnabled ? 'MCP 已启用' : 'MCP 未启用'}
            </SettingsBadge>
          }
          dataSection="ai-mcp-gateway"
        >
          <SettingsSwitch
            label="启用 MCP 服务"
            description="启用后，应用可调用已配置的 MCP 服务器执行翻译、摘要与模板生成。"
            checked={Boolean(config.mcpEnabled)}
            onChange={(checked) => patchConfig({ mcpEnabled: checked })}
          />

          {config.mcpEnabled && (
            <div className="st-field-grid" style={{ marginTop: '12px' }}>
              <SettingsField label="MCP 服务端点">
                <input
                  className="settings-text-input"
                  type="url"
                  placeholder="http://127.0.0.1:8080/mcp"
                  value={config.mcpEndpoint || ''}
                  onChange={(event) => patchConfig({ mcpEndpoint: event.target.value })}
                />
              </SettingsField>

              <SettingsField label="Bearer 鉴权 Token (可选)">
                <div className="settings-ai-key-row">
                  <input
                    className="settings-text-input"
                    type="password"
                    placeholder={config.hasMcpApiKey ? '已保存 Token，留空保持不变' : '设置访问该服务的鉴权 Token (Bearer)'}
                    value={config.mcpApiKey || ''}
                    onChange={(event) => patchConfig({ mcpApiKey: event.target.value })}
                    autoComplete="off"
                  />
                  {config.hasMcpApiKey && !config.mcpApiKey ? (
                    <button
                      type="button"
                      className="settings-text-button"
                      onClick={() => patchConfig({ clearMcpApiKey: true, hasMcpApiKey: false })}
                    >
                      清除已保存 Token
                    </button>
                  ) : (
                    <span className="settings-ai-key-hint">
                      <KeyRound size={12} aria-hidden="true" />
                      {config.hasMcpApiKey ? '已保存 Token' : ''}
                    </span>
                  )}
                </div>
              </SettingsField>
            </div>
          )}
        </SettingsSection>
      </div>
    </div>
  );
}
